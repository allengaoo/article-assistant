#!/usr/bin/env bash
# Scan the git tree for accidentally committed secrets or sensitive files.
# Used in CI and safe to run locally: bash scripts/secret-scan.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

fail=0

echo "🔍 Checking for tracked .env files..."
tracked_env="$(git ls-files '.env' '**/.env' '**/.env.*' 2>/dev/null | grep -Ev '\.env\.example$' || true)"
if [ -n "$tracked_env" ]; then
  echo "❌ .env files must not be committed:"
  echo "$tracked_env"
  fail=1
else
  echo "✅ No .env files tracked"
fi

echo "🔍 Scanning tracked content for secret patterns..."

# Paths excluded from content scan (placeholders, CI templates, test fakes)
EXCLUDE=(
  ':(exclude)*.example'
  ':(exclude).github/workflows/*'
  ':(exclude)tests/helpers/test-server.mjs'
  ':(exclude)tests/auth.test.mjs'
  ':(exclude)tests/security.test.mjs'
  ':(exclude)scripts/secret-scan.sh'
)

scan() {
  local label="$1"
  local pattern="$2"
  if git grep -nE "$pattern" -- . "${EXCLUDE[@]}" 2>/dev/null; then
    echo "❌ Possible $label detected (see above)"
    fail=1
  fi
}

# OpenAI / DashScope / generic API keys
scan 'API key (sk-...)' 'sk-[a-zA-Z0-9]{20,}'

# Env vars with non-empty values (exclude KEY= / KEY="" lines)
scan 'DASHSCOPE_API_KEY value' 'DASHSCOPE_API_KEY=[^[:space:]#][^[:space:]]{7,}'
scan 'WX_APPSECRET value' 'WX_APPSECRET=[^[:space:]#][^[:space:]]{7,}'
scan 'WX_APPID value' 'WX_APPID=wx[a-z0-9]{8,}'
scan 'FEISHU_APP_SECRET value' 'FEISHU_APP_SECRET=[^[:space:]#][^[:space:]]{7,}'
scan 'SKYWORK_API_KEY value' 'SKYWORK_API_KEY=[^[:space:]#][^[:space:]]{7,}'
scan 'MASTER_KEY value' 'MASTER_KEY=[^[:space:]#][^[:space:]]{7,}'
scan 'ACCESS_TOKEN value' 'ACCESS_TOKEN=[^[:space:]#][^[:space:]]{7,}'

# Private keys
scan 'private key block' 'BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY'

# Hardcoded production server IP (use DEPLOY_HOST env / GitHub secret instead)
scan 'hardcoded server IP' '8\.130\.138\.121'

if [ "$fail" -ne 0 ]; then
  echo ""
  echo "Secret scan failed. Remove secrets from git history if already pushed."
  exit 1
fi

echo "✅ Secret scan passed"
