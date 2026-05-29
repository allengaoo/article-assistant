/**
 * 登录会话 token（存 SQLite，非投稿 pipeline session）
 */
import { randomUUID } from 'node:crypto';
import { getDb } from './db.mjs';
import { findUserById } from './users.mjs';

export const AUTH_SESSION_TTL_MS = process.env.AUTH_SESSION_TTL_MS
  ? Number(process.env.AUTH_SESSION_TTL_MS)
  : 7 * 24 * 60 * 60 * 1000;

export function createAuthSession(userId) {
  const token = randomUUID();
  const now = Date.now();
  const expiresAt = now + AUTH_SESSION_TTL_MS;
  getDb().prepare(`
    INSERT INTO auth_sessions (token, user_id, expires_at, created_at)
    VALUES (?, ?, ?, ?)
  `).run(token, userId, expiresAt, new Date(now).toISOString());
  return token;
}

export function findAuthSession(token) {
  return getDb().prepare('SELECT * FROM auth_sessions WHERE token = ?').get(token) ?? null;
}

export function deleteAuthSession(token) {
  getDb().prepare('DELETE FROM auth_sessions WHERE token = ?').run(token);
}

export function purgeExpiredAuthSessions() {
  getDb().prepare('DELETE FROM auth_sessions WHERE expires_at < ?').run(Date.now());
}

/** 从 bearer token 解析当前用户（不含 legacy） */
export function resolveUserFromToken(token) {
  if (!token) return null;
  purgeExpiredAuthSessions();

  const row = findAuthSession(token);
  if (!row || Date.now() > row.expires_at) {
    if (row) deleteAuthSession(token);
    return null;
  }

  const user = findUserById(row.user_id);
  if (!user || user.status !== 'active') return null;

  return {
    id: user.id,
    loginName: user.login_name,
    role: user.role,
    plan: user.plan,
    legacy: false,
  };
}
