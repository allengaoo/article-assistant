#!/usr/bin/env bash
# Remote publish: sync article dir and run publish.mjs on server
# Usage: bash scripts/remote-publish.sh <article.md> [--dry-run]

set -euo pipefail

if [ -z "${1:-}" ]; then
  echo "Usage: bash scripts/remote-publish.sh <article.md> [--dry-run]"
  exit 1
fi

LOCAL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/deploy-env.sh
source "$LOCAL_DIR/scripts/lib/deploy-env.sh"

# 清除代理环境变量，设置 SSH 直连选项（绕过 Clash / Surge 等）
bypass_proxy

load_deploy_env "$LOCAL_DIR"

ARTICLE_PATH="$1"
EXTRA_ARGS="${*:2}"
REMOTE="${DEPLOY_HOST:?请设置 DEPLOY_HOST（可在 .env 中配置）}"
REMOTE_DIR="${DEPLOY_DIR:-/root/gzh-publish}"
ARTICLE_DIR="$(dirname "$ARTICLE_PATH")"

validate_deploy_host "$REMOTE"
preflight_ssh "$REMOTE"

echo "📂 Sync article dir: $ARTICLE_DIR"
# shellcheck disable=SC2086
rsync -avz \
  --exclude '.out' \
  -e "ssh $SSH_OPTS" \
  "$ARTICLE_DIR/" \
  "${REMOTE}:${REMOTE_DIR}/${ARTICLE_DIR}/"

echo ""
echo "📡 Remote publish..."
# shellcheck disable=SC2086
ssh $SSH_OPTS "$REMOTE" "cd ${REMOTE_DIR} && node scripts/publish.mjs ${ARTICLE_PATH} ${EXTRA_ARGS}"
