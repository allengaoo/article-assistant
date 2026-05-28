/**
 * 内容生成：阿里云百炼（DashScope）OpenAI 兼容接口
 * 使用模型：
 *   - qwen3.7-max  → 文章大纲、全文、PRD 文档（长文本、高质量）
 */
import OpenAI from 'openai';

const BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const MODEL = 'qwen3.7-max';

const SYSTEM_PROMPT = `你是「工程师的本体论」微信公众号的撰稿人。

## 账号定位
资深全栈工程师 / 架构师视角，关注 Palantir Ontology 与 AI 工程落地的本质问题。
目标读者：中高级工程师、技术架构师、数字化转型从业者。

## 写作风格
- 批判性思维：敢于质疑流行概念，落脚在"如何解决工程问题"
- 具体 > 抽象：每个论点必须附实例、数据或比喻
- 节奏感：短句破题 → 长句展开 → 短句收尾，段落不超过 150 字
- 客观工程师视角：不以"我"开头，不用第一人称叙述

## 写作禁忌
- 禁止使用：赋能、落地、闭环、颠覆、革命
- 每段最多出现 2 个英文术语，避免术语堆砌
- 禁止超过 3 行的无列表长段落

## 文章结构
开篇(Hook) → 破题(Problem) → 概念(Concept) → 论证(Argument) → 升华(Insight) → 结尾(Hook Out + 下期悬念)`;

function client(apiKey) {
  return new OpenAI({ apiKey, baseURL: BASE_URL, timeout: 120_000 });
}

/**
 * Generate an article outline.
 * @param {string} rawContent
 * @param {string} apiKey
 * @param {Array<{outline:string, feedback:string}>} history
 */
export async function generateOutline(rawContent, apiKey, history = []) {
  const openai = client(apiKey);

  let userPrompt;
  if (history.length === 0) {
    userPrompt = `以下是从原始资料中提取的核心内容：

---
${rawContent}
---

请基于上述内容，为「工程师的本体论」公众号生成一篇文章的写作大纲。

大纲格式（严格遵守）：

# [文章标题]（吸引工程师的标题，不超过20字）

**一句话摘要**：（50字以内，用于公众号列表简介）

## 各章节

### 一、[章节标题]
写作方向：（2-3句说明本节要表达的核心观点和论证思路）

### 二、[章节标题]
写作方向：...

（共3-6个章节）

### 结尾钩子
下期预告设计：（一句引发好奇的悬念）

直接输出大纲，不要任何解释或前缀。`;
  } else {
    const rounds = history
      .map((h, i) => `【第${i + 1}稿大纲】\n${h.outline}\n\n【用户修改意见】\n${h.feedback}`)
      .join('\n\n---\n\n');

    userPrompt = `原始资料内容：

---
${rawContent}
---

${rounds}

请根据最新的修改意见，重新生成优化后的大纲。格式同上，直接输出大纲，不要解释。`;
  }

  const res = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.7,
  });

  return res.choices[0].message.content.trim();
}

/**
 * Generate the full article from a confirmed outline.
 * @param {string} rawContent
 * @param {string} confirmedOutline
 * @param {string} apiKey
 */
export async function generateArticle(rawContent, confirmedOutline, apiKey) {
  const openai = client(apiKey);

  const userPrompt = `原始参考资料：

---
${rawContent}
---

已确认的文章大纲：

---
${confirmedOutline}
---

请严格按照大纲结构，撰写完整的公众号正文。

要求：
1. 严格遵循大纲章节结构，不得跳过或合并章节
2. 正文总字数 2000-3500 字（不含表格/代码块）
3. 每个主要论点配 1 个具体案例、数据或代码示例
4. 全文至少出现 1-2 个可独立截图传播的金句（用 **加粗** 标注）
5. 结尾章节必须包含下期悬念钩子

输出格式为完整 Markdown，文件最顶部包含 YAML front matter：

---
title: （从大纲标题获取，不加引号）
author: 工程师的本体论
digest: （大纲一句话摘要，不加引号）
enableComment: true
---

直接输出完整 Markdown 内容，不要任何额外解释。`;

  const res = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.7,
  });

  return res.choices[0].message.content.trim();
}

// ── PRD 文档生成 ──────────────────────────────────────────────────────────────

const PRD_SYSTEM = `你是一名经验丰富的产品经理，擅长撰写清晰、结构化的 PRD（产品需求文档）。
写作要求：
- 语言简洁，每个需求点可落地验收
- 功能需求用用户故事格式：「作为 [角色]，我希望 [功能]，以便 [价值]」
- 非功能需求必须量化（响应时间、并发量、可用性等）
- 技术方案部分点到为止，不过度设计
- 里程碑按优先级（P0/P1/P2）划分`;

export async function generatePrdOutline(rawContent, apiKey, history = []) {
  const openai = client(apiKey);
  let userPrompt;
  if (history.length === 0) {
    userPrompt = `以下是产品需求的原始输入（可能是新闻、文章、笔记或想法描述）：\n\n---\n${rawContent}\n---\n\n请基于上述内容，生成一份 PRD 文档的大纲。\n\n大纲格式：\n\n# [产品/功能名称]\n\n**一句话描述**：（30字以内）\n\n### 一、背景与目标\n写作方向：...\n\n### 二、用户与场景\n写作方向：...\n\n### 三、功能需求\n写作方向：...\n\n### 四、非功能需求\n写作方向：...\n\n### 五、技术方案概述\n写作方向：...\n\n### 六、里程碑与交付计划\n写作方向：...\n\n直接输出大纲，不要解释。`;
  } else {
    const rounds = history.map((h, i) => `【第${i+1}稿大纲】\n${h.outline}\n\n【修改意见】\n${h.feedback}`).join('\n\n---\n\n');
    userPrompt = `原始需求：\n---\n${rawContent}\n---\n\n${rounds}\n\n请根据最新修改意见重新生成大纲，格式同上，直接输出。`;
  }
  const res = await openai.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'system', content: PRD_SYSTEM }, { role: 'user', content: userPrompt }],
    temperature: 0.6,
  });
  return res.choices[0].message.content.trim();
}

export async function generatePrdDocument(rawContent, confirmedOutline, apiKey) {
  const openai = client(apiKey);
  const today = new Date().toISOString().slice(0, 10);
  const userPrompt = `原始需求：\n---\n${rawContent}\n---\n\n已确认的 PRD 大纲：\n---\n${confirmedOutline}\n---\n\n请严格按照大纲章节撰写完整 PRD 文档。\n要求：\n1. 功能需求用用户故事格式\n2. 非功能需求全部量化\n3. 里程碑按 P0/P1/P2 区分\n4. 总字数 1500-3000 字\n\n输出完整 Markdown，顶部包含 front matter：\n---\ntitle: （功能/产品名称）\ndate: ${today}\nstatus: 草稿\n---\n\n直接输出，不要额外解释。`;
  const res = await openai.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'system', content: PRD_SYSTEM }, { role: 'user', content: userPrompt }],
    temperature: 0.6,
  });
  return res.choices[0].message.content.trim();
}
