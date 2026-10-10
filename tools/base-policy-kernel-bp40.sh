#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="${1:-/tmp/agentank-base-policy-bp40-enemy-portfolio}"
LIMIT="${2:-8}"
FRAMES="${BP_ENEMY_PORTFOLIO_FRAMES:-6}"
BUDGET="${BP_ENEMY_PORTFOLIO_BUDGET:-2048}"
EXTRA_ARGS=("${@:3}")

cd "${ROOT}"
bash tools/base-policy-kernel-bp25.sh "${OUTPUT}" "${LIMIT}" shadow \
  --bounded-policy-enemy-response-portfolio-census shadow \
  --bounded-policy-long-response-frames "${FRAMES}" \
  --bounded-policy-long-response-budget "${BUDGET}" \
  "${EXTRA_ARGS[@]}"
