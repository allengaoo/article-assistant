#!/usr/bin/env node
/**
 * 飞书文档发布脚本（本地执行）
 * 用法：node scripts/feishu-publish.mjs <prd.md 路径>
 *
 * 凭证从本地 .env 读取（FEISHU_APP_ID / FEISHU_APP_SECRET）
 * 执行后打印飞书文档链接，在浏览器或飞书 App 中打开即可查看。
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// 加载本地 .env（凭证只在本地，不上服务器）
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env') });

import { createDocument, writeBlocks, setPublicReadable } from './feishu.mjs';

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('用法: node scripts/feishu-publish.mjs <prd.md 路径>');
    process.exit(1);
  }

  if (!process.env.FEISHU_APP_ID || !process.env.FEISHU_APP_SECRET) {
    console.error('错误: 请在本地 .env 中配置 FEISHU_APP_ID 和 FEISHU_APP_SECRET');
    process.exit(1);
  }

  const mdPath = resolve(process.cwd(), filePath);
  const markdown = readFileSync(mdPath, 'utf-8');

  // 从 front matter 或第一个 # 标题提取文档标题
  const frontTitle = markdown.match(/^title:\s*(.+)$/m)?.[1]?.trim();
  const h1Title    = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const title = frontTitle || h1Title || '未命名 PRD';

  console.log(`\n创建飞书文档：《${title}》`);

  const { docId, url } = await createDocument(title);
  console.log(`文档已创建，正在写入内容...`);

  await writeBlocks(docId, markdown);
  console.log(`内容写入完成`);

  await setPublicReadable(docId).catch(() => {});
  console.log(`权限设置完成\n`);

  console.log('─'.repeat(50));
  console.log(`飞书文档链接：`);
  console.log(`  ${url}`);
  console.log('─'.repeat(50));
  console.log(`在浏览器打开后可分享给团队，或在飞书 App 中查看编辑。\n`);
}

main().catch((e) => {
  console.error('发布失败:', e.message);
  process.exit(1);
});
