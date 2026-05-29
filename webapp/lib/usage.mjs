/**
 * 用户用量统计与配额校验（按月）
 */
import { getDb } from './db.mjs';
import { findUserById } from './users.mjs';
import { getPlanLimits, QUOTA_ACTIONS } from './plans.mjs';

export function monthKey(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

export function getEffectivePlan(userId) {
  const row = findUserById(userId);
  if (!row) return 'free';
  if (row.plan_expires_at && new Date(row.plan_expires_at) < new Date()) {
    return 'free';
  }
  return row.plan || 'free';
}

export function isQuotaExempt(user) {
  return !!user?.legacy || user?.role === 'admin';
}

export function countUsage(userId, action, month = monthKey()) {
  const row = getDb().prepare(`
    SELECT COUNT(*) AS n FROM usage_events
    WHERE user_id = ? AND action = ? AND month_key = ?
  `).get(userId, action, month);
  return row?.n ?? 0;
}

export function getUsageSummary(userId, planId = getEffectivePlan(userId), month = monthKey()) {
  const limits = getPlanLimits(planId);
  const usage = {};
  for (const action of QUOTA_ACTIONS) {
    usage[action] = {
      used: countUsage(userId, action, month),
      limit: limits[action],
    };
  }
  return { month, plan: planId, usage };
}

export function checkQuota(userId, planId, action) {
  const limits = getPlanLimits(planId);
  const limit = limits[action];
  if (limit == null) return { ok: true };

  const used = countUsage(userId, action);
  const usage = getUsageSummary(userId, planId);

  if (used >= limit) {
    const labels = {
      extract: '内容提取',
      ai_outline: '大纲生成',
      ai_article: '全文生成',
      publish: '推送草稿',
    };
    return {
      ok: false,
      message: `本月${labels[action] || action}配额已用完（${used}/${limit}），请联系管理员升级套餐`,
      usage: usage.usage,
      limits,
    };
  }

  return { ok: true, usage: usage.usage, limits };
}

export function recordUsage(userId, action, month = monthKey()) {
  getDb().prepare(`
    INSERT INTO usage_events (user_id, action, month_key, created_at)
    VALUES (?, ?, ?, ?)
  `).run(userId, action, month, new Date().toISOString());
}

export function listUsageByUsers(month = monthKey()) {
  const users = getDb().prepare(`
    SELECT id, login_name, role, status, plan, plan_expires_at FROM users ORDER BY created_at
  `).all();

  return users.map((u) => {
    const plan = u.plan_expires_at && new Date(u.plan_expires_at) < new Date() ? 'free' : u.plan;
    const summary = getUsageSummary(u.id, plan, month);
    return {
      userId: u.id,
      loginName: u.login_name,
      role: u.role,
      status: u.status,
      plan,
      planExpiresAt: u.plan_expires_at,
      ...summary,
    };
  });
}
