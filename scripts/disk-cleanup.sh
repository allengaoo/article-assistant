#!/usr/bin/env bash
# Disk cleanup when usage >= 70%. Never touches webapp code, .env, or PM2/nginx config.
set -euo pipefail

DATA_DIR="${DATA_DIR:-/root/gzh-publish/data}"
PM2_LOGS="${PM2_LOGS:-$HOME/.pm2/logs}"
THRESHOLD="${DISK_THRESHOLD:-70}"
LOG_TAG="[disk-cleanup $(date '+%Y-%m-%d %H:%M:%S')]"

disk_usage() {
  df / | awk 'NR==2 {gsub(/%/, "", $5); print $5}'
}

USAGE=$(disk_usage)
echo "$LOG_TAG disk usage: ${USAGE}%"

if [ "$USAGE" -lt "$THRESHOLD" ]; then
  echo "$LOG_TAG below threshold ${THRESHOLD}%, skip"
  exit 0
fi

echo "$LOG_TAG cleaning..."

cleanup_step() {
  local desc="$1"; shift
  echo "$LOG_TAG step: $desc"
  "$@" 2>/dev/null || true
  local new_usage
  new_usage=$(disk_usage)
  echo "$LOG_TAG after: ${new_usage}%"
  if [ "$new_usage" -lt "$THRESHOLD" ]; then
    echo "$LOG_TAG done"
    exit 0
  fi
}

cleanup_step "/tmp uploads (>1d)" \
  find /tmp -maxdepth 2 \( -name "*.jpg" -o -name "*.png" -o -name "*.mp4" -o -name "upload_*" \) -mtime +1 -delete

if [ -d "$PM2_LOGS" ]; then
  cleanup_step "PM2 logs (>7d)" find "$PM2_LOGS" -name "*.log" -mtime +7 -delete
fi

SESSION_DIR="$DATA_DIR/sessions"
if [ -d "$SESSION_DIR" ]; then
  cleanup_step "session snapshots (>30d)" find "$SESSION_DIR" -name "*.json" -mtime +30 -delete
  find "$SESSION_DIR" -mindepth 1 -maxdepth 1 -type d -empty -delete 2>/dev/null || true
fi

DAILY_DIR="$DATA_DIR/knowledge/daily"
if [ -d "$DAILY_DIR" ]; then
  cleanup_step "daily summaries (>90d)" find "$DAILY_DIR" -name "*.json" -mtime +90 -delete
fi

LOG_DIR="/root/gzh-publish/logs"
if [ -d "$LOG_DIR" ]; then
  cleanup_step "service logs (>14d)" find "$LOG_DIR" -name "*.log" -mtime +14 -delete
fi

echo "$LOG_TAG final: $(disk_usage)%"
