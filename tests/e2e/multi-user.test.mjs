import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestServer,
  api,
  TEST_TOKEN,
  TEST_ADMIN_LOGIN,
  TEST_ADMIN_PASSWORD,
} from '../helpers/test-server.mjs';

describe('e2e: 多用户登录与隔离', () => {
  /** @type {Awaited<ReturnType<typeof startTestServer>>} */
  let ctx;

  before(async () => {
    ctx = await startTestServer();
  });

  after(async () => {
    await ctx.close();
  });

  it('POST /api/login 管理员登录成功', async () => {
    const res = await api(ctx.baseUrl, '/api/login', {
      token: '',
      body: { loginName: TEST_ADMIN_LOGIN, password: TEST_ADMIN_PASSWORD },
    });
    assert.equal(res.status, 200);
    assert.ok(res.data.token);
    assert.equal(res.data.user.role, 'admin');
  });

  it('POST /api/login 错误密码返回 401', async () => {
    const res = await api(ctx.baseUrl, '/api/login', {
      token: '',
      body: { loginName: TEST_ADMIN_LOGIN, password: 'wrong-pass' },
    });
    assert.equal(res.status, 401);
  });

  it('legacy ACCESS_TOKEN 仍可用于 /api/auth', async () => {
    const res = await api(ctx.baseUrl, '/api/auth', { token: TEST_TOKEN });
    assert.equal(res.status, 200);
    assert.equal(res.data.ok, true);
    assert.equal(res.data.user.legacy, true);
  });

  it('admin 可创建客户账号', async () => {
    const login = await api(ctx.baseUrl, '/api/login', {
      token: '',
      body: { loginName: TEST_ADMIN_LOGIN, password: TEST_ADMIN_PASSWORD },
    });
    const adminToken = login.data.token;

    const created = await api(ctx.baseUrl, '/api/admin/users', {
      token: adminToken,
      body: { loginName: 'customer-ci', role: 'customer' },
    });
    assert.equal(created.status, 200);
    assert.equal(created.data.user.loginName, 'customer-ci');
    assert.ok(created.data.initialPassword);
  });

  it('客户无法访问 admin API', async () => {
    const adminLogin = await api(ctx.baseUrl, '/api/login', {
      token: '',
      body: { loginName: TEST_ADMIN_LOGIN, password: TEST_ADMIN_PASSWORD },
    });
    const created = await api(ctx.baseUrl, '/api/admin/users', {
      token: adminLogin.data.token,
      body: { loginName: 'customer-deny', role: 'customer', password: 'cust12345' },
    });

    const custLogin = await api(ctx.baseUrl, '/api/login', {
      token: '',
      body: { loginName: 'customer-deny', password: 'cust12345' },
    });

    const denied = await api(ctx.baseUrl, '/api/admin/users', {
      token: custLogin.data.token,
      method: 'GET',
    });
    assert.equal(denied.status, 403);
  });

  it('用户 A 无法访问用户 B 的 session', async () => {
    const adminLogin = await api(ctx.baseUrl, '/api/login', {
      token: '',
      body: { loginName: TEST_ADMIN_LOGIN, password: TEST_ADMIN_PASSWORD },
    });
    const adminToken = adminLogin.data.token;

    for (const name of ['user-a', 'user-b']) {
      await api(ctx.baseUrl, '/api/admin/users', {
        token: adminToken,
        body: { loginName: name, role: 'customer', password: 'same12345' },
      });
    }

    const loginA = await api(ctx.baseUrl, '/api/login', {
      token: '',
      body: { loginName: 'user-a', password: 'same12345' },
    });
    const loginB = await api(ctx.baseUrl, '/api/login', {
      token: '',
      body: { loginName: 'user-b', password: 'same12345' },
    });

    const extractA = await api(ctx.baseUrl, '/api/extract', {
      token: loginA.data.token,
      body: { type: 'text', text: 'content from A' },
    });
    assert.ok(extractA.data.sessionId);

    const outlineB = await api(ctx.baseUrl, '/api/outline', {
      token: loginB.data.token,
      body: { sessionId: extractA.data.sessionId },
    });
    assert.equal(outlineB.status, 404);
  });
});
