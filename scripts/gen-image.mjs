#!/usr/bin/env node
/**
 * Skywork AI 图片生成脚本
 *
 * 用法:
 *   node scripts/gen-image.mjs --prompt "提示词" --output cover.jpg [选项]
 *
 * 选项:
 *   --prompt   / -p   图片描述（必填）
 *   --output   / -o   输出文件路径（必填，如 articles/001-opening/cover.jpg）
 *   --ratio    / -r   宽高比: 1:1 | 3:4 | 4:3 | 16:9 | 9:16 | ...（默认 16:9）
 *   --quality  / -q   质量: 1K | 2K | 4K（默认 2K）
 *
 * 常用宽高比参考:
 *   16:9  → 公众号首图封面（900×500）
 *   3:4   → 竖版配图
 *   1:1   → 正方形配图
 *   4:3   → 横版配图
 *
 * 示例:
 *   node scripts/gen-image.mjs \
 *     --prompt "极简科技风封面，蓝色几何图形，标题区域留白，工程师本体论概念" \
 *     --output articles/001-opening/cover.jpg \
 *     --ratio 16:9
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(__dirname, '..', '.env') });

const SKYWORK_BASE = 'https://api-tools.skywork.ai/theme-gateway';

// ── CLI 参数解析 ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const get = (flags) => {
  for (const f of flags) {
    const i = args.indexOf(f);
    if (i !== -1) return args[i + 1];
  }
  return null;
};

const prompt  = get(['--prompt', '-p']);
const output  = get(['--output', '-o']);
const ratio   = get(['--ratio',  '-r']) ?? '16:9';
const quality = get(['--quality', '-q']) ?? '2K';

if (!prompt || !output) {
  console.error('用法: node scripts/gen-image.mjs --prompt "描述" --output path/to/image.jpg');
  process.exit(1);
}

const API_KEY = process.env.SKYWORK_API_KEY;
if (!API_KEY) {
  console.error('缺少 SKYWORK_API_KEY，请在 .env 中配置');
  process.exit(1);
}

// ── SSE 流解析 ───────────────────────────────────────────────────────────────

async function* parseSSE(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let curEvent = null;
  let curData = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    const lines = buf.split('\n');
    buf = lines.pop(); // 保留最后一行（可能不完整）

    for (const raw of lines) {
      const line = raw.replace(/\r$/, '');
      if (line === '') {
        // 空行 = 事件结束
        if (curEvent && curData !== null) {
          yield { event: curEvent, data: JSON.parse(curData) };
        }
        curEvent = null;
        curData = null;
      } else if (line.startsWith('event:')) {
        curEvent = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        curData = line.slice(5).trim();
      }
    }
  }
}

// ── 图片生成主函数 ───────────────────────────────────────────────────────────

async function generateImage() {
  const body = {
    title: prompt.slice(0, 60),
    content: prompt,
    style: { aspect_ratio: ratio },
    options: { resolution: quality },
    source_platform: '',
  };

  console.log(`\n🎨  生成图片...`);
  console.log(`    描述: ${prompt.slice(0, 80)}`);
  console.log(`    宽高比: ${ratio}  质量: ${quality}`);
  console.log(`    预计耗时 30–120 秒，请稍候...\n`);

  const res = await fetch(`${SKYWORK_BASE}/api/sse/image/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API 错误 HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  let fileUrl = null;

  for await (const { event, data } of parseSSE(res.body)) {
    if (event === 'progress') {
      const pct = Math.round(data.percentage ?? 0);
      const msg = data.message ?? '';
      process.stdout.write(`\r    [${pct}%] ${msg.padEnd(40)}`);
    } else if (event === 'success') {
      fileUrl = data.file_url;
      console.log('\n');
    } else if (event === 'error') {
      throw new Error(`Skywork 返回错误: ${data.message ?? JSON.stringify(data)}`);
    }
  }

  if (!fileUrl) throw new Error('未收到图片 URL，请重试');
  return fileUrl;
}

async function downloadFile(url, dest) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const absPath = resolve(process.cwd(), dest);
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, buf);
  return absPath;
}

// ── 执行 ─────────────────────────────────────────────────────────────────────

(async () => {
  try {
    const fileUrl = await generateImage();
    const absPath = await downloadFile(fileUrl, output);
    console.log(`✅  图片已保存:`);
    console.log(`    本地路径: ${absPath}`);
    console.log(`    CDN URL:  ${fileUrl}\n`);
  } catch (err) {
    console.error(`\n❌  生成失败: ${err.message}`);
    process.exit(1);
  }
})();
