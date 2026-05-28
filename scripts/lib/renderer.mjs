/**
 * Markdown → 微信公众号兼容 HTML
 *
 * 策略：
 *   1. marked 生成原始 HTML（默认渲染器，简单可靠）
 *   2. cheerio 后处理：为每个元素追加 inline style
 *   3. 识别视频链接并渲染为卡片
 *   4. 返回 body 片段（不含 <html>/<head>/<body> 标签）
 */

import { marked } from 'marked';
import { load as cheerioLoad } from 'cheerio';

// ── 微信移动端 inline 样式 ───────────────────────────────────────────────────

const S = {
  h1: 'font-size:22px;font-weight:bold;color:#1a1a1a;line-height:1.4;margin:1.5em 0 0.6em;padding-left:12px;border-left:4px solid #1a73e8;',
  h2: 'font-size:20px;font-weight:bold;color:#1a1a1a;line-height:1.4;margin:1.5em 0 0.6em;padding-left:12px;border-left:4px solid #1a73e8;',
  h3: 'font-size:17px;font-weight:bold;color:#333;line-height:1.4;margin:1.2em 0 0.4em;',
  h4: 'font-size:15px;font-weight:bold;color:#555;line-height:1.4;margin:1em 0 0.3em;',
  p:  'line-height:1.8;color:#333;margin:0 0 0.8em;',
  strong: 'font-weight:bold;color:#1a1a1a;',
  em:     'font-style:italic;',
  a:      'color:#1a73e8;text-decoration:none;word-break:break-all;',
  blockquote: 'border-left:4px solid #1a73e8;background:#f0f7ff;margin:1em 0;padding:0.8em 1em;color:#555;',
  ul: 'padding-left:1.5em;margin:0.5em 0;list-style-type:disc;',
  ol: 'padding-left:1.5em;margin:0.5em 0;list-style-type:decimal;',
  li: 'line-height:1.8;color:#333;margin:0.2em 0;',
  // 表格
  table: 'width:100%;border-collapse:collapse;margin:1em 0;font-size:14px;',
  th: 'background:#1a73e8;color:#fff;padding:8px 12px;text-align:left;font-weight:bold;border:1px solid #1565c0;',
  td: 'border:1px solid #ddd;padding:8px 12px;color:#333;vertical-align:top;',
  // 代码
  pre:          'background:#1e1e1e;color:#d4d4d4;padding:16px;border-radius:6px;margin:1em 0;' +
                'font-size:13px;line-height:1.6;font-family:Consolas,Monaco,"Courier New",monospace;' +
                'white-space:pre-wrap;word-break:break-all;overflow-x:auto;',
  preCode:      'background:none;color:inherit;padding:0;font-size:inherit;font-family:inherit;',
  codeInline:   'background:#f5f5f5;color:#c7254e;padding:2px 5px;border-radius:3px;' +
                'font-family:Consolas,Monaco,monospace;font-size:90%;',
  // 图片
  img: 'max-width:100%;height:auto;display:block;margin:0.8em auto;',
  hr:  'border:none;border-top:2px dashed #ddd;margin:1.5em 0;',
};

// ── 视频域名检测 ─────────────────────────────────────────────────────────────

const VIDEO_DOMAINS = [
  'youtube.com', 'youtu.be',
  'bilibili.com',
  'v.qq.com',
  'vimeo.com',
  'iqiyi.com',
  'youku.com',
  'douyin.com',
];
const VIDEO_EXT_RE = /\.(mp4|webm|mov|avi|flv|m3u8)(\?|$)/i;

function isVideoUrl(url) {
  if (!url) return false;
  return VIDEO_DOMAINS.some(d => url.includes(d)) || VIDEO_EXT_RE.test(url);
}

function videoCard(href, label) {
  const title = (label && label !== href) ? label : '点击观看视频';
  return (
    `<section style="border:1px solid #e0e0e0;border-radius:8px;padding:14px 16px;` +
    `margin:1em 0;background:#f9f9f9;">` +
    `<a href="${escAttr(href)}" style="color:#1a73e8;text-decoration:none;display:block;">` +
    `<p style="margin:0 0 6px;font-weight:bold;font-size:15px;color:#1a1a1a;">🎬 ${title}</p>` +
    `<p style="margin:0;font-size:12px;color:#888;word-break:break-all;">${escHtml(href)}</p>` +
    `</a></section>`
  );
}

// ── 主函数 ───────────────────────────────────────────────────────────────────

/**
 * 将 Markdown 字符串转为微信公众号可用 HTML 片段。
 * 图片 src 保持原始值，后续由 assets.mjs 上传替换。
 */
export function renderToWeChat(markdown) {
  // Step 1: marked 默认渲染
  const rawHtml = marked.parse(markdown, { async: false });

  // Step 2: cheerio 后处理
  const $ = cheerioLoad(rawHtml, { decodeEntities: false });

  // 标题
  for (const tag of ['h1', 'h2', 'h3', 'h4']) {
    $(tag).each((_, el) => $(el).attr('style', S[tag] ?? S.h4));
  }

  // 段落（排除 blockquote 内的 p，避免双层 margin）
  $('p').not('blockquote p').each((_, el) => $(el).attr('style', S.p));
  $('blockquote p').each((_, el) => $(el).attr('style', 'margin:0 0 0.4em;font-size:15px;line-height:1.8;color:#555;'));

  // 行内格式
  $('strong').each((_, el) => $(el).attr('style', S.strong));
  $('em').each((_, el) => $(el).attr('style', S.em));

  // 列表
  $('ul').each((_, el) => $(el).attr('style', S.ul));
  $('ol').each((_, el) => $(el).attr('style', S.ol));
  $('li').each((_, el) => $(el).attr('style', S.li));

  // 引用
  $('blockquote').each((_, el) => $(el).attr('style', S.blockquote));

  // 表格（zebra stripe 用 JS 无法做，直接统一颜色）
  $('table').each((_, el) => $(el).attr('style', S.table));
  $('th').each((_, el) => $(el).attr('style', S.th));
  $('td').each((_, el) => $(el).attr('style', S.td));

  // 代码块（pre > code）
  $('pre').each((_, el) => {
    $(el).attr('style', S.pre);
    $(el).find('code').attr('style', S.preCode);
  });

  // 行内 code（不在 pre 内）
  $('code').not('pre code').each((_, el) => $(el).attr('style', S.codeInline));

  // 图片
  $('img').each((_, el) => {
    const src = $(el).attr('src') ?? '';
    if (isVideoUrl(src)) {
      // 使用 ![alt](video-url) 语法嵌入视频 → 渲染为卡片
      const label = $(el).attr('alt') ?? '';
      const $parent = $(el).parent();
      if ($parent.is('p')) {
        $parent.replaceWith(videoCard(src, label));
      } else {
        $(el).replaceWith(videoCard(src, label));
      }
    } else {
      $(el).attr('style', S.img);
    }
  });

  // 链接：视频链接 → 卡片；普通链接 → 加样式
  $('a').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    if (isVideoUrl(href)) {
      const label = $(el).text().trim();
      const $parent = $(el).parent();
      // 若整段只有这一个视频链接，替换整段为卡片
      if ($parent.is('p') && $parent.children().length === 1) {
        $parent.replaceWith(videoCard(href, label));
      } else {
        // 行内：加图标前缀
        $(el).attr('style', S.a);
        $(el).prepend('🎬 ');
      }
    } else {
      $(el).attr('style', S.a);
    }
  });

  // 分割线
  $('hr').each((_, el) => $(el).attr('style', S.hr));

  return $('body').html() ?? '';
}

/**
 * 将 HTML 压缩为单行（避免微信编辑器插入多余空行）。
 * pre 代码块内容先临时替换，压缩后再还原。
 */
export function compressHtml(html) {
  const stash = [];
  let out = html.replace(/<pre[\s\S]*?<\/pre>/gi, match => {
    stash.push(match);
    return `\x00PRE${stash.length - 1}\x00`;
  });
  out = out.replace(/\n\s*/g, '').replace(/>\s+</g, '><');
  out = out.replace(/\x00PRE(\d+)\x00/g, (_, i) => stash[+i]);
  return out.trim();
}

// ── utils ────────────────────────────────────────────────────────────────────

function escAttr(str) { return str.replace(/"/g, '&quot;'); }
function escHtml(str) { return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
