#!/usr/bin/env bash
set -euo pipefail
BASE="${1:-http://127.0.0.1:8001}"
HDR=(-H "X-Demo-Role: manager" -H "X-Demo-Actor: smoke-manager" -H "Content-Type: application/json")

curl -sf "$BASE/health" | python -m json.tool
CREATE=$(curl -sf "${HDR[@]}" -d '{"use_synthetic_fallback":true}' "$BASE/v1/runs")
echo "$CREATE" | python -m json.tool
RUN_ID=$(python - <<PY
import json,sys
print(json.loads('''$CREATE''')['run_id'])
PY
)
echo "RUN_ID=$RUN_ID"
curl -sf "${HDR[@]}" -X POST "$BASE/v1/runs/$RUN_ID/execute" | python -m json.tool
curl -sf "${HDR[@]}" "$BASE/v1/runs/$RUN_ID/options" | python -m json.tool
curl -sf "${HDR[@]}" -d '{"option_key":"balanced","decision":"approve","rationale":"Smoke test approval with MY residency condition","conditions":["no cross-border employee data upload"]}' \
  "$BASE/v1/runs/$RUN_ID/decision" | python -m json.tool
curl -sf "${HDR[@]}" "$BASE/v1/runs/$RUN_ID/artifacts" | python -m json.tool
curl -sf "${HDR[@]}" "$BASE/v1/metrics/summary" | python -m json.tool
echo "HTTP_SMOKE_OK $RUN_ID"
