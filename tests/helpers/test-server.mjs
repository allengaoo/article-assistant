import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../../webapp/create-app.mjs';
import { clearSessions } from '../../webapp/lib/session.mjs';
import { closeDb } from '../../webapp/lib/db.mjs';
import { setTestPlanLimitsOverride } from '../../webapp/lib/plans.mjs';

/** 仅用于测试的假凭证，不得与生产环境相同 */
export const TEST_TOKEN = 'test-token-ci-only';
export const TEST_API_KEY = 'test-api-key-not-real';
export const TEST_ADMIN_LOGIN = 'testadmin';
export const TEST_ADMIN_PASSWORD = 'test-admin-pass-ci';

const SENSITIVE_ENV_KEYS = [
  'DASHSCOPE_API_KEY',
  'ACCESS_TOKEN',
  'MASTER_KEY',
  'WX_APPID',
  'WX_APPSECRET',
  'FEISHU_APP_ID',
  'FEISHU_APP_SECRET',
  'SKYWORK_API_KEY',
];

const MOCK_OUTLINE_V1 = `# 测试文章标题

**一句话摘要**：用于 CI 的全流程测试摘要。

## 各章节

### 一、背景
写作方向：说明测试背景。

### 结尾钩子
下期预告设计：敬请期待。`;

const MOCK_OUTLINE_V2 = `# 测试文章标题（修订版）

**一句话摘要**：整合修改意见后的摘要。

## 各章节

### 一、背景
写作方向：修订后的背景说明。`;

const MOCK_ARTICLE = `---
title: CI 测试文章
author: 工程师的本体论
---

# CI 测试文章

正文段落用于验证全流程。`;

const MOCK_PRD_OUTLINE = `# PRD：测试产品

## 1. 背景
测试背景说明。`;

const MOCK_PRD_DOC = `---
title: CI 测试 PRD
---

# CI 测试 PRD

## 概述
PRD 正文用于验证下载流程。`;

export function createMockServices() {
  return {
    extractUrl: async (url) => `从 ${url} 提取的测试内容`,
    extractImage: async () => '图片 OCR 测试内容',
    extractVideo: async (url) => `从 ${url} 提取的字幕内容`,
    generateOutline: async (_raw, _key, history = []) =>
      history.length > 0 ? MOCK_OUTLINE_V2 : MOCK_OUTLINE_V1,
    generateArticle: async () => MOCK_ARTICLE,
    generatePrdOutline: async (_raw, _key, history = []) =>
      history.length > 0 ? `${MOCK_PRD_OUTLINE}\n\n（修订）` : MOCK_PRD_OUTLINE,
    generatePrdDocument: async () => MOCK_PRD_DOC,
    publishArticle: () => 'mock wechat publish ok',
  };
}

function isolateSensitiveEnv() {
  const saved = {};
  for (const key of SENSITIVE_ENV_KEYS) {
    if (process.env[key] !== undefined) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  }
  return saved;
}

function restoreSensitiveEnv(saved) {
  for (const key of SENSITIVE_ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
}

export async function startTestServer(options = {}) {
  const savedEnv = isolateSensitiveEnv();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gzh-test-data-'));
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = dataDir;
  process.env.ACCESS_TOKEN = TEST_TOKEN;
  process.env.ADMIN_LOGIN = TEST_ADMIN_LOGIN;
  process.env.ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;

  const app = createApp({
    accessToken: TEST_TOKEN,
    apiKey: TEST_API_KEY,
    skipRateLimit: true,
    services: createMockServices(),
    ...options,
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    server,
    dataDir,
    savedEnv,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      clearSessions();
      closeDb();
      setTestPlanLimitsOverride(null);
      fs.rmSync(dataDir, { recursive: true, force: true });
      delete process.env.DATA_DIR;
      restoreSensitiveEnv(savedEnv);
    },
  };
}

export async function api(baseUrl, path, { token = TEST_TOKEN, method = 'POST', body } = {}) {
  const headers = {};
  if (token) headers['x-access-token'] = token;
  let fetchBody;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    fetchBody = JSON.stringify(body);
  }

  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: fetchBody });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data, headers: res.headers };
}
