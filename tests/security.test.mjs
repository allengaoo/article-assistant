import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestServer,
  api,
  TEST_TOKEN,
  TEST_API_KEY,
  createMockServices,
} from './helpers/test-server.mjs';

describe('security: 测试环境不泄露真实凭证', () => {
  /** @type {Awaited<ReturnType<typeof startTestServer>>} */
  let ctx;
  let hadDashScopeBefore;

  before(async () => {
    hadDashScopeBefore = process.env.DASHSCOPE_API_KEY;
    process.env.DASHSCOPE_API_KEY = 'fake-local-dashscope-key-not-real';
    ctx = await startTestServer();
  });

  after(async () => {
    await ctx.close();
    if (hadDashScopeBefore === undefined) delete process.env.DASHSCOPE_API_KEY;
    else process.env.DASHSCOPE_API_KEY = hadDashScopeBefore;
  });

  it('启动测试服务后隔离真实 DASHSCOPE_API_KEY', () => {
    assert.equal(process.env.DASHSCOPE_API_KEY, undefined);
  });

  it('mock 服务不会调用外部 API', async () => {
    let calledWithKey = null;
    const services = createMockServices();
    services.generateOutline = async (_raw, apiKey) => {
      calledWithKey = apiKey;
      return '# mock';
    };

    const isolated = await startTestServer({ services });
    try {
      const extract = await api(isolated.baseUrl, '/api/extract', {
        body: { type: 'text', text: 'security check' },
      });
      await api(isolated.baseUrl, '/api/outline', {
        body: { sessionId: extract.data.sessionId },
      });
      assert.equal(calledWithKey, TEST_API_KEY);
      assert.notEqual(calledWithKey, 'fake-local-dashscope-key-not-real');
    } finally {
      await isolated.close();
    }
  });

  it('/api/my-token 需要 MASTER_KEY，测试环境未配置时应拒绝', async () => {
    const res = await api(ctx.baseUrl, '/api/my-token?master=wrong', { method: 'GET' });
    assert.equal(res.status, 401);
  });

  it('测试 token 为明显假值', () => {
    assert.match(TEST_TOKEN, /^test-/);
    assert.match(TEST_API_KEY, /^test-/);
  });
});
