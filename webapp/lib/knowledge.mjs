/**
 * 知识库模块
 *
 * 数据目录结构：
 *   data/knowledge/
 *     daily/YYYY-MM-DD.json   每日对话汇总（由 /api/daily-summary 生成）
 *     notes.json              从汇总中提炼出的知识条目（滚动保留最近 200 条）
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';

const DATA_DIR = process.env.DATA_DIR || path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../data',
);
const KNOWLEDGE_DIR = path.join(DATA_DIR, 'knowledge');
const DAILY_DIR     = path.join(KNOWLEDGE_DIR, 'daily');
const NOTES_FILE    = path.join(KNOWLEDGE_DIR, 'notes.json');

const BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const MAX_NOTES = 200;

function ensureDirs() {
  fs.mkdirSync(DAILY_DIR, { recursive: true });
}

// ── 读取知识条目 ──────────────────────────────────────────────────────────────

/**
 * 读取最近 N 条知识条目，作为可选上下文。
 * @param {number} limit 默认 20，避免上下文过长
 */
export function loadNotes(limit = 20) {
  if (!fs.existsSync(NOTES_FILE)) return [];
  try {
    const all = JSON.parse(fs.readFileSync(NOTES_FILE, 'utf-8'));
    // 取最新的 limit 条
    return all.slice(-limit);
  } catch {
    return [];
  }
}

/**
 * 读取最近 N 天的每日汇总摘要（不含知识条目，只含统计信息）。
 * @param {number} days 默认 7
 */
export function loadRecentSummaries(days = 7) {
  if (!fs.existsSync(DAILY_DIR)) return [];
  return fs.readdirSync(DAILY_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .slice(-days)
    .flatMap((f) => {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(DAILY_DIR, f), 'utf-8'));
        // 只返回轻量摘要，不含原始 session 内容
        return [{
          date: d.date,
          sessionCount: d.sessionCount,
          topicKeywords: d.topicKeywords,
          contentPreferences: d.contentPreferences,
        }];
      } catch {
        return [];
      }
    });
}

// ── 每日汇总生成 ──────────────────────────────────────────────────────────────

/**
 * 调用通义千问对今日 sessions 进行汇总，提取知识条目，写入磁盘。
 * @param {object[]} sessions  从 persistence.loadSessionsForDate() 获取
 * @param {string}   apiKey    DashScope API Key
 * @param {string}   date      'YYYY-MM-DD'
 */
export async function generateAndSaveDailySummary(sessions, apiKey, date) {
  ensureDirs();

  if (sessions.length === 0) {
    const empty = { date, sessionCount: 0, note: '今日无对话记录' };
    fs.writeFileSync(path.join(DAILY_DIR, `${date}.json`), JSON.stringify(empty, null, 2));
    return empty;
  }

  const sessionSummaries = sessions.map((s, i) => {
    const parts = [`[${i + 1}] 模式:${s.mode === 'prd' ? 'PRD' : '公众号文章'}`];
    if (s.inputType) parts.push(`输入类型:${s.inputType}`);
    if (s.rawContent) parts.push(`内容摘要:${s.rawContent.slice(0, 400)}`);
    if (s.currentOutline) parts.push(`最终大纲:${s.currentOutline.slice(0, 300)}`);
    if (s.articleTitle) parts.push(`文章标题:${s.articleTitle}`);
    parts.push(`大纲修改次数:${s.outlineRounds}  是否发布:${s.published}`);
    return parts.join(' | ');
  }).join('\n');

  const prompt = `以下是 ${date} 共 ${sessions.length} 次内容创作的记录：

${sessionSummaries}

请分析并输出 JSON（严格遵守格式，不要 markdown 代码块）：
{
  "date": "${date}",
  "sessionCount": ${sessions.length},
  "topicKeywords": ["关键词1", "关键词2"],
  "inputTypes": { "url": 0, "text": 0, "image": 0, "video": 0 },
  "contentPreferences": "一句话描述用户的内容偏好",
  "writingPatterns": ["观察到的写作模式或规律，若无则空数组"],
  "knowledgeNotes": ["值得记录的知识条目，简短，若无则空数组"]
}`;

  const openai = new OpenAI({ apiKey, baseURL: BASE_URL });
  const res = await openai.chat.completions.create({
    model: 'qwen-max',
    messages: [
      { role: 'system', content: '你是数据分析助手，分析内容创作记录并提取规律，输出严格 JSON。' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.3,
  });

  let summary;
  try {
    // 兼容模型偶尔输出 ```json ... ```
    const raw = res.choices[0].message.content.trim()
      .replace(/^```json\s*/i, '').replace(/\s*```$/, '');
    summary = JSON.parse(raw);
  } catch {
    summary = {
      date,
      sessionCount: sessions.length,
      topicKeywords: [],
      knowledgeNotes: [],
      raw: res.choices[0].message.content,
    };
  }

  // 写入每日汇总文件
  fs.writeFileSync(path.join(DAILY_DIR, `${date}.json`), JSON.stringify(summary, null, 2));

  // 将新知识条目追加到 notes.json（滚动截断）
  if (summary.knowledgeNotes?.length > 0) {
    const existing = fs.existsSync(NOTES_FILE)
      ? JSON.parse(fs.readFileSync(NOTES_FILE, 'utf-8') || '[]')
      : [];
    const newEntries = summary.knowledgeNotes.map((note) => ({ date, note }));
    const updated = [...existing, ...newEntries].slice(-MAX_NOTES);
    fs.writeFileSync(NOTES_FILE, JSON.stringify(updated, null, 2));
  }

  return summary;
}

// ── 磁盘用量相关 ──────────────────────────────────────────────────────────────

/** 列出所有每日汇总文件，按日期升序（最旧在前）。 */
export function listDailySummaryFiles() {
  if (!fs.existsSync(DAILY_DIR)) return [];
  return fs.readdirSync(DAILY_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => path.join(DAILY_DIR, f));
}
