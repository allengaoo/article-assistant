/**
 * 图片与封面资源处理
 *
 * processArticleImages — 扫描 HTML 中所有 <img>，上传到微信图床，替换 src
 * processCover         — 上传封面图到微信永久素材，返回 media_id
 * extractFirstImageSrc — 从 HTML 中提取第一张图片的原始 src（用于自动封面）
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, basename, extname } from 'node:path';
import { load as cheerioLoad } from 'cheerio';
import { uploadArticleImage, uploadPermanentMaterial } from './wechat.mjs';

// 已是微信图床的 URL，不重复上传
const WX_CDN_HOSTS = ['mmbiz.qpic.cn', 'mmbiz.qlogo.cn'];

// ── 正文图片 ─────────────────────────────────────────────────────────────────

/**
 * 上传 HTML 片段中所有 <img> 的图片到微信图床，替换 src。
 * @param {string} html        - 渲染后的 HTML 片段
 * @param {string} articleDir  - 文章所在目录（用于解析本地相对路径）
 * @param {string} token       - access_token
 * @param {(msg:string)=>void} log
 * @returns {Promise<string>} 替换 src 后的 HTML 片段
 */
export async function processArticleImages(html, articleDir, token, log) {
  const $ = cheerioLoad(html, { decodeEntities: false });
  const imgEls = [];
  $('img').each((_, el) => imgEls.push(el));

  for (const el of imgEls) {
    const src = $(el).attr('src') ?? '';
    if (!src || src.startsWith('data:') || isWxCdn(src)) continue;

    try {
      log(`  ↑ 图片: ${truncate(src, 60)}`);
      const { buffer, filename } = await fetchAsset(src, articleDir);
      const wxUrl = await uploadArticleImage(token, buffer, safeFilename(filename));
      $(el).attr('src', wxUrl);
      log(`  ✓ ${truncate(wxUrl, 60)}`);
    } catch (err) {
      log(`  ⚠ 跳过（${err.message}）: ${truncate(src, 50)}`);
      // 上传失败不中断流程，保留原 src（发布后该图会显示异常）
    }
  }

  return $('body').html() ?? '';
}

/**
 * 从 HTML 片段中提取第一张 <img> 的 src（上传前的原始路径）。
 * 用于在 front matter 未指定 cover 时自动选取封面。
 */
export function extractFirstImageSrc(html) {
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match?.[1] ?? null;
}

// ── 封面图 ───────────────────────────────────────────────────────────────────

/**
 * 上传封面图到微信永久素材，返回 media_id。
 * coverSrc 可以是本地路径或 http(s):// URL。
 */
export async function processCover(coverSrc, articleDir, token, log) {
  log(`  ↑ 封面: ${truncate(coverSrc, 60)}`);
  const { buffer, filename } = await fetchAsset(coverSrc, articleDir);
  const result = await uploadPermanentMaterial(token, buffer, safeFilename(filename));
  log(`  ✓ media_id: ${result.media_id}`);
  return result.media_id;
}

// ── 通用资源获取 ─────────────────────────────────────────────────────────────

/**
 * 获取本地文件或远程 URL 的 buffer + filename。
 */
async function fetchAsset(src, baseDir) {
  if (src.startsWith('http://') || src.startsWith('https://')) {
    const res = await fetch(src, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WxPublisher/1.0)' },
      signal: AbortSignal.timeout(30_000),
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    // 从 URL 推断文件名
    const urlPath = new URL(src).pathname;
    const filename = basename(urlPath) || 'image.jpg';
    return { buffer, filename };
  }

  // 本地路径（支持 ./images/x.png 或 /abs/path/x.png）
  const absPath = src.startsWith('/') ? src : resolve(baseDir, src);
  if (!existsSync(absPath)) throw new Error(`本地文件不存在: ${absPath}`);
  return { buffer: readFileSync(absPath), filename: basename(absPath) };
}

// ── utils ─────────────────────────────────────────────────────────────────────

function isWxCdn(url) {
  return WX_CDN_HOSTS.some(h => url.includes(h));
}

/** 保证文件名有合法图片扩展名 */
function safeFilename(filename) {
  const ext = extname(filename).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) return filename;
  return filename + '.jpg';
}

function truncate(str, n) {
  return str.length > n ? str.slice(0, n - 3) + '...' : str;
}
