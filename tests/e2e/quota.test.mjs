import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setTestPlanLimitsOverride } from '../../webapp/lib/plans.mjs';
import {
  startTestServer,
  api,
  TEST_ADMIN_LOGIN,
  TEST_ADMIN_PASSWORD,
} from '../helpers/test-server.mjs';

describe('e2e: 配额限制', () => {
  /** @type {Awaited<ReturnType<typeof startTestServer>>} */
  let ctx;
  let customerToken;

  before(async () => {
    setTestPlanLimitsOverride({
      free: { extract: 2, ai_outline: 1, ai_article: 1, publish: 1 },
    });
    ctx = await startTestServer();

    const adminLogin = await api(ctx.baseUrl, '/api/login', {
      token: '',
      body: { loginName: TEST_ADMIN_LOGIN, password: TEST_ADMIN_PASSWORD },
    });
    await api(ctx.baseUrl, '/api/admin/users', {
      token: adminLogin.data.token,
      body: { loginName: 'quota-cust', role: 'customer', password: 'cust12345', plan: 'free' },
    });
    const custLogin = await api(ctx.baseUrl, '/api/login', {
      token: '',
      body: { loginName: 'quota-cust', password: 'cust12345' },
    });
    customerToken = custLogin.data.token;
  });

  after(async () => {
    setTestPlanLimitsOverride(null);
    await ctx.close();
  });

  it('GET /api/me 返回用量摘要', async () => {
    const res = await api(ctx.baseUrl, '/api/me', { token: customerToken, method: 'GET' });
    assert.equal(res.status, 200);
    assert.equal(res.data.plan, 'free');
    assert.ok(res.data.usage.usage.extract);
  });

  it('extract 超过配额返回 429', async () => {
    await api(ctx.baseUrl, '/api/extract', {
      token: customerToken,
      body: { type: 'text', text: 'a' },
    });
    await api(ctx.baseUrl, '/api/extract', {
      token: customerToken,
      body: { type: 'text', text: 'b' },
    });
    const third = await api(ctx.baseUrl, '/api/extract', {
      token: customerToken,
      body: { type: 'text', text: 'c' },
    });
    assert.equal(third.status, 429);
    assert.match(third.data.error, /配额/);
  });

  it('admin 不受配额限制', async () => {
    const adminLogin = await api(ctx.baseUrl, '/api/login', {
      token: '',
      body: { loginName: TEST_ADMIN_LOGIN, password: TEST_ADMIN_PASSWORD },
    });
    for (let i = 0; i < 5; i++) {
      const res = await api(ctx.baseUrl, '/api/extract', {
        token: adminLogin.data.token,
        body: { type: 'text', text: `admin ${i}` },
      });
      assert.equal(res.status, 200, `admin extract ${i} should succeed`);
    }
  });
});
