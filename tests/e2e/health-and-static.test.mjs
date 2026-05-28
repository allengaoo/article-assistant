import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, api } from '../helpers/test-server.mjs';

describe('e2e: 健康检查与静态页面', () => {
  /** @type {Awaited<ReturnType<typeof startTestServer>>} */
  let ctx;

  before(async () => {
    ctx = await startTestServer();
  });

  after(async () => {
    await ctx.close();
  });

  it('GET /api/health 返回 ok', async () => {
    const res = await api(ctx.baseUrl, '/api/health', { method: 'GET', token: '' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.data, { ok: true });
  });

  it('GET / 返回首页 HTML', async () => {
    const res = await fetch(`${ctx.baseUrl}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /工程师投稿助手/);
    assert.match(html, /screen-input/);
    assert.match(html, /#screen-input \.tabs \.tab/);
  });

  it('extract 未知类型返回 400', async () => {
    const res = await api(ctx.baseUrl, '/api/extract', {
      body: { type: 'article' },
    });
    assert.equal(res.status, 400);
    assert.match(res.data.error, /未知输入类型/);
  });
});
