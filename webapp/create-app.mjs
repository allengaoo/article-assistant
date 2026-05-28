import express from 'express';
import multer from 'multer';
import { fileURLToPath } from 'url';
import path from 'path';
import { randomUUID } from 'crypto';
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import { rateLimit } from 'express-rate-limit';

import { createSession, getSession, updateSession } from './lib/session.mjs';
import { persistSession, loadSessionsForDate } from './lib/persistence.mjs';
import { generateAndSaveDailySummary } from './lib/knowledge.mjs';
import * as extract from './lib/extract.mjs';
import * as gemini from './lib/qwen.mjs';
import { isAuthorized, extractToken } from './lib/auth.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

/**
 * @param {object} [options]
 * @param {string} [options.accessToken]
 * @param {string} [options.apiKey]
 * @param {boolean} [options.skipRateLimit]
 * @param {object} [options.services] injectable handlers for tests
 */
export function createApp(options = {}) {
  const accessToken = options.accessToken ?? process.env.ACCESS_TOKEN;
  const apiKey = options.apiKey ?? process.env.DASHSCOPE_API_KEY;
  const skipRateLimit = options.skipRateLimit ?? process.env.NODE_ENV === 'test';

  const services = {
    extractUrl: extract.extractUrl,
    extractImage: extract.extractImage,
    extractVideo: extract.extractVideo,
    generateOutline: gemini.generateOutline,
    generateArticle: gemini.generateArticle,
    generatePrdOutline: gemini.generatePrdOutline,
    generatePrdDocument: gemini.generatePrdDocument,
    publishArticle: (articlePath) => {
      const publishScript = path.resolve(__dirname, '..', 'scripts', 'publish.mjs');
      return execSync(`node "${publishScript}" "${articlePath}"`, {
        env: { ...process.env, PATH: process.env.PATH },
        timeout: 120_000,
        cwd: ROOT_DIR,
      }).toString();
    },
    generateDailySummary: generateAndSaveDailySummary,
    ...options.services,
  };

  const app = express();
  const upload = multer({ dest: path.join(os.tmpdir(), 'gzh-uploads') });

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.join(__dirname, 'public')));

  const noop = (_req, _res, next) => next();
  const authLimiter = skipRateLimit ? noop : rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 5,
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: '登录失败次数过多，请 10 分钟后再试' },
  });
  const apiLimiter = skipRateLimit ? noop : rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: '请求过于频繁，请 1 小时后再试' },
  });

  function auth(req, res, next) {
    const token = extractToken(req);
    if (isAuthorized(token, accessToken)) return next();
    return res.status(401).json({ error: '无效访问令牌，请重新输入密码' });
  }

  app.post('/api/extract', authLimiter, auth, apiLimiter, upload.single('image'), async (req, res) => {
    const { type, url, text, videoUrl } = req.body;
    try {
      let rawContent;
      if (type === 'url') {
        if (!url) return res.status(400).json({ error: '请填写 URL' });
        rawContent = await services.extractUrl(url);
      } else if (type === 'text') {
        if (!text?.trim()) return res.status(400).json({ error: '请填写文字内容' });
        rawContent = text.trim();
      } else if (type === 'image') {
        if (!req.file) return res.status(400).json({ error: '未收到图片文件' });
        rawContent = await services.extractImage(req.file.path, apiKey);
      } else if (type === 'video') {
        if (!videoUrl) return res.status(400).json({ error: '请填写视频 URL' });
        rawContent = await services.extractVideo(videoUrl);
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

  app.post('/api/outline', auth, apiLimiter, async (req, res) => {
    const { sessionId } = req.body;
    const session = getSession(sessionId);
    if (!session) return res.status(404).json({ error: '会话不存在或已过期（4小时），请重新提交输入' });

    try {
      const outline = await services.generateOutline(session.rawContent, apiKey, session.outlineHistory);
      const s1 = updateSession(sessionId, { currentOutline: outline, step: 'outlined' });
      persistSession(sessionId, s1);
      res.json({ outline });
    } catch (e) {
      console.error('[outline]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

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

      const outline = await services.generateOutline(session.rawContent, apiKey, history);
      updateSession(sessionId, { currentOutline: outline });
      res.json({ outline, round: history.length });
    } catch (e) {
      console.error('[revise]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/article', auth, apiLimiter, async (req, res) => {
    const { sessionId } = req.body;
    const session = getSession(sessionId);
    if (!session) return res.status(404).json({ error: '会话不存在或已过期，请重新提交输入' });
    if (!session.currentOutline) return res.status(400).json({ error: '请先确认大纲' });

    try {
      const article = await services.generateArticle(session.rawContent, session.currentOutline, apiKey);
      const s2 = updateSession(sessionId, { article, step: 'articled' });
      persistSession(sessionId, s2);
      res.json({ article });
    } catch (e) {
      console.error('[article]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/publish', auth, apiLimiter, async (req, res) => {
    const { sessionId } = req.body;
    const session = getSession(sessionId);
    if (!session) return res.status(404).json({ error: '会话不存在或已过期，请重新提交输入' });
    if (!session.article) return res.status(400).json({ error: '请先生成全文' });

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gzh-pub-'));
    const articlePath = path.join(tmpDir, 'article.md');

    try {
      // 剥离指向本地文件的 cover 字段（web 临时目录中不存在该文件），
      // 让 publish.mjs 自动降级到正文第一张图；若正文无图则用默认封面。
      const articleContent = session.article.replace(
        /^(cover\s*:\s*)(?!https?:\/\/)(.+)$/m,
        (_, key, val) => `# cover 已移除（本地路径 ${val.trim()} 在服务器不存在）`,
      );

      fs.writeFileSync(articlePath, articleContent, 'utf-8');
      const output = services.publishArticle(articlePath);

      const s3 = updateSession(sessionId, { step: 'published' });
      persistSession(sessionId, s3);

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

  app.post('/api/prd-outline', auth, apiLimiter, async (req, res) => {
    const { sessionId } = req.body;
    const session = getSession(sessionId);
    if (!session) return res.status(404).json({ error: '会话不存在或已过期' });
    try {
      const outline = await services.generatePrdOutline(session.rawContent, apiKey, session.outlineHistory);
      const sp1 = updateSession(sessionId, { currentOutline: outline, step: 'outlined', mode: 'prd' });
      persistSession(sessionId, sp1);
      res.json({ outline });
    } catch (e) {
      console.error('[prd-outline]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/prd-revise', auth, apiLimiter, async (req, res) => {
    const { sessionId, feedback } = req.body;
    if (!feedback?.trim()) return res.status(400).json({ error: '请填写修改意见' });
    const session = getSession(sessionId);
    if (!session) return res.status(404).json({ error: '会话不存在或已过期' });
    try {
      const history = [...session.outlineHistory, { outline: session.currentOutline, feedback: feedback.trim() }];
      updateSession(sessionId, { outlineHistory: history });
      const outline = await services.generatePrdOutline(session.rawContent, apiKey, history);
      updateSession(sessionId, { currentOutline: outline });
      res.json({ outline, round: history.length });
    } catch (e) {
      console.error('[prd-revise]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/prd-document', auth, apiLimiter, async (req, res) => {
    const { sessionId } = req.body;
    const session = getSession(sessionId);
    if (!session) return res.status(404).json({ error: '会话不存在或已过期' });
    if (!session.currentOutline) return res.status(400).json({ error: '请先确认大纲' });
    try {
      const article = await services.generatePrdDocument(session.rawContent, session.currentOutline, apiKey);
      const sp2 = updateSession(sessionId, { article, step: 'articled', mode: 'prd' });
      persistSession(sessionId, sp2);
      res.json({ article });
    } catch (e) {
      console.error('[prd-document]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

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

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.get('/api/daily-summary', async (req, res) => {
    const { master, date } = req.query;
    if (!master || master !== process.env.MASTER_KEY) {
      return res.status(401).json({ error: '无效主密钥' });
    }

    const targetDate = date || (() => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return d.toISOString().slice(0, 10);
    })();

    try {
      const sessions = loadSessionsForDate(targetDate);
      const summary = await services.generateDailySummary(sessions, apiKey, targetDate);
      console.log(`[daily-summary] ${targetDate}: ${sessions.length} sessions processed`);
      res.json({ ok: true, date: targetDate, sessionCount: sessions.length, summary });
    } catch (e) {
      console.error('[daily-summary]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/my-token', (req, res) => {
    const master = req.query.master;
    if (!master || master !== process.env.MASTER_KEY) {
      return res.status(401).json({ error: '无效主密钥' });
    }
    res.json({ token: accessToken });
  });

  return app;
}
