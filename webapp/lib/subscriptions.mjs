/**
 * 订阅记录（阶段 4：手动开通，payment 来源预留支付对接）
 */
import { randomUUID } from 'node:crypto';
import { getDb } from './db.mjs';
import { findUserById, updateUser, writeAudit } from './users.mjs';
import { PLANS } from './plans.mjs';

export function listSubscriptions(userId) {
  return getDb().prepare(`
    SELECT id, user_id, plan, started_at, expires_at, source, note, created_at
    FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC
  `).all(userId);
}

export function subscribeUser({
  userId,
  plan,
  expiresAt,
  months,
  source = 'manual',
  note,
  operatorId,
}) {
  if (!PLANS[plan]) throw new Error(`未知套餐: ${plan}`);
  const user = findUserById(userId);
  if (!user) throw new Error('用户不存在');

  let resolvedExpires = expiresAt ?? null;
  if (!resolvedExpires && months != null && months > 0) {
    const d = new Date();
    d.setMonth(d.getMonth() + months);
    resolvedExpires = d.toISOString();
  }

  const now = new Date().toISOString();
  const sub = {
    id: randomUUID(),
    user_id: userId,
    plan,
    started_at: now,
    expires_at: resolvedExpires,
    source,
    note: note ?? null,
    created_at: now,
  };

  getDb().prepare(`
    INSERT INTO subscriptions (id, user_id, plan, started_at, expires_at, source, note, created_at)
    VALUES (@id, @user_id, @plan, @started_at, @expires_at, @source, @note, @created_at)
  `).run(sub);

  updateUser(userId, { plan, planExpiresAt: resolvedExpires });

  if (operatorId) {
    writeAudit(operatorId, 'admin.subscribe', {
      targetId: userId,
      plan,
      expiresAt: resolvedExpires,
      source,
    });
  }

  return {
    subscription: {
      id: sub.id,
      plan: sub.plan,
      startedAt: sub.started_at,
      expiresAt: sub.expires_at,
      source: sub.source,
      note: sub.note,
    },
  };
}

/** 预留：支付 webhook 回调后调用 */
export function subscribeFromPayment({ userId, plan, months, paymentRef }) {
  return subscribeUser({
    userId,
    plan,
    months,
    source: 'payment',
    note: paymentRef ? `payment:${paymentRef}` : 'payment',
  });
}
