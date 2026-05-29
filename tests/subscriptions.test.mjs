import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeDb } from '../webapp/lib/db.mjs';
import { createUser } from '../webapp/lib/users.mjs';
import { subscribeUser, subscribeFromPayment, listSubscriptions } from '../webapp/lib/subscriptions.mjs';
import { getEffectivePlan } from '../webapp/lib/usage.mjs';

describe('subscriptions', () => {
  let dataDir;
  let userId;
  let adminId;

  beforeEach(() => {
    closeDb();
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gzh-sub-'));
    process.env.DATA_DIR = dataDir;
    adminId = createUser({ loginName: 'admin-sub', password: 'pass1234', role: 'admin' }).id;
    userId = createUser({ loginName: 'cust-sub', password: 'pass1234', plan: 'free' }).id;
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
  });

  it('manual subscribe upgrades plan', () => {
    subscribeUser({ userId, plan: 'pro', months: 1, operatorId: adminId, note: 'test' });
    assert.equal(getEffectivePlan(userId), 'pro');
    const subs = listSubscriptions(userId);
    assert.equal(subs.length, 1);
    assert.equal(subs[0].plan, 'pro');
    assert.equal(subs[0].source, 'manual');
  });

  it('subscribeFromPayment uses payment source', () => {
    subscribeFromPayment({ userId, plan: 'enterprise', months: 3, paymentRef: 'wx_123' });
    const subs = listSubscriptions(userId);
    assert.equal(subs[0].source, 'payment');
    assert.match(subs[0].note, /wx_123/);
  });

  it('downgrade to free clears expiry', () => {
    subscribeUser({ userId, plan: 'pro', months: 1, operatorId: adminId });
    subscribeUser({ userId, plan: 'free', expiresAt: null, operatorId: adminId });
    assert.equal(getEffectivePlan(userId), 'free');
  });
});
