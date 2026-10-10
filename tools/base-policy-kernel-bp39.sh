#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="${1:-/tmp/agentank-base-policy-bp39-enemy-option}"
LIMIT="${2:-8}"
FRAMES="${BP_ENEMY_OPTION_FRAMES:-6}"
BUDGET="${BP_ENEMY_OPTION_BUDGET:-2048}"
EXTRA_ARGS=("${@:3}")

cd "${ROOT}"
bash tools/base-policy-kernel-bp25.sh "${OUTPUT}" "${LIMIT}" shadow \
  --bounded-policy-enemy-response-option-census shadow \
  --bounded-policy-long-response-frames "${FRAMES}" \
  --bounded-policy-long-response-budget "${BUDGET}" \
  "${EXTRA_ARGS[@]}"
