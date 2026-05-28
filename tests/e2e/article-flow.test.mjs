import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, api, TEST_TOKEN } from '../helpers/test-server.mjs';

describe('e2e: 公众号文章全流程', () => {
  /** @type {Awaited<ReturnType<typeof startTestServer>>} */
  let ctx;

  before(async () => {
    ctx = await startTestServer();
  });

  after(async () => {
    await ctx.close();
  });

  it('文字输入 → 大纲 → 修订 → 全文 → 推送草稿', async () => {
    const extract = await api(ctx.baseUrl, '/api/extract', {
      body: { type: 'text', text: '本体论工程实践摘录' },
    });
    assert.equal(extract.status, 200);
    assert.ok(extract.data.sessionId);
    assert.match(extract.data.preview, /本体论工程实践摘录/);

    const { sessionId } = extract.data;

    const outline = await api(ctx.baseUrl, '/api/outline', {
      body: { sessionId },
    });
    assert.equal(outline.status, 200);
    assert.match(outline.data.outline, /测试文章标题/);

    const revise = await api(ctx.baseUrl, '/api/revise', {
      body: { sessionId, feedback: '加强第一章的工程案例' },
    });
    assert.equal(revise.status, 200);
    assert.equal(revise.data.round, 1);
    assert.match(revise.data.outline, /修订版/);

    const article = await api(ctx.baseUrl, '/api/article', {
      body: { sessionId },
    });
    assert.equal(article.status, 200);
    assert.match(article.data.article, /CI 测试文章/);

    const publish = await api(ctx.baseUrl, '/api/publish', {
      body: { sessionId },
    });
    assert.equal(publish.status, 200);
    assert.equal(publish.data.success, true);
    assert.equal(publish.data.title, 'CI 测试文章');
  });

  it('URL 输入类型可走通提取与大纲', async () => {
    const extract = await api(ctx.baseUrl, '/api/extract', {
      body: { type: 'url', url: 'https://example.com/article' },
    });
    assert.equal(extract.status, 200);
    assert.match(extract.data.preview, /example\.com/);

    const outline = await api(ctx.baseUrl, '/api/outline', {
      body: { sessionId: extract.data.sessionId },
    });
    assert.equal(outline.status, 200);
    assert.ok(outline.data.outline.length > 0);
  });

  it('缺少 sessionId 时返回 404', async () => {
    const res = await api(ctx.baseUrl, '/api/outline', {
      body: { sessionId: '00000000-0000-0000-0000-000000000000' },
    });
    assert.equal(res.status, 404);
  });

  it('未确认大纲时不能生成全文', async () => {
    const extract = await api(ctx.baseUrl, '/api/extract', {
      body: { type: 'text', text: '跳过大纲的测试' },
    });
    const res = await api(ctx.baseUrl, '/api/article', {
      body: { sessionId: extract.data.sessionId },
    });
    assert.equal(res.status, 400);
    assert.match(res.data.error, /大纲/);
  });
});

describe('e2e: 鉴权', () => {
  /** @type {Awaited<ReturnType<typeof startTestServer>>} */
  let ctx;

  before(async () => {
    ctx = await startTestServer();
  });

  after(async () => {
    await ctx.close();
  });

  it('无 token 拒绝访问 API', async () => {
    const res = await api(ctx.baseUrl, '/api/extract', {
      token: '',
      body: { type: 'text', text: 'hello' },
    });
    assert.equal(res.status, 401);
  });

  it('错误 token 拒绝访问 API', async () => {
    const res = await api(ctx.baseUrl, '/api/extract', {
      token: 'wrong-password',
      body: { type: 'text', text: 'hello' },
    });
    assert.equal(res.status, 401);
  });

  it('正确 token 可以访问', async () => {
    const res = await api(ctx.baseUrl, '/api/extract', {
      token: TEST_TOKEN,
      body: { type: 'text', text: 'auth ok' },
    });
    assert.equal(res.status, 200);
  });
});
