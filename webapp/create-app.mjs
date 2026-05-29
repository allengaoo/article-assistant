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
import {
  extractToken,
  resolveAuth,
  publicUser,
  requireAdmin,
  ownsPipelineSession,
  LEGACY_USER_ID,
} from './lib/auth.mjs';
import { getDb } from './lib/db.mjs';
import {
  bootstrapAdminIfEmpty,
  createUser,
  findUserByLogin,
  findUserById,
  listUsers,
  updateUser,
  resetUserPassword,
  verifyPassword,
  generatePassword,
  writeAudit,
} from './lib/users.mjs';
import { createAuthSession, deleteAuthSession } from './lib/auth-sessions.mjs';
import { listPlans } from './lib/plans.mjs';
import { getEffectivePlan, getUsageSummary, listUsageByUsers } from './lib/usage.mjs';
import { listSubscriptions, subscribeUser } from './lib/subscriptions.mjs';
import { quotaGuard, recordQuotaIfNeeded } from './lib/quota-middleware.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

/**
 * 从必应每日壁纸 API 下载封面图（必应在国内可访问）。
 * @param {string} destPath 保存路径
 */
async function downloadBingCover(destPath) {
  const metaUrl = 'https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=zh-CN';
  const metaRes = await fetch(metaUrl, { signal: AbortSignal.timeout(10_000) });
  if (!metaRes.ok) throw new Error(`获取必应壁纸信息失败 (${metaRes.status})`);
  const meta = await metaRes.json();
  const imgPath = meta?.images?.[0]?.url;
  if (!imgPath) throw new Error('必应壁纸 API 返回数据异常');

  const imgUrl = `https://www.bing.com${imgPath}`;
  const imgRes = await fetch(imgUrl, { signal: AbortSignal.timeout(20_000) });
  if (!imgRes.ok) throw new Error(`下载必应壁纸失败 (${imgRes.status})`);
  const buf = Buffer.from(await imgRes.arrayBuffer());
  fs.writeFileSync(destPath, buf);
}

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

  getDb();
  bootstrapAdminIfEmpty({
    login: process.env.ADMIN_LOGIN,
    password: process.env.ADMIN_PASSWORD,
  });

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
    const user = resolveAuth(token, accessToken);
    if (!user) {
      return res.status(401).json({ error: '无效访问令牌，请重新登录' });
    }
    req.user = user;
    req.authToken = token;
    next();
  }

  function adminOnly(req, res, next) {
    if (!requireAdmin(req.user)) {
      return res.status(403).json({ error: '需要管理员权限' });
    }
    next();
  }

  function pipelineUserId(user) {
    return user.legacy ? LEGACY_USER_ID : user.id;
  }

  function getOwnedPipelineSession(sessionId, user) {
    const session = getSession(sessionId);
    if (!session || !ownsPipelineSession(session, user)) return null;
    return session;
  }

  app.post('/api/login', authLimiter, (req, res) => {
    const loginName = req.body?.loginName?.trim();
    const password = req.body?.password;
    if (!loginName || !password) {
      return res.status(400).json({ error: '请输入账号和密码' });
    }

    const row = findUserByLogin(loginName);
    if (!row || !verifyPassword(password, row.password_hash)) {
      return res.status(401).json({ error: '账号或密码错误' });
    }
    if (row.status !== 'active') {
      return res.status(403).json({ error: '账号已停用，请联系管理员' });
    }

    const token = createAuthSession(row.id);
    writeAudit(row.id, 'login', { loginName: row.login_name });
    res.json({
      token,
      user: publicUser({
        id: row.id,
        loginName: row.login_name,
        role: row.role,
        plan: row.plan,
      }),
    });
  });

  app.post('/api/auth', authLimiter, (req, res) => {
    const token = extractToken(req);
    const user = resolveAuth(token, accessToken);
    if (!user) {
      return res.status(401).json({ error: '登录已失效，请重新登录' });
    }
    return res.json({ ok: true, user: publicUser(user) });
  });

  app.post('/api/logout', auth, (req, res) => {
    if (req.authToken && !req.user.legacy) {
      deleteAuthSession(req.authToken);
    }
    writeAudit(req.user.id, 'logout');
    res.json({ ok: true });
  });

  app.get('/api/admin/users', auth, adminOnly, (_req, res) => {
    res.json({ users: listUsers() });
  });

  app.post('/api/admin/users', auth, adminOnly, (req, res) => {
    try {
      const loginName = req.body?.loginName?.trim();
      const role = req.body?.role === 'admin' ? 'admin' : 'customer';
      const plan = req.body?.plan || 'free';
      const initialPassword = req.body?.password?.trim() || generatePassword(10);

      const user = createUser({ loginName, password: initialPassword, role, plan });
      writeAudit(req.user.id, 'admin.create_user', { targetId: user.id, loginName: user.loginName });
      res.json({ user, initialPassword });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.patch('/api/admin/users/:id', auth, adminOnly, (req, res) => {
    try {
      const { status, plan, role } = req.body || {};
      const user = updateUser(req.params.id, { status, plan, role });
      writeAudit(req.user.id, 'admin.update_user', { targetId: user.id, status, plan, role });
      res.json({ user });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/admin/users/:id/reset-password', auth, adminOnly, (req, res) => {
    try {
      const newPassword = req.body?.password?.trim() || generatePassword(10);
      resetUserPassword(req.params.id, newPassword);
      writeAudit(req.user.id, 'admin.reset_password', { targetId: req.params.id });
      res.json({ ok: true, password: newPassword });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/me', auth, (req, res) => {
    if (req.user.legacy) {
      return res.json({
        user: publicUser(req.user),
        plan: 'legacy',
        usage: null,
        unlimited: true,
      });
    }
    const plan = getEffectivePlan(req.user.id);
    res.json({
      user: { ...publicUser(req.user), plan, planExpiresAt: findUserById(req.user.id)?.plan_expires_at ?? null },
      plan,
      usage: getUsageSummary(req.user.id, plan),
      unlimited: false,
    });
  });

  app.get('/api/admin/plans', auth, adminOnly, (_req, res) => {
    res.json({ plans: listPlans() });
  });

  app.get('/api/admin/usage', auth, adminOnly, (req, res) => {
    const month = req.query.month || undefined;
    res.json({ rows: listUsageByUsers(month) });
  });

  app.get('/api/admin/users/:id/subscriptions', auth, adminOnly, (req, res) => {
    res.json({ subscriptions: listSubscriptions(req.params.id) });
  });

  app.post('/api/admin/users/:id/subscribe', auth, adminOnly, (req, res) => {
    try {
      const { plan, expiresAt, months, note } = req.body || {};
      const result = subscribeUser({
        userId: req.params.id,
        plan,
        expiresAt: expiresAt || null,
        months,
        note,
        operatorId: req.user.id,
      });
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/extract', auth, quotaGuard('extract'), apiLimiter, upload.single('image'), async (req, res) => {
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
      createSession(sessionId, { userId: pipelineUserId(req.user) });
      const s = updateSession(sessionId, { rawContent, inputType: type });
      persistSession(sessionId, s);

      recordQuotaIfNeeded(req);
      res.json({ sessionId, preview: rawContent.slice(0, 400) });
    } catch (e) {
      console.error('[extract]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/outline', auth, quotaGuard('ai_outline'), apiLimiter, async (req, res) => {
    const { sessionId } = req.body;
    const session = getOwnedPipelineSession(sessionId, req.user);
    if (!session) return res.status(404).json({ error: '会话不存在或已过期（4小时），请重新提交输入' });

    try {
      const outline = await services.generateOutline(session.rawContent, apiKey, session.outlineHistory);
      const s1 = updateSession(sessionId, { currentOutline: outline, step: 'outlined' });
      persistSession(sessionId, s1);
      recordQuotaIfNeeded(req);
      res.json({ outline });
    } catch (e) {
      console.error('[outline]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/revise', auth, quotaGuard('ai_outline'), apiLimiter, async (req, res) => {
    const { sessionId, feedback } = req.body;
    if (!feedback?.trim()) return res.status(400).json({ error: '请填写修改意见' });

    const session = getOwnedPipelineSession(sessionId, req.user);
    if (!session) return res.status(404).json({ error: '会话不存在或已过期，请重新提交输入' });

    try {
      const history = [
        ...session.outlineHistory,
        { outline: session.currentOutline, feedback: feedback.trim() },
      ];
      updateSession(sessionId, { outlineHistory: history });

      const outline = await services.generateOutline(session.rawContent, apiKey, history);
      updateSession(sessionId, { currentOutline: outline });
      recordQuotaIfNeeded(req);
      res.json({ outline, round: history.length });
    } catch (e) {
      console.error('[revise]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/article', auth, quotaGuard('ai_article'), apiLimiter, async (req, res) => {
    const { sessionId } = req.body;
    const session = getOwnedPipelineSession(sessionId, req.user);
    if (!session) return res.status(404).json({ error: '会话不存在或已过期，请重新提交输入' });
    if (!session.currentOutline) return res.status(400).json({ error: '请先确认大纲' });

    try {
      const article = await services.generateArticle(session.rawContent, session.currentOutline, apiKey);
      const s2 = updateSession(sessionId, { article, step: 'articled' });
      persistSession(sessionId, s2);
      recordQuotaIfNeeded(req);
      res.json({ article });
    } catch (e) {
      console.error('[article]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/publish', auth, quotaGuard('publish'), apiLimiter, async (req, res) => {
    const { sessionId, coverBase64, coverMode } = req.body;
    const session = getOwnedPipelineSession(sessionId, req.user);
    if (!session) return res.status(404).json({ error: '会话不存在或已过期，请重新提交输入' });
    if (!session.article) return res.status(400).json({ error: '请先生成全文' });

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gzh-pub-'));
    const articlePath = path.join(tmpDir, 'article.md');

    try {
      // 剥离指向本地文件的 cover 字段（临时目录中没有该文件）
      let articleContent = session.article.replace(
        /^cover\s*:\s*(?!https?:\/\/).+$/m,
        '',
      );

      // 用户上传了封面图（base64）
      if (coverBase64) {
        const coverPath = path.join(tmpDir, 'cover.jpg');
        fs.writeFileSync(coverPath, Buffer.from(coverBase64, 'base64'));
        // 在 front matter 中注入 cover 字段
        articleContent = articleContent.replace(/^---\s*\n/, `---\ncover: ./cover.jpg\n`);
      }

      // 用户选择自动下载封面（从必应每日壁纸）
      if (coverMode === 'auto') {
        const coverPath = path.join(tmpDir, 'cover.jpg');
        await downloadBingCover(coverPath);
        articleContent = articleContent.replace(/^---\s*\n/, `---\ncover: ./cover.jpg\n`);
      }

      fs.writeFileSync(articlePath, articleContent, 'utf-8');
      const output = services.publishArticle(articlePath);

      const s3 = updateSession(sessionId, { step: 'published' });
      persistSession(sessionId, s3);

      const titleMatch = session.article.match(/^title:\s*(.+)$/m);
      const title = titleMatch ? titleMatch[1].trim() : '文章';

      recordQuotaIfNeeded(req);
      res.json({ success: true, title, log: output.slice(-500) });
    } catch (e) {
      console.error('[publish]', e.message);
      res.status(500).json({ error: e.message || '发布失败，请检查微信 API 配置' });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  app.post('/api/prd-outline', auth, quotaGuard('ai_outline'), apiLimiter, async (req, res) => {
    const { sessionId } = req.body;
    const session = getOwnedPipelineSession(sessionId, req.user);
    if (!session) return res.status(404).json({ error: '会话不存在或已过期' });
    try {
      const outline = await services.generatePrdOutline(session.rawContent, apiKey, session.outlineHistory);
      const sp1 = updateSession(sessionId, { currentOutline: outline, step: 'outlined', mode: 'prd' });
      persistSession(sessionId, sp1);
      recordQuotaIfNeeded(req);
      res.json({ outline });
    } catch (e) {
      console.error('[prd-outline]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/prd-revise', auth, quotaGuard('ai_outline'), apiLimiter, async (req, res) => {
    const { sessionId, feedback } = req.body;
    if (!feedback?.trim()) return res.status(400).json({ error: '请填写修改意见' });
    const session = getOwnedPipelineSession(sessionId, req.user);
    if (!session) return res.status(404).json({ error: '会话不存在或已过期' });
    try {
      const history = [...session.outlineHistory, { outline: session.currentOutline, feedback: feedback.trim() }];
      updateSession(sessionId, { outlineHistory: history });
      const outline = await services.generatePrdOutline(session.rawContent, apiKey, history);
      updateSession(sessionId, { currentOutline: outline });
      recordQuotaIfNeeded(req);
      res.json({ outline, round: history.length });
    } catch (e) {
      console.error('[prd-revise]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/prd-document', auth, quotaGuard('ai_article'), apiLimiter, async (req, res) => {
    const { sessionId } = req.body;
    const session = getOwnedPipelineSession(sessionId, req.user);
    if (!session) return res.status(404).json({ error: '会话不存在或已过期' });
    if (!session.currentOutline) return res.status(400).json({ error: '请先确认大纲' });
    try {
      const article = await services.generatePrdDocument(session.rawContent, session.currentOutline, apiKey);
      const sp2 = updateSession(sessionId, { article, step: 'articled', mode: 'prd' });
      persistSession(sessionId, sp2);
      recordQuotaIfNeeded(req);
      res.json({ article });
    } catch (e) {
      console.error('[prd-document]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/download-prd', auth, (req, res) => {
    const { sessionId } = req.query;
    const session = getOwnedPipelineSession(sessionId, req.user);
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
