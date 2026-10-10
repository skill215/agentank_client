#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="${1:-/tmp/agentank-base-policy-bp29-independent}"
OFFSET="${2:-16}"
LIMIT="${3:-32}"

mkdir -p "${OUTPUT}"
cd "${ROOT}"
BP_LONG_RESPONSE_MODE=guarded-shadow \
  bash tools/base-policy-kernel-bp27.sh "${OUTPUT}/shadow" "${LIMIT}" \
  --offset "${OFFSET}" >/dev/null
bash tools/base-policy-kernel-bp28.sh "${OUTPUT}/active" "${LIMIT}" \
  --offset "${OFFSET}" >/dev/null
node tools/agentank/diagnostics/base-policy-response-mass-compare.js \
  --shadow "${OUTPUT}/shadow/matches.ndjson.gz" \
  --active "${OUTPUT}/active/matches.ndjson.gz" \
  --output "${OUTPUT}/comparison.json"
