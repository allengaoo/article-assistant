#!/usr/bin/env bash
# Remote deploy: sync app code to server and restart PM2 (does NOT sync .env)
# Usage: bash scripts/remote-deploy.sh

set -euo pipefail

REMOTE="${DEPLOY_HOST:-root@8.130.138.121}"
REMOTE_DIR="${DEPLOY_DIR:-/root/gzh-publish}"
LOCAL_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "📦 Syncing to ${REMOTE}:${REMOTE_DIR}"
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
  "${LOCAL_DIR}/" "${REMOTE}:${REMOTE_DIR}/"

echo "🔄 Installing deps & restarting PM2..."
ssh "$REMOTE" "cd ${REMOTE_DIR} && npm install --omit=dev && cd webapp && npm install --omit=dev && pm2 restart gzh-webapp || pm2 start webapp/server.mjs --name gzh-webapp"

echo "✅ Deploy complete"
