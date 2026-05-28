#!/usr/bin/env bash
# Remote deploy: sync app code to server and restart PM2 (does NOT sync .env)
# Usage:
#   npm run remote-deploy
#   DEPLOY_HOST=root@1.2.3.4 npm run remote-deploy

set -euo pipefail

LOCAL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/deploy-env.sh
source "$LOCAL_DIR/scripts/lib/deploy-env.sh"

# 清除代理环境变量，设置 SSH 直连选项（绕过 Clash / Surge 等）
bypass_proxy

load_deploy_env "$LOCAL_DIR"

REMOTE="${DEPLOY_HOST:?请设置 DEPLOY_HOST（可在 .env 中配置 DEPLOY_HOST=root@<服务器>）}"
REMOTE_DIR="${DEPLOY_DIR:-/root/gzh-publish}"

validate_deploy_host "$REMOTE"
preflight_ssh "$REMOTE"

echo "📦 Syncing to ${REMOTE}:${REMOTE_DIR}"
# shellcheck disable=SC2086
rsync -az --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude 'webapp/node_modules' \
  --exclude '.env' \
  --exclude 'webapp/.env' \
  --exclude 'data' \
  --exclude 'logs' \
  --exclude 'articles' \
  --exclude '.DS_Store' \
  -e "ssh $SSH_OPTS" \
  "${LOCAL_DIR}/" "${REMOTE}:${REMOTE_DIR}/"

echo "🔄 Installing deps & restarting PM2..."
# shellcheck disable=SC2086
ssh $SSH_OPTS "$REMOTE" \
  "cd ${REMOTE_DIR} && npm install --omit=dev && cd webapp && npm install --omit=dev && pm2 restart gzh-webapp || pm2 start webapp/server.mjs --name gzh-webapp"

echo "✅ Deploy complete"
