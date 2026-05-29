/**
 * Express 配额中间件
 */
import { checkQuota, getEffectivePlan, isQuotaExempt, recordUsage } from './usage.mjs';

export function quotaGuard(action) {
  return (req, res, next) => {
    if (isQuotaExempt(req.user)) return next();
    const plan = getEffectivePlan(req.user.id);
    const check = checkQuota(req.user.id, plan, action);
    if (!check.ok) {
      return res.status(429).json({
        error: check.message,
        usage: check.usage,
        limits: check.limits,
        plan,
      });
    }
    req._quotaAction = action;
    next();
  };
}

export function recordQuotaIfNeeded(req) {
  if (req._quotaAction && req.user && !isQuotaExempt(req.user)) {
    recordUsage(req.user.id, req._quotaAction);
  }
}
