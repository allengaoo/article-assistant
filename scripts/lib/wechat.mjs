/**
 * WeChat 公众号 API 封装
 * 覆盖: access_token / 正文图片上传 / 永久素材上传 / 草稿创建
 * 所有图片限制: JPG/PNG/GIF, 正文图片 < 1MB, 封面 < 10MB
 */

let _cache = { token: null, expiresAt: 0 };

/** 获取 access_token（内存缓存，提前 5 分钟自动刷新） */
export async function getAccessToken(appid, appsecret) {
  if (_cache.token && Date.now() < _cache.expiresAt) return _cache.token;

  const url =
    `https://api.weixin.qq.com/cgi-bin/token` +
    `?grant_type=client_credential&appid=${appid}&secret=${appsecret}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const data = await res.json();
  if (data.errcode) {
    throw new Error(`获取 access_token 失败 [${data.errcode}]: ${data.errmsg}`);
  }

  _cache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 300) * 1000,
  };
  return _cache.token;
}

/**
 * 上传正文图片（不占永久素材配额）
 * 接口: POST /cgi-bin/media/uploadimg
 * 返回: 微信图床 URL（https://mmbiz.qpic.cn/...）
 */
export async function uploadArticleImage(token, buffer, filename) {
  const mime = mimeFromFilename(filename);
  const form = new FormData();
  form.append('media', new Blob([buffer], { type: mime }), filename);

  const res = await fetch(
    `https://api.weixin.qq.com/cgi-bin/media/uploadimg?access_token=${token}`,
    { method: 'POST', body: form, signal: AbortSignal.timeout(30_000) },
  );
  const data = await res.json();
  if (!data.url) throw new Error(`uploadimg 失败: ${JSON.stringify(data)}`);
  return data.url;
}

/**
 * 上传永久素材（封面图专用，需要 media_id）
 * 接口: POST /cgi-bin/material/add_material?type=image
 * 返回: { media_id, url }
 */
export async function uploadPermanentMaterial(token, buffer, filename) {
  const mime = mimeFromFilename(filename);
  const form = new FormData();
  form.append('media', new Blob([buffer], { type: mime }), filename);

  const res = await fetch(
    `https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${token}&type=image`,
    { method: 'POST', body: form, signal: AbortSignal.timeout(30_000) },
  );
  const data = await res.json();
  if (!data.media_id) throw new Error(`add_material 失败: ${JSON.stringify(data)}`);
  return data; // { media_id, url }
}

/**
 * 创建草稿
 * 接口: POST /cgi-bin/draft/add
 * 返回: media_id（草稿 ID）
 */
export async function addDraft(token, article) {
  const body = JSON.stringify({ articles: [article] });
  const res = await fetch(
    `https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${token}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body,
      signal: AbortSignal.timeout(30_000),
    },
  );
  const data = await res.json();
  if (data.errcode && data.errcode !== 0) {
    throw new Error(`addDraft 失败 [${data.errcode}]: ${data.errmsg}`);
  }
  return data.media_id;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function mimeFromFilename(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  return (
    { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' }[ext] ??
    'image/jpeg'
  );
}
