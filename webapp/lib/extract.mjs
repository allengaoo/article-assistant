/**
 * Content extraction from 4 input types.
 * URL      : 直接 fetch + cheerio 解析正文（无境外依赖，适配大陆 ECS）
 * Image    : 阿里云百炼 qwen-vl-max（DashScope OpenAI-compatible API）
 * Video    : yt-dlp 本地提取字幕（仅支持 B 站等国内平台）
 * Text     : 直接使用用户输入
 */
import OpenAI from 'openai';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fromURL } from 'cheerio';

const MAX_CHARS = 14000;
const DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

/**
 * 直接抓取目标页面并用 cheerio 提取正文，无需任何境外中间服务。
 */
export async function extractUrl(url) {
  const $ = await fromURL(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; GZHBot/2.0)',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
  });

  // 移除噪声节点
  $('script, style, nav, header, footer, aside, .ad, .ads, .advertisement, [class*="sidebar"]').remove();

  // 按优先级取语义化正文容器
  const candidates = [
    'article', 'main', '[role="main"]',
    '.post-content', '.article-content', '.article-body',
    '.content', '#content', '#main',
    'body',
  ];
  let text = '';
  for (const sel of candidates) {
    const el = $(sel).first();
    if (el.length) {
      text = el.text().replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
      if (text.length > 200) break;
    }
  }

  if (text.length < 50) {
    throw new Error('无法从该页面提取到足够内容，建议改用「文字」输入方式手动粘贴原文');
  }
  return text.slice(0, MAX_CHARS);
}

/**
 * Extract content from an image using qwen-vl-max (vision-language model).
 */
export async function extractImage(filePath, apiKey) {
  const openai = new OpenAI({ apiKey, baseURL: DASHSCOPE_BASE_URL });

  const imageBytes = fs.readFileSync(filePath);
  const base64 = imageBytes.toString('base64');

  // Detect mime type by magic bytes
  const header = imageBytes.subarray(0, 4).toString('hex');
  let mimeType = 'image/jpeg';
  if (header.startsWith('89504e47')) mimeType = 'image/png';
  else if (header.startsWith('47494638')) mimeType = 'image/gif';
  else if (header.startsWith('52494646')) mimeType = 'image/webp';

  const res = await openai.chat.completions.create({
    model: 'qwen-vl-max',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: `data:${mimeType};base64,${base64}` },
          },
          {
            type: 'text',
            text: '请详细描述这张图片的内容。提取其中所有文字信息、数据、图表含义和核心观点。如果图片是截图或文章，请完整还原其文字内容。用中文回答，尽量完整详尽。',
          },
        ],
      },
    ],
  });

  return res.choices[0].message.content.trim();
}

/**
 * 从视频 URL 提取字幕文本（通过 yt-dlp）。
 * 仅支持国内可访问的平台：B 站、西瓜视频等有字幕的视频。
 * YouTube 在大陆服务器上不可访问，请勿使用。
 */
export async function extractVideo(videoUrl) {
  const isBilibili = /bilibili\.com|b23\.tv/i.test(videoUrl);
  const isXigua = /ixigua\.com/i.test(videoUrl);
  const isYoutube = /youtube\.com|youtu\.be/i.test(videoUrl);

  if (isYoutube) {
    throw new Error('YouTube 在服务器上无法访问，请改用 B 站视频，或将字幕/文字内容复制后用「文字」方式输入');
  }
  if (!isBilibili && !isXigua) {
    // 其他平台给出提示但仍尝试，让 yt-dlp 自行判断
    console.warn(`[extractVideo] 非主流平台，尝试提取: ${videoUrl}`);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gzh-ytdlp-'));
  try {
    try {
      execSync(
        `yt-dlp \
          --write-auto-sub \
          --write-sub \
          --sub-langs "zh-Hans,zh,en" \
          --sub-format vtt \
          --skip-download \
          --no-playlist \
          --output "${tmpDir}/vid" \
          "${videoUrl}"`,
        { timeout: 90_000, stdio: 'pipe' }
      );
    } catch (e) {
      const msg = e.stderr?.toString() || e.message || '';
      if (/unable to download|HTTP Error 4|sign in|Private video/i.test(msg)) {
        throw new Error('视频无法访问，可能需要登录或视频不公开');
      }
      if (/network|timed out|connection/i.test(msg)) {
        throw new Error('视频平台连接失败，请确认使用的是 B 站等国内平台的链接');
      }
      throw new Error(`视频提取失败：${msg.slice(0, 100) || '未知错误'}`);
    }

    const files = fs.readdirSync(tmpDir);
    const subFile = files.find((f) => f.endsWith('.vtt') || f.endsWith('.srt'));
    if (!subFile) {
      throw new Error('该视频没有可用字幕，建议选择有「CC 字幕」标识的 B 站视频，或改用「文字」方式粘贴文稿');
    }

    const raw = fs.readFileSync(path.join(tmpDir, subFile), 'utf-8');
    return cleanSubtitles(raw).slice(0, MAX_CHARS);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function cleanSubtitles(raw) {
  return raw
    .replace(/^WEBVTT.*$/m, '')
    .replace(/\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[.,]\d{3}[^\n]*/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/^\d+\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
