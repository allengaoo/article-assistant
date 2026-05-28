#!/usr/bin/env bash
# Remote publish: sync article dir and run publish.mjs on server
# Usage: bash scripts/remote-publish.sh <article.md> [--dry-run]

set -euo pipefail

ARTICLE_PATH="$1"
EXTRA_ARGS="${@:2}"
REMOTE="${DEPLOY_HOST:?请设置 DEPLOY_HOST，例如 root@your-server}"
REMOTE_DIR="${DEPLOY_DIR:-/root/gzh-publish}"
ARTICLE_DIR="$(dirname "$ARTICLE_PATH")"

if [ -z "$ARTICLE_PATH" ]; then
  echo "Usage: bash scripts/remote-publish.sh <article.md> [--dry-run]"
  exit 1
fi

echo "📂 Sync article dir: $ARTICLE_DIR"
rsync -avz \
  --exclude '.out' \
  "$ARTICLE_DIR/" \
  "${REMOTE}:${REMOTE_DIR}/${ARTICLE_DIR}/"

echo ""
echo "📡 Remote publish..."
ssh "$REMOTE" "cd ${REMOTE_DIR} && node scripts/publish.mjs ${ARTICLE_PATH} ${EXTRA_ARGS}"
