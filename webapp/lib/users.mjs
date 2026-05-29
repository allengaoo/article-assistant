/**
 * 用户账号 CRUD（SQLite）
 */
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { getDb } from './db.mjs';

const SALT_LEN = 16;
const KEY_LEN = 64;

export function hashPassword(password) {
  const salt = randomBytes(SALT_LEN);
  const hash = scryptSync(password, salt, KEY_LEN);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const parts = stored.split(':');
  if (parts.length !== 2) return false;
  const [saltHex, hashHex] = parts;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, salt, KEY_LEN);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export function generatePassword(len = 8) {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(len);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    loginName: row.login_name,
    role: row.role,
    status: row.status,
    plan: row.plan,
    planExpiresAt: row.plan_expires_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function findUserByLogin(loginName) {
  const row = getDb().prepare(
    'SELECT * FROM users WHERE login_name = ? COLLATE NOCASE',
  ).get(loginName.trim());
  return row ?? null;
}

export function findUserById(id) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) ?? null;
}

export function listUsers() {
  const rows = getDb().prepare(
    'SELECT id, login_name, role, status, plan, plan_expires_at, created_at, updated_at FROM users ORDER BY created_at',
  ).all();
  return rows.map(rowToUser);
}

export function createUser({ loginName, password, role = 'customer', plan = 'free' }) {
  const name = loginName.trim();
  if (!name) throw new Error('登录名不能为空');
  if (!password || password.length < 6) throw new Error('密码至少 6 位');

  const existing = findUserByLogin(name);
  if (existing) throw new Error('登录名已存在');

  const now = new Date().toISOString();
  const user = {
    id: randomUUID(),
    login_name: name,
    password_hash: hashPassword(password),
    role,
    status: 'active',
    plan,
    plan_expires_at: null,
    created_at: now,
    updated_at: now,
  };

  getDb().prepare(`
    INSERT INTO users (id, login_name, password_hash, role, status, plan, plan_expires_at, created_at, updated_at)
    VALUES (@id, @login_name, @password_hash, @role, @status, @plan, @plan_expires_at, @created_at, @updated_at)
  `).run(user);

  return rowToUser(findUserById(user.id));
}

export function updateUser(id, { status, plan, role, planExpiresAt } = {}) {
  const user = findUserById(id);
  if (!user) throw new Error('用户不存在');

  const fields = [];
  const params = { id, updated_at: new Date().toISOString() };

  if (status !== undefined) { fields.push('status = @status'); params.status = status; }
  if (plan !== undefined) { fields.push('plan = @plan'); params.plan = plan; }
  if (role !== undefined) { fields.push('role = @role'); params.role = role; }
  if (planExpiresAt !== undefined) {
    fields.push('plan_expires_at = @plan_expires_at');
    params.plan_expires_at = planExpiresAt;
  }

  if (fields.length === 0) return rowToUser(user);

  fields.push('updated_at = @updated_at');
  getDb().prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = @id`).run(params);
  return rowToUser(findUserById(id));
}

export function resetUserPassword(id, newPassword) {
  const user = findUserById(id);
  if (!user) throw new Error('用户不存在');
  if (!newPassword || newPassword.length < 6) throw new Error('密码至少 6 位');

  getDb().prepare(`
    UPDATE users SET password_hash = @password_hash, updated_at = @updated_at WHERE id = @id
  `).run({
    id,
    password_hash: hashPassword(newPassword),
    updated_at: new Date().toISOString(),
  });

  getDb().prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(id);
  return true;
}

export function countUsers() {
  return getDb().prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

/** 首次启动：无用户时根据环境变量创建管理员 */
export function bootstrapAdminIfEmpty({ login, password } = {}) {
  if (countUsers() > 0) return null;
  if (!login?.trim() || !password) {
    console.warn('[users] 数据库无用户，请设置 ADMIN_LOGIN 与 ADMIN_PASSWORD 创建首个管理员');
    return null;
  }
  const admin = createUser({
    loginName: login.trim(),
    password,
    role: 'admin',
    plan: 'free',
  });
  console.log(`[users] 已创建首个管理员: ${admin.loginName}`);
  return admin;
}

export function writeAudit(userId, action, detail = null) {
  getDb().prepare(`
    INSERT INTO audit_log (user_id, action, detail, created_at)
    VALUES (?, ?, ?, ?)
  `).run(userId, action, detail ? JSON.stringify(detail) : null, new Date().toISOString());
}
