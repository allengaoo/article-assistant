#!/usr/bin/env bash
# Shared deploy helpers — load local .env, validate host, preflight SSH.

# ── Proxy bypass ──────────────────────────────────────────────────────────────
# Clash / Surge 等代理软件会将 SSH/rsync 流量转发到本地 SOCKS 端口（如 7897），
# 导致 "Connection closed by 127.0.0.1 port 7897"。
# 本函数同时处理两种拦截方式：
#   1. 环境变量代理（HTTP_PROXY / SOCKS_PROXY 等）
#   2. SSH 层代理（通过 ProxyCommand none 声明直连，忽略任何代理指令）
bypass_proxy() {
  unset ALL_PROXY all_proxy \
        HTTPS_PROXY https_proxy \
        HTTP_PROXY http_proxy \
        SOCKS_PROXY socks_proxy \
        NO_PROXY no_proxy

  # SSH 公共选项：直连 + 超时 + 首次连接自动信任主机指纹
  # ProxyCommand none 告诉 SSH 不使用任何代理，直接建立 TCP 连接
  SSH_OPTS="-o ProxyCommand=none -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new"
  export SSH_OPTS
}

load_deploy_env() {
  local root_dir="$1"
  local env_file="$root_dir/.env"
  [ -f "$env_file" ] || return 0

  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      DEPLOY_HOST=*|DEPLOY_DIR=*)
        # shellcheck disable=SC2163
        export "$line"
        ;;
    esac
  done < <(grep -E '^(DEPLOY_HOST|DEPLOY_DIR)=' "$env_file" 2>/dev/null || true)
}

validate_deploy_host() {
  local remote="$1"
  if [[ "$remote" == *your-server* ]] || [[ "$remote" == *example.com* ]] || [[ "$remote" == *your-domain* ]]; then
    echo "❌ DEPLOY_HOST 仍是文档占位符: $remote"
    echo ""
    echo "请在本机项目根目录 .env 中设置真实服务器，例如："
    echo "  DEPLOY_HOST=root@<ECS 公网 IP 或域名>"
    echo "  DEPLOY_DIR=/root/gzh-publish"
    echo ""
    echo "然后直接运行: npm run remote-deploy"
    exit 1
  fi
}

preflight_ssh() {
  local remote="$1"

  # shellcheck disable=SC2086
  if ssh $SSH_OPTS -o BatchMode=yes "$remote" "echo ok" >/dev/null 2>&1; then
    return 0
  fi

  echo "❌ 无法 SSH 到 ${remote}"
  echo ""
  echo "请排查："
  echo "  1. DEPLOY_HOST 是否填写了真实 ECS 地址（IP 或域名）"
  echo "  2. 是否已配置 SSH 密钥: ssh-copy-id ${remote}"
  echo "  3. 若仍提示 Clash/代理问题，可将服务器 IP 加入 Clash 的直连规则（推荐）"
  echo "     或在 ~/.ssh/config 中为该主机单独配置:"
  echo "       Host <ECS_IP_或域名>"
  echo "         ProxyCommand none"
  exit 1
}

export -f bypass_proxy load_deploy_env validate_deploy_host preflight_ssh 2>/dev/null || true
