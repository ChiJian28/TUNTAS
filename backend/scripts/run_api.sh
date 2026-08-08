#!/usr/bin/env bash
# Start TUNTAS API with WeasyPrint system libs available on macOS.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck disable=SC1091
source .venv/bin/activate
export DYLD_LIBRARY_PATH="/opt/homebrew/lib${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}"
# Prefer .env PORT; default 8001. Never silently inherit TrustLoop's 8000.
if [[ -f .env ]]; then
  ENV_PORT=$(grep -E '^PORT=' .env | tail -n1 | cut -d= -f2 | tr -d '\r')
fi
PORT="${ENV_PORT:-8001}"
echo "Starting TUNTAS on port $PORT"
exec uvicorn app.main:app --host 0.0.0.0 --port "$PORT" --reload
