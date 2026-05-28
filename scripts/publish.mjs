#!/usr/bin/env node
/**
 * 公众号文章一键发布脚本
 *
 * 用法:
 *   node scripts/publish.mjs <article.md> [--dry-run] [--save-html]
 *
 * 选项:
 *   --dry-run    仅渲染 HTML，不调用任何微信 API
 *   --save-html  发布后将最终 HTML 保存到 <article-dir>/.out/article.html
 *
 * 环境变量（.env）:
 *   WX_APPID      微信公众号 AppID
 *   WX_APPSECRET  微信公众号 AppSecret
 *
 * front matter 字段:
 *   title         文章标题（必填）
 *   author        作者名
 *   digest        摘要（最多 128 字，不填则自动取正文前 54 字）
 *   cover         封面图路径或 URL（不填则自动用正文第一张图）
 *   enableComment 是否开放评论，true/false（默认 false）
 *
 * 流程:
 *   MD 解析 front matter
 *   → marked 转 HTML
 *   → cheerio 追加 inline 样式 + 视频链接 → 卡片
 *   → 上传正文图片到微信图床（替换 src）
 *   → 上传封面到永久素材（获取 media_id）
 *   → 压缩 HTML 为单行
 *   → draft/add 创建草稿
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import { config as loadDotenv } from 'dotenv';
import { renderToWeChat, compressHtml } from './lib/renderer.mjs';
import { processArticleImages, extractFirstImageSrc, processCover } from './lib/assets.mjs';
import { getAccessToken, addDraft } from './lib/wechat.mjs';

// ── 环境初始化 ───────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
loadDotenv({ path: resolve(PROJECT_ROOT, '.env') });

// ── CLI 参数解析 ─────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const isDryRun  = argv.includes('--dry-run');
const saveHtml  = argv.includes('--save-html');
const articleArg = argv.find(a => !a.startsWith('--'));

if (!articleArg) {
  die(
    '用法: node scripts/publish.mjs <article.md> [--dry-run] [--save-html]\n' +
    '示例: node scripts/publish.mjs articles/001-opening/article.md',
  );
}

const articlePath = resolve(process.cwd(), articleArg);
if (!existsSync(articlePath)) die(`文件不存在: ${articlePath}`);

const APPID     = process.env.WX_APPID;
const APPSECRET = process.env.WX_APPSECRET;
if (!isDryRun && (!APPID || !APPSECRET)) {
  die('缺少 WX_APPID 或 WX_APPSECRET，请在项目根目录的 .env 中配置');
}

// ── 主流程 ───────────────────────────────────────────────────────────────────

async function main() {
  const articleDir = dirname(articlePath);
  const raw = readFileSync(articlePath, 'utf-8');

  // ① front matter 解析
  const { data: fm, content: mdBody } = matter(raw);
  const title         = (fm.title ?? '').trim();
  const author        = (fm.author ?? '').trim();
  const digest        = (fm.digest ?? '').trim();
  const coverSrc      = fm.cover ? String(fm.cover).trim() : null;
  const enableComment = fm.enableComment ? 1 : 0;

  if (!title) die('front matter 缺少 title 字段');

  log('');
  log(`📄  ${title}`);
  log(`    作者: ${author || '（未指定）'}`);
  log(`    摘要: ${digest ? truncate(digest, 60) : '（自动取正文前 54 字）'}`);
  log(`    封面: ${coverSrc ?? '（自动取正文第一张图）'}`);

  // ② Markdown → 微信 HTML
  log('\n🔄  转换 Markdown...');
  let html = renderToWeChat(mdBody);
  log('    ✓ HTML 渲染完成');

  // ③ dry-run 模式：只输出 HTML，不调用 API
  if (isDryRun) {
    log('\n[--dry-run] 跳过所有 API 调用，输出 HTML 片段（前 3000 字）:\n');
    console.log(html.slice(0, 3000));
    if (html.length > 3000) log('\n... (内容较长，已截断)');
    return;
  }

  // ④ 获取 access_token
  log('\n🔑  获取 access_token...');
  const token = await getAccessToken(APPID, APPSECRET);
  log('    ✓');

  // ⑤ 上传正文图片（本地 + 远程）
  log('\n🖼   处理正文图片...');
  const firstImgSrc = extractFirstImageSrc(html); // 在上传前记录，供封面回退使用
  html = await processArticleImages(html, articleDir, token, msg => log(msg));

  // ⑥ 处理封面
  log('\n🖼   处理封面图...');
  let thumbMediaId;
  const effectiveCover = coverSrc ?? firstImgSrc;
  if (effectiveCover) {
    thumbMediaId = await processCover(effectiveCover, articleDir, token, msg => log(msg));
  } else if (process.env.WX_DEFAULT_THUMB_MEDIA_ID) {
    thumbMediaId = process.env.WX_DEFAULT_THUMB_MEDIA_ID;
    log(`  ✓ 使用默认封面 media_id: ${thumbMediaId}`);
  } else {
    die(
      '未找到封面图。解决方式（任选其一）：\n' +
      '  1. 在 front matter 中加 cover: https://... （公网图片 URL）\n' +
      '  2. 在正文中插入至少一张图片\n' +
      '  3. 在服务器 .env 中配置 WX_DEFAULT_THUMB_MEDIA_ID=<已上传的素材 media_id>'
    );
  }

  // ⑦ 压缩 HTML（避免微信编辑器插入多余空行）
  const finalHtml = compressHtml(html);

  // ⑧ 可选：保存 HTML 到本地
  if (saveHtml) {
    const outDir = join(articleDir, '.out');
    mkdirSync(outDir, { recursive: true });
    const outPath = join(outDir, 'article.html');
    writeFileSync(outPath, finalHtml, 'utf-8');
    log(`\n💾  HTML 已保存: ${outPath}`);
  }

  // ⑨ 统计字符数
  if (finalHtml.length > 20_000) {
    log(`\n⚠   HTML 超过 2 万字符限制（当前 ${finalHtml.length} 字符），请精简内容`);
    process.exit(1);
  }

  // ⑩ 创建草稿
  log('\n📤  创建草稿...');
  const article = {
    title,
    ...(author  && { author }),
    ...(digest  && { digest }),
    content:           finalHtml,
    thumb_media_id:    thumbMediaId,
    need_open_comment: enableComment,
    only_fans_can_comment: 0,
  };

  const mediaId = await addDraft(token, article);

  log(`\n✅  草稿创建成功！`);
  log(`    media_id : ${mediaId}`);
  log(`    字符数   : ${finalHtml.length}`);
  log(`    → 前往草稿箱预览并发布: https://mp.weixin.qq.com\n`);
}

// ── 工具函数 ─────────────────────────────────────────────────────────────────

function log(msg)  { console.log(msg); }
function die(msg)  { console.error(`\n❌  ${msg}\n`); process.exit(1); }
function truncate(s, n) { return s.length > n ? s.slice(0, n - 3) + '...' : s; }

// ── 执行 ─────────────────────────────────────────────────────────────────────

main().catch(err => die(err.message));
