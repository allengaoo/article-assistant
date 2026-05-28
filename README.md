# Article Assistant / 文章助手

Mobile-first PWA for turning URLs, text, images, or videos into WeChat draft articles or Feishu PRD documents — with human-in-the-loop outline review.

面向移动端的 PWA：输入 URL、文字、图片或视频，经人工确认大纲后，生成微信公众号草稿或飞书 PRD 文档。

**Live demo:** https://mdpdemo.space

---

## Features / 功能

| Feature | Description |
|---------|-------------|
| Multi-input | URL, text, image upload, video URL (Bilibili / Douyin) |
| Human-in-the-loop | Outline → revise → confirm → full article / PRD |
| WeChat publish | Push rendered HTML to Official Account draft box |
| Feishu PRD | Download `.md` locally, run CLI to create Feishu doc |
| Session memory | Daily snapshots + knowledge notes (optional LLM summary) |
| Disk guard | Auto cleanup when disk usage ≥ 70% |

---

## Quick Start / 快速开始

```bash
git clone https://github.com/allengaoo/article-assistant.git
cd article-assistant

cp .env.example .env
# Edit .env — see sections below

npm install
npm --prefix webapp install

npm run dev          # http://localhost:3000
```

### Environment variables / 环境变量

| Variable | Required | Where |
|----------|----------|-------|
| `DASHSCOPE_API_KEY` | Webapp AI | Server |
| `ACCESS_TOKEN` | PWA login password | Server |
| `MASTER_KEY` | Token recovery & cron | Server |
| `WX_APPID` / `WX_APPSECRET` | WeChat draft publish | Server |
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | Feishu CLI only | **Local Mac only** |

> **Security:** Never commit `.env`. Feishu credentials stay on your local machine only.

---

## CLI / 命令行

```bash
# WeChat: render Markdown → draft box
npm run publish -- path/to/article.md
npm run dry-run -- path/to/article.md --dry-run

# Feishu: local only
npm run feishu-publish -- path/to/prd.md

# Deploy to server (rsync + PM2 restart)
npm run remote-deploy
```

---

## Project layout / 目录结构

```
article-assistant/
├── webapp/           # Express API + PWA frontend
├── scripts/          # publish, feishu, deploy, disk-cleanup
├── tests/            # node:test unit tests
├── deploy/           # PM2 / crontab / rotate-token examples
├── data/             # runtime data (gitignored)
└── .github/workflows # CI + manual deploy
```

---

## Server deployment / 服务器部署

Production path: `/root/gzh-publish` on Alibaba Cloud ECS (`mdpdemo.space`).

1. Copy `.env` to server (`webapp/.env` or project root `.env`)
2. `pm2 start webapp/server.mjs --name gzh-webapp`
3. Nginx reverse proxy HTTPS → `:3000`
4. Optional cron: see `deploy/crontab.example`

### GitHub Actions deploy

Add repository secrets:

| Secret | Example |
|--------|---------|
| `DEPLOY_HOST` | `root@8.130.138.121` |
| `DEPLOY_SSH_KEY` | Private key (ed25519) |
| `DEPLOY_DIR` | `/root/gzh-publish` |

Run **Actions → Deploy → Run workflow**, type `deploy` to confirm.

---

## Testing / 测试

```bash
npm test
```

CI runs on every push/PR: unit tests + shell syntax check + secret pattern scan.

---

## License / 许可证

[GNU AGPL v3.0](LICENSE) — Network use of this software requires source availability to users.

---

## Related / 相关项目

WeChat article **content** (Markdown drafts, images) is maintained separately in a private content repo. This repo is the **tooling / online service** only.

公众号**文章内容**（Markdown 稿件、配图）在独立的内容仓库维护；本仓库仅包含在线服务与发布工具。
