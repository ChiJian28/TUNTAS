#!/usr/bin/env bash
# Non-interactive local start of memory-core + memory-hub + proxy.
# Does not modify start-all.sh. Fails if LLM keys are still REPLACE_ME.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../deploy/global-images" && pwd)"
# shellcheck source=../../deploy/global-images/_lib.sh
source "$ROOT/_lib.sh"

if [[ ! -f "$ROOT/.env" ]]; then
  cp "$ROOT/.env.example" "$ROOT/.env"
  die "已复制 .env.example → $ROOT/.env 。请填 MEMORY_LLM_* 与 PROXY_UPSTREAM_* 后再跑本脚本。"
fi

load_env

need_real() {
  local name="$1" value="${2:-}"
  if [[ -z "$value" || "$value" == "REPLACE_ME" ]]; then
    die "$name 还是空的或 REPLACE_ME。请编辑 $ROOT/.env 后再跑。"
  fi
}

need_real MEMORY_LLM_BASE_URL "${MEMORY_LLM_BASE_URL:-}"
need_real MEMORY_LLM_API_KEY "${MEMORY_LLM_API_KEY:-}"
need_real MEMORY_LLM_MODEL "${MEMORY_LLM_MODEL:-}"
need_real PROXY_UPSTREAM_URL "${PROXY_UPSTREAM_URL:-}"
need_real PROXY_UPSTREAM_API_KEY "${PROXY_UPSTREAM_API_KEY:-}"
need_real PROXY_UPSTREAM_MODEL "${PROXY_UPSTREAM_MODEL:-}"

check_ports

info "═══ memory-core ═══════════════════════════════════════"
"$ROOT/start-memory-core.sh"

info "═══ memory-hub ═══════════════════════════════════════"
"$ROOT/start-memory-hub.sh"

info "═══ proxy (full stack) ════════════════════════════════"
PROXY_FULL_STACK=1 "$ROOT/start-proxy.sh"

ok "三件套已就绪"
echo "  Panel:  http://localhost:${PANEL_PORT:-8125}"
echo "  Proxy:  http://127.0.0.1:${PROXY_PORT:-8096}"
echo "  admin user_key: $ROOT/.admin-key"
echo ""
echo "下一步："
echo "  1) bash demo-seed/ambank-tuntas/seed-hub.sh"
echo "  2) bash demo-seed/ambank-tuntas/append-workbuddy-model.sh"
