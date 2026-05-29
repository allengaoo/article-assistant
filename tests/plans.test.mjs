import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PLANS, listPlans, getPlanLimits, ROUTE_QUOTA_MAP } from '../webapp/lib/plans.mjs';

describe('plans', () => {
  it('defines free pro enterprise', () => {
    assert.ok(PLANS.free);
    assert.ok(PLANS.pro);
    assert.ok(PLANS.enterprise);
    assert.equal(listPlans().length, 3);
  });

  it('pro limits higher than free', () => {
    const free = getPlanLimits('free');
    const pro = getPlanLimits('pro');
    assert.ok(pro.ai_article > free.ai_article);
    assert.ok(pro.publish > free.publish);
  });

  it('maps API routes to quota actions', () => {
    assert.equal(ROUTE_QUOTA_MAP.outline, 'ai_outline');
    assert.equal(ROUTE_QUOTA_MAP.article, 'ai_article');
    assert.equal(ROUTE_QUOTA_MAP.publish, 'publish');
  });
});
