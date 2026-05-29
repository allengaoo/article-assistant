/**
 * 套餐定义与配额（阶段 4：订阅与配额联动）
 */
export const PLANS = {
  free: {
    id: 'free',
    name: '免费版',
    priceLabel: '¥0',
    limits: {
      extract: 50,
      ai_outline: 30,
      ai_article: 10,
      publish: 10,
    },
  },
  pro: {
    id: 'pro',
    name: '专业版',
    priceLabel: '联系开通',
    limits: {
      extract: 200,
      ai_outline: 100,
      ai_article: 50,
      publish: 50,
    },
  },
  enterprise: {
    id: 'enterprise',
    name: '企业版',
    priceLabel: '联系开通',
    limits: {
      extract: 9999,
      ai_outline: 9999,
      ai_article: 9999,
      publish: 9999,
    },
  },
};

export const QUOTA_ACTIONS = ['extract', 'ai_outline', 'ai_article', 'publish'];

/** API 路由 → 配额动作 */
export const ROUTE_QUOTA_MAP = {
  extract: 'extract',
  outline: 'ai_outline',
  revise: 'ai_outline',
  'prd-outline': 'ai_outline',
  'prd-revise': 'ai_outline',
  article: 'ai_article',
  'prd-document': 'ai_article',
  publish: 'publish',
};

export function listPlans() {
  return Object.values(PLANS);
}

export function getPlan(planId) {
  return PLANS[planId] ?? PLANS.free;
}

export function getPlanLimits(planId) {
  if (_testLimitsOverride?.[planId]) return _testLimitsOverride[planId];
  return getPlan(planId).limits;
}

/** 仅测试：覆盖套餐配额以便 E2E 快速验证 */
let _testLimitsOverride = null;
export function setTestPlanLimitsOverride(override) {
  _testLimitsOverride = override;
}
