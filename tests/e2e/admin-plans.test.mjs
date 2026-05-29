import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestServer,
  api,
  TEST_ADMIN_LOGIN,
  TEST_ADMIN_PASSWORD,
} from '../helpers/test-server.mjs';

describe('e2e: 管理后台 API 与订阅', () => {
  /** @type {Awaited<ReturnType<typeof startTestServer>>} */
  let ctx;
  let adminToken;

  before(async () => {
    ctx = await startTestServer();
    const login = await api(ctx.baseUrl, '/api/login', {
      token: '',
      body: { loginName: TEST_ADMIN_LOGIN, password: TEST_ADMIN_PASSWORD },
    });
    adminToken = login.data.token;
  });

  after(async () => {
    await ctx.close();
  });

  it('GET /api/admin/plans 返回套餐列表', async () => {
    const res = await api(ctx.baseUrl, '/api/admin/plans', { token: adminToken, method: 'GET' });
    assert.equal(res.status, 200);
    assert.ok(res.data.plans.length >= 3);
    assert.ok(res.data.plans.some((p) => p.id === 'pro'));
  });

  it('GET /api/admin/usage 返回用户用量', async () => {
    const res = await api(ctx.baseUrl, '/api/admin/usage', { token: adminToken, method: 'GET' });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.data.rows));
    assert.ok(res.data.rows.some((r) => r.loginName === TEST_ADMIN_LOGIN));
  });

  it('POST subscribe 升级客户套餐', async () => {
    const created = await api(ctx.baseUrl, '/api/admin/users', {
      token: adminToken,
      body: { loginName: 'sub-user', role: 'customer', password: 'sub12345' },
    });
    const userId = created.data.user.id;

    const sub = await api(ctx.baseUrl, `/api/admin/users/${userId}/subscribe`, {
      token: adminToken,
      body: { plan: 'pro', months: 1, note: 'e2e test' },
    });
    assert.equal(sub.status, 200);

    const me = await api(ctx.baseUrl, '/api/login', {
      token: '',
      body: { loginName: 'sub-user', password: 'sub12345' },
    });
    const profile = await api(ctx.baseUrl, '/api/me', { token: me.data.token, method: 'GET' });
    assert.equal(profile.data.plan, 'pro');

    const history = await api(ctx.baseUrl, `/api/admin/users/${userId}/subscriptions`, {
      token: adminToken,
      method: 'GET',
    });
    assert.equal(history.status, 200);
    assert.ok(history.data.subscriptions.length >= 1);
  });

  it('GET /admin.html 可访问', async () => {
    const res = await fetch(`${ctx.baseUrl}/admin.html`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /管理后台/);
    assert.match(html, /创建客户账号/);
  });
});
