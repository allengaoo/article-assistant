import express from 'express';
import multer from 'multer';
import { fileURLToPath } from 'url';
import path from 'path';
import { randomUUID } from 'crypto';
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import dotenv from 'dotenv';
import { rateLimit } from 'express-rate-limit';

import { createSession, getSession, updateSession } from './lib/session.mjs';
import { persistSession, loadSessionsForDate } from './lib/persistence.mjs';
import { generateAndSaveDailySummary } from './lib/knowledge.mjs';
import { extractUrl, extractImage, extractVideo } from './lib/extract.mjs';
import { generateOutline, generateArticle, generatePrdOutline, generatePrdDocument } from './lib/gemini.mjs';
import { isAuthorized, extractToken } from './lib/auth.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(ROOT_DIR, '.env') });
dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const upload = multer({ dest: path.join(os.tmpdir(), 'gzh-uploads') });

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const GEMINI_API_KEY = process.env.DASHSCOPE_API_KEY;

// ── Rate limiting ──────────────────────────────────────────────────────────────
// Auth attempts: 5 failures per IP per 10 minutes → locks out brute force
const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,       // 只计失败次数，成功不扣额度
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '登录失败次数过多，请 10 分钟后再试' },
});

// API calls: 30 requests per IP per hour → prevents API quota abuse
const apiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '请求过于频繁，请 1 小时后再试' },
});

// ── Auth middleware ────────────────────────────────────────────────────────────
function auth(req, res, next) {
  const token = extractToken(req);
  if (isAuthorized(token, ACCESS_TOKEN)) return next();
  return res.status(401).json({ error: '无效访问令牌，请重新输入密码' });
}

// ── POST /api/extract ──────────────────────────────────────────────────────────
// Submit input, get back sessionId + a short preview of extracted content.
app.post('/api/extract', authLimiter, auth, apiLimiter, upload.single('image'), async (req, res) => {
  const { type, url, text, videoUrl } = req.body;
  try {
    let rawContent;
    if (type === 'url') {
      if (!url) return res.status(400).json({ error: '请填写 URL' });
      rawContent = await extractUrl(url);
    } else if (type === 'text') {
      if (!text?.trim()) return res.status(400).json({ error: '请填写文字内容' });
      rawContent = text.trim();
    } else if (type === 'image') {
      if (!req.file) return res.status(400).json({ error: '未收到图片文件' });
      rawContent = await extractImage(req.file.path, GEMINI_API_KEY);
    } else if (type === 'video') {
      if (!videoUrl) return res.status(400).json({ error: '请填写视频 URL' });
      rawContent = await extractVideo(videoUrl);
    } else {
      return res.status(400).json({ error: '未知输入类型' });
    }

    const sessionId = randomUUID();
    createSession(sessionId);
    const s = updateSession(sessionId, { rawContent, inputType: type });
    persistSession(sessionId, s);

    res.json({ sessionId, preview: rawContent.slice(0, 400) });
  } catch (e) {
    console.error('[extract]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/outline ──────────────────────────────────────────────────────────
// Generate the first outline draft from extracted content.
app.post('/api/outline', auth, apiLimiter, async (req, res) => {
  const { sessionId } = req.body;
  const session = getSession(sessionId);
  if (!session) return res.status(404).json({ error: '会话不存在或已过期（4小时），请重新提交输入' });

  try {
    const outline = await generateOutline(session.rawContent, GEMINI_API_KEY, session.outlineHistory);
    const s1 = updateSession(sessionId, { currentOutline: outline, step: 'outlined' });
    persistSession(sessionId, s1);
    res.json({ outline });
  } catch (e) {
    console.error('[outline]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/revise ───────────────────────────────────────────────────────────
// Revise outline with user feedback (multi-round).
app.post('/api/revise', auth, apiLimiter, async (req, res) => {
  const { sessionId, feedback } = req.body;
  if (!feedback?.trim()) return res.status(400).json({ error: '请填写修改意见' });

  const session = getSession(sessionId);
  if (!session) return res.status(404).json({ error: '会话不存在或已过期，请重新提交输入' });

  try {
    const history = [
      ...session.outlineHistory,
      { outline: session.currentOutline, feedback: feedback.trim() },
    ];
    updateSession(sessionId, { outlineHistory: history });

    const outline = await generateOutline(session.rawContent, GEMINI_API_KEY, history);
    updateSession(sessionId, { currentOutline: outline });
    res.json({ outline, round: history.length });
  } catch (e) {
    console.error('[revise]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/article ──────────────────────────────────────────────────────────
// Generate the full article from the confirmed outline.
app.post('/api/article', auth, apiLimiter, async (req, res) => {
  const { sessionId } = req.body;
  const session = getSession(sessionId);
  if (!session) return res.status(404).json({ error: '会话不存在或已过期，请重新提交输入' });
  if (!session.currentOutline) return res.status(400).json({ error: '请先确认大纲' });

  try {
    const article = await generateArticle(session.rawContent, session.currentOutline, GEMINI_API_KEY);
    const s2 = updateSession(sessionId, { article, step: 'articled' });
    persistSession(sessionId, s2);
    res.json({ article });
  } catch (e) {
    console.error('[article]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/publish ──────────────────────────────────────────────────────────
// Write article to a temp file and call the existing publish.mjs.
app.post('/api/publish', auth, apiLimiter, async (req, res) => {
  const { sessionId } = req.body;
  const session = getSession(sessionId);
  if (!session) return res.status(404).json({ error: '会话不存在或已过期，请重新提交输入' });
  if (!session.article) return res.status(400).json({ error: '请先生成全文' });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gzh-pub-'));
  const articlePath = path.join(tmpDir, 'article.md');

  try {
    fs.writeFileSync(articlePath, session.article, 'utf-8');

    const publishScript = path.resolve(__dirname, '..', 'scripts', 'publish.mjs');
    const output = execSync(`node "${publishScript}" "${articlePath}"`, {
      env: {
        ...process.env,
        // Ensure parent .env vars are available (WX_APPID etc.)
        PATH: process.env.PATH,
      },
      timeout: 120_000,
      cwd: path.resolve(__dirname, '..'),
    }).toString();

    const s3 = updateSession(sessionId, { step: 'published' });
    persistSession(sessionId, s3);

    // Extract article title from front matter for the success message
    const titleMatch = session.article.match(/^title:\s*(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : '文章';

    res.json({ success: true, title, log: output.slice(-500) });
  } catch (e) {
    console.error('[publish]', e.message);
    res.status(500).json({ error: e.message || '发布失败，请检查微信 API 配置' });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── POST /api/prd-outline ──────────────────────────────────────────────────────
app.post('/api/prd-outline', auth, apiLimiter, async (req, res) => {
  const { sessionId } = req.body;
  const session = getSession(sessionId);
  if (!session) return res.status(404).json({ error: '会话不存在或已过期' });
  try {
    const outline = await generatePrdOutline(session.rawContent, GEMINI_API_KEY, session.outlineHistory);
    const sp1 = updateSession(sessionId, { currentOutline: outline, step: 'outlined', mode: 'prd' });
    persistSession(sessionId, sp1);
    res.json({ outline });
  } catch (e) {
    console.error('[prd-outline]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/prd-revise ───────────────────────────────────────────────────────
app.post('/api/prd-revise', auth, apiLimiter, async (req, res) => {
  const { sessionId, feedback } = req.body;
  if (!feedback?.trim()) return res.status(400).json({ error: '请填写修改意见' });
  const session = getSession(sessionId);
  if (!session) return res.status(404).json({ error: '会话不存在或已过期' });
  try {
    const history = [...session.outlineHistory, { outline: session.currentOutline, feedback: feedback.trim() }];
    updateSession(sessionId, { outlineHistory: history });
    const outline = await generatePrdOutline(session.rawContent, GEMINI_API_KEY, history);
    updateSession(sessionId, { currentOutline: outline });
    res.json({ outline, round: history.length });
  } catch (e) {
    console.error('[prd-revise]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/prd-document ─────────────────────────────────────────────────────
app.post('/api/prd-document', auth, apiLimiter, async (req, res) => {
  const { sessionId } = req.body;
  const session = getSession(sessionId);
  if (!session) return res.status(404).json({ error: '会话不存在或已过期' });
  if (!session.currentOutline) return res.status(400).json({ error: '请先确认大纲' });
  try {
    const article = await generatePrdDocument(session.rawContent, session.currentOutline, GEMINI_API_KEY);
    const sp2 = updateSession(sessionId, { article, step: 'articled', mode: 'prd' });
    persistSession(sessionId, sp2);
    res.json({ article });
  } catch (e) {
    console.error('[prd-document]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/download-prd ──────────────────────────────────────────────────────
// 下载 PRD Markdown 文件，供本地运行 feishu-publish 脚本使用
app.get('/api/download-prd', auth, (req, res) => {
  const { sessionId } = req.query;
  const session = getSession(sessionId);
  if (!session || !session.article) return res.status(404).json({ error: '文档不存在' });

  const titleMatch = session.article.match(/^title:\s*(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim().replace(/[/\\:*?"<>|]/g, '-') : 'prd';
  const filename = `${title}.md`;

  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(session.article);
});

// ── GET /api/health ────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// ── GET /api/daily-summary ────────────────────────────────────────────────────
// 对指定日期（默认昨天）的 session 记录做汇总，写入 data/knowledge/daily/
// 仅 MASTER_KEY 可调用，供 crontab 定时触发
app.get('/api/daily-summary', async (req, res) => {
  const { master, date } = req.query;
  if (!master || master !== process.env.MASTER_KEY) {
    return res.status(401).json({ error: '无效主密钥' });
  }

  const targetDate = date || (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1); // 默认昨天（当天记录可能还未完整）
    return d.toISOString().slice(0, 10);
  })();

  try {
    const sessions = loadSessionsForDate(targetDate);
    const summary = await generateAndSaveDailySummary(sessions, GEMINI_API_KEY, targetDate);
    console.log(`[daily-summary] ${targetDate}: ${sessions.length} sessions processed`);
    res.json({ ok: true, date: targetDate, sessionCount: sessions.length, summary });
  } catch (e) {
    console.error('[daily-summary]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/my-token ──────────────────────────────────────────────────────────
// 用主密钥查询当前访问密码，供每周轮换后找回密码使用
app.get('/api/my-token', (req, res) => {
  const master = req.query.master;
  if (!master || master !== process.env.MASTER_KEY) {
    return res.status(401).json({ error: '无效主密钥' });
  }
  res.json({ token: process.env.ACCESS_TOKEN });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[GZH Webapp] Running on http://0.0.0.0:${PORT}`);
});
