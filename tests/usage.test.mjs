import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeDb } from '../webapp/lib/db.mjs';
import { createUser } from '../webapp/lib/users.mjs';
import {
  recordUsage,
  checkQuota,
  getUsageSummary,
  getEffectivePlan,
  isQuotaExempt,
} from '../webapp/lib/usage.mjs';
import { setTestPlanLimitsOverride } from '../webapp/lib/plans.mjs';
import { subscribeUser } from '../webapp/lib/subscriptions.mjs';

describe('usage & quota', () => {
  let dataDir;
  let userId;

  beforeEach(() => {
    closeDb();
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gzh-usage-'));
    process.env.DATA_DIR = dataDir;
    setTestPlanLimitsOverride({
      free: { extract: 2, ai_outline: 2, ai_article: 1, publish: 1 },
    });
    userId = createUser({ loginName: 'quota-user', password: 'pass1234', plan: 'free' }).id;
  });

  afterEach(() => {
    closeDb();
    setTestPlanLimitsOverride(null);
    fs.rmSync(dataDir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
  });

  it('records usage and enforces monthly limit', () => {
    assert.equal(checkQuota(userId, 'free', 'extract').ok, true);
    recordUsage(userId, 'extract');
    recordUsage(userId, 'extract');
    const blocked = checkQuota(userId, 'free', 'extract');
    assert.equal(blocked.ok, false);
    assert.match(blocked.message, /配额已用完/);
  });

  it('getUsageSummary returns used/limit pairs', () => {
    recordUsage(userId, 'ai_outline');
    const summary = getUsageSummary(userId, 'free');
    assert.equal(summary.usage.ai_outline.used, 1);
    assert.equal(summary.usage.ai_outline.limit, 2);
  });

  it('expired plan falls back to free limits', () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    subscribeUser({ userId, plan: 'pro', expiresAt: past, operatorId: userId });
    assert.equal(getEffectivePlan(userId), 'free');
  });

  it('admin and legacy are quota exempt', () => {
    assert.equal(isQuotaExempt({ role: 'admin' }), true);
    assert.equal(isQuotaExempt({ legacy: true }), true);
    assert.equal(isQuotaExempt({ role: 'customer' }), false);
  });
});
