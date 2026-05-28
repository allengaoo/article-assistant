/**
 * 飞书自建应用 API 客户端
 * 凭证从本地 .env 读取，不经过服务器
 *
 * 主要功能：
 *   - getTenantToken()          获取 tenant_access_token
 *   - createDocument(title)     创建空白飞书文档，返回 { docId, url }
 *   - writeBlocks(docId, md)    将 Markdown 写入文档（标题/段落/列表/粗体）
 *   - setPublicReadable(docId)  设为「任何人可查看」
 */

const BASE = 'https://open.feishu.cn/open-apis';
const APP_ID     = process.env.FEISHU_APP_ID;
const APP_SECRET = process.env.FEISHU_APP_SECRET;

// ── Token（每次运行获取一次，有效期 2h，单次 CLI 够用）────────────────────────
let _token = null;

export async function getTenantToken() {
  if (_token) return _token;
  const res = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`飞书 Token 获取失败: ${data.msg}`);
  _token = data.tenant_access_token;
  return _token;
}

async function req(method, path, body) {
  const token = await getTenantToken();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`飞书 API 错误 [${path}]: ${data.msg}`);
  return data.data;
}

// ── 创建文档 ─────────────────────────────────────────────────────────────────
export async function createDocument(title) {
  const data = await req('POST', '/docx/v1/documents', { title });
  const docId = data.document.document_id;
  // 飞书文档 URL（企业版/个人版通用）
  const url = `https://docs.feishu.cn/docx/${docId}`;
  return { docId, url };
}

// ── 设为「互联网上获得链接的人可查看」────────────────────────────────────────
export async function setPublicReadable(docId) {
  // 先获取文档 token（file token）
  const info = await req('GET', `/docx/v1/documents/${docId}`);
  const fileToken = info.document?.document_id ?? docId;

  await req('PATCH', `/drive/v1/permissions/${fileToken}/members/public_access_level`, {
    link_share_entity: 'tenant_readable', // 组织内任何人可查看
  }).catch(() => {
    // 部分飞书版本不支持此接口，静默处理
  });
}

// ── Markdown → 飞书文档块 ─────────────────────────────────────────────────────

/**
 * 将 Markdown 字符串写入已有文档。
 * 支持：# H1  ## H2  ### H3  普通段落  - 无序列表  **加粗**
 */
export async function writeBlocks(docId, markdown) {
  // 获取根块 ID（默认写入 root block 的 children）
  const docData = await req('GET', `/docx/v1/documents/${docId}`);
  const rootBlockId = docData.document.document_id; // root block == doc id

  const blocks = mdToBlocks(markdown);
  if (blocks.length === 0) return;

  // 飞书每次最多写 50 个块，分批写入
  const CHUNK = 50;
  for (let i = 0; i < blocks.length; i += CHUNK) {
    const chunk = blocks.slice(i, i + CHUNK);
    await req('POST', `/docx/v1/documents/${docId}/blocks/${rootBlockId}/children`, {
      children: chunk,
      index: i, // 追加位置
    });
  }
}

// ── Markdown 解析 ─────────────────────────────────────────────────────────────

function mdToBlocks(md) {
  // 去掉 YAML front matter
  const cleaned = md.replace(/^---[\s\S]*?---\n?/, '').trim();
  const lines = cleaned.split('\n');
  const blocks = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('### ')) {
      blocks.push(heading(line.slice(4).trim(), 3));
    } else if (line.startsWith('## ')) {
      blocks.push(heading(line.slice(3).trim(), 2));
    } else if (line.startsWith('# ')) {
      blocks.push(heading(line.slice(2).trim(), 1));
    } else if (/^[-*] /.test(line)) {
      blocks.push(bullet(line.slice(2).trim()));
    } else if (/^\d+\. /.test(line)) {
      blocks.push(ordered(line.replace(/^\d+\. /, '').trim()));
    } else if (line.trim() === '' || line.startsWith('---')) {
      // 空行跳过，水平线跳过
    } else {
      blocks.push(paragraph(line.trim()));
    }
  }

  return blocks;
}

// ── 块构造器 ──────────────────────────────────────────────────────────────────

function textElements(text) {
  // 解析 **bold** 语法
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.filter(Boolean).map((p) => {
    if (p.startsWith('**') && p.endsWith('**')) {
      return {
        type: 'text_run',
        text_run: {
          content: p.slice(2, -2),
          text_element_style: { bold: true },
        },
      };
    }
    return { type: 'text_run', text_run: { content: p } };
  });
}

function heading(text, level) {
  const typeMap = { 1: 'heading1', 2: 'heading2', 3: 'heading3' };
  return {
    block_type: { 1: 3, 2: 4, 3: 5 }[level], // 飞书 block_type 数值
    [typeMap[level]]: { elements: textElements(text) },
  };
}

function paragraph(text) {
  return {
    block_type: 2,
    text: { elements: textElements(text) },
  };
}

function bullet(text) {
  return {
    block_type: 12,
    bullet: { elements: textElements(text) },
  };
}

function ordered(text) {
  return {
    block_type: 13,
    ordered: { elements: textElements(text) },
  };
}
