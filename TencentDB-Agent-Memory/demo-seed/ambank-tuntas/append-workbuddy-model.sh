#!/usr/bin/env bash
# APPEND a custom WorkBuddy model that points at Memory Proxy.
# Does not delete or rewrite other models. Does not touch mcp.json or skills.
#
# This WorkBuddy build reads ~/.workbuddy-ai/models.json (not ~/.workbuddy/models.json).
set -euo pipefail

SEED_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SEED_DIR/../../deploy/global-images" && pwd)"
# shellcheck source=../../deploy/global-images/_lib.sh
source "$ROOT/_lib.sh"
load_env

WB_MODELS="${WORKBUDDY_MODELS_JSON:-$HOME/.workbuddy-ai/models.json}"
ADMIN_KEY_FILE="${MEMORY_CORE_ADMIN_KEY_FILE:-$ROOT/.admin-key}"
PROXY_HOST="http://127.0.0.1:${PROXY_PORT:-8096}"
INSTANCE_ID="${TDAI_SERVICE_ID:-default}"
MODEL_ID="${PROXY_UPSTREAM_MODEL:-}"
DISPLAY_NAME="${WORKBUDDY_MEMORY_MODEL_NAME:-TUNTAS Agent Memory (proxy)}"

if [[ -z "$MODEL_ID" || "$MODEL_ID" == "REPLACE_ME" ]]; then
  die "PROXY_UPSTREAM_MODEL 未填。先写 $ROOT/.env"
fi
if [[ ! -s "$ADMIN_KEY_FILE" ]]; then
  die "找不到 $ADMIN_KEY_FILE 。先跑 start-stack.sh。"
fi

USER_KEY="$(tr -d '[:space:]' < "$ADMIN_KEY_FILE")"
URL="${PROXY_HOST}/workbuddy/${INSTANCE_ID}"

python3 - "$WB_MODELS" "$MODEL_ID" "$DISPLAY_NAME" "$URL" "$USER_KEY" <<'PY'
import json, os, sys, time
path, model_id, name, url, key = sys.argv[1:6]
os.makedirs(os.path.dirname(path), exist_ok=True)
if os.path.exists(path):
    with open(path) as f:
        data = json.load(f)
    if not isinstance(data, list):
        raise SystemExit(f"{path} is not a JSON array; refusing to touch it")
    bak = f"{path}.bak.{time.strftime('%Y%m%d%H%M%S')}"
    with open(bak, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
    print(f"backup: {bak}")
else:
    data = []
entry = {
    "id": model_id,
    "name": name,
    "vendor": "Custom",
    "url": url,
    "apiKey": key,
    "supportsToolCall": True,
    "supportsImages": False,
    "supportsReasoning": False,
    "useCustomProtocol": False,
}
out = [e for e in data if e.get("id") != model_id]
out.append(entry)
with open(path, "w") as f:
    json.dump(out, f, indent=2)
    f.write("\n")
print(f"wrote {len(out)} model(s) → {path}")
print(f"select in WorkBuddy: {name}  (id={model_id})")
PY

ok "已追加自定义模型，未改 MCP / Skill"
echo "  文件: $WB_MODELS"
echo "  在 WorkBuddy 模型选择器 → 自定义模型 → 「${DISPLAY_NAME}」"
echo "  正式 Playbook 1/2 请继续用你现在已跑通的内置模型；只有录 Memory 那段才切这个。"
