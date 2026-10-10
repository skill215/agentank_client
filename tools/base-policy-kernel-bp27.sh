#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="${1:-/tmp/agentank-base-policy-bp27-response-mass-shadow}"
LIMIT="${2:-16}"
FRAMES="${BP_LONG_RESPONSE_FRAMES:-6}"
BUDGET="${BP_LONG_RESPONSE_BUDGET:-2048}"
MODE="${BP_LONG_RESPONSE_MODE:-shadow}"
EXTRA_ARGS=("${@:3}")

cd "${ROOT}"
bash tools/base-policy-kernel-bp25.sh "${OUTPUT}" "${LIMIT}" shadow \
  --bounded-policy-long-response-mass "${MODE}" \
  --bounded-policy-long-response-frames "${FRAMES}" \
  --bounded-policy-long-response-budget "${BUDGET}" \
  "${EXTRA_ARGS[@]}"
