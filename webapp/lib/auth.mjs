/**
 * 请求鉴权：token 提取、legacy 兼容、用户解析
 */
import { resolveUserFromToken } from './auth-sessions.mjs';

export const LEGACY_USER_ID = '__legacy__';

export function extractToken(req) {
  if (!req) return undefined;
  if (req.headers?.authorization?.startsWith('Bearer ')) {
    return req.headers.authorization.slice(7).trim();
  }
  if (req.headers?.['x-access-token']) {
    return req.headers['x-access-token'];
  }
  if (req.body?.token) return req.body.token;
  if (req.query?.token) return req.query.token;
  return undefined;
}

/**
 * 解析 token 对应用户。
 * - 新体系：SQLite auth_sessions
 * - 兼容期：匹配 ACCESS_TOKEN 时视为 legacy 管理员
 */
export function resolveAuth(token, legacyAccessToken) {
  if (!token) return null;

  const user = resolveUserFromToken(token);
  if (user) return user;

  if (legacyAccessToken && token === legacyAccessToken) {
    return {
      id: LEGACY_USER_ID,
      loginName: 'legacy',
      role: 'admin',
      plan: 'free',
      legacy: true,
    };
  }

  return null;
}

/** @deprecated 仅测试保留 */
export function isAuthorized(token, accessToken) {
  return resolveAuth(token, accessToken) !== null;
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    loginName: user.loginName,
    role: user.role,
    plan: user.plan,
    legacy: !!user.legacy,
  };
}

export function requireAdmin(user) {
  return user && (user.role === 'admin' || user.legacy);
}

/** 校验投稿 pipeline session 归属 */
export function ownsPipelineSession(session, user) {
  if (!session) return false;
  if (!session.userId) return !!user?.legacy;
  if (user?.legacy) return session.userId === LEGACY_USER_ID;
  return session.userId === user?.id;
}
