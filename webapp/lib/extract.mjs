/**
 * Content extraction from 4 input types.
 * Image understanding: Alibaba Cloud Bailian qwen-vl-max (OpenAI-compatible API)
 * URL extraction: Jina Reader (free, no key needed)
 * Video subtitles: yt-dlp
 */
import OpenAI from 'openai';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const JINA_MAX_CHARS = 14000;
const DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

/**
 * Extract article content from a URL via Jina Reader.
 */
export async function extractUrl(url) {
  const jinaUrl = `https://r.jina.ai/${url}`;
  const resp = await fetch(jinaUrl, {
    headers: { Accept: 'text/plain', 'X-Return-Format': 'markdown' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) throw new Error(`Jina Reader 请求失败 (${resp.status})`);
  const text = await resp.text();
  return text.slice(0, JINA_MAX_CHARS);
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
 * Extract subtitles from a video URL using yt-dlp.
 * Supports YouTube, Bilibili (with subtitles).
 */
export async function extractVideo(videoUrl) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gzh-ytdlp-'));
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

    const files = fs.readdirSync(tmpDir);
    const subFile = files.find((f) => f.endsWith('.vtt') || f.endsWith('.srt'));
    if (!subFile) throw new Error('该视频没有可用字幕，无法提取内容');

    const raw = fs.readFileSync(path.join(tmpDir, subFile), 'utf-8');
    return cleanSubtitles(raw).slice(0, JINA_MAX_CHARS);
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
