import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, api } from '../helpers/test-server.mjs';

describe('e2e: PRD 全流程', () => {
  /** @type {Awaited<ReturnType<typeof startTestServer>>} */
  let ctx;

  before(async () => {
    ctx = await startTestServer();
  });

  after(async () => {
    await ctx.close();
  });

  it('文字输入 → PRD 大纲 → 修订 → 文档 → 下载', async () => {
    const extract = await api(ctx.baseUrl, '/api/extract', {
      body: { type: 'text', text: '智能体行业解决方案设计要点' },
    });
    assert.equal(extract.status, 200);
    const { sessionId } = extract.data;

    const outline = await api(ctx.baseUrl, '/api/prd-outline', {
      body: { sessionId },
    });
    assert.equal(outline.status, 200);
    assert.match(outline.data.outline, /PRD：测试产品/);

    const revise = await api(ctx.baseUrl, '/api/prd-revise', {
      body: { sessionId, feedback: '补充用户故事章节' },
    });
    assert.equal(revise.status, 200);
    assert.equal(revise.data.round, 1);
    assert.match(revise.data.outline, /修订/);

    const doc = await api(ctx.baseUrl, '/api/prd-document', {
      body: { sessionId },
    });
    assert.equal(doc.status, 200);
    assert.match(doc.data.article, /CI 测试 PRD/);

    const download = await api(ctx.baseUrl, `/api/download-prd?sessionId=${sessionId}`, {
      method: 'GET',
    });
    assert.equal(download.status, 200);
    assert.match(download.data, /CI 测试 PRD/);
    assert.match(download.headers.get('content-disposition') || '', /CI/);
  });

  it('修订意见为空时返回 400', async () => {
    const extract = await api(ctx.baseUrl, '/api/extract', {
      body: { type: 'text', text: 'PRD revise validation' },
    });
    await api(ctx.baseUrl, '/api/prd-outline', {
      body: { sessionId: extract.data.sessionId },
    });

    const res = await api(ctx.baseUrl, '/api/prd-revise', {
      body: { sessionId: extract.data.sessionId, feedback: '   ' },
    });
    assert.equal(res.status, 400);
  });

  it('未生成文档时下载返回 404', async () => {
    const extract = await api(ctx.baseUrl, '/api/extract', {
      body: { type: 'text', text: 'no doc yet' },
    });
    const res = await api(ctx.baseUrl, `/api/download-prd?sessionId=${extract.data.sessionId}`, {
      method: 'GET',
    });
    assert.equal(res.status, 404);
  });
});
