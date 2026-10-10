#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="${1:-/tmp/agentank-base-policy-bp38-budget-frontier}"
LIMIT="${2:-16}"
FRAMES="${BP_BUDGET_FRONTIER_FRAMES:-6}"
BUDGET="${BP_BUDGET_FRONTIER_BUDGET:-2048}"
EXTRA_ARGS=("${@:3}")

cd "${ROOT}"
bash tools/base-policy-kernel-bp25.sh "${OUTPUT}" "${LIMIT}" shadow \
  --bounded-policy-budget-frontier-census shadow \
  --bounded-policy-long-response-frames "${FRAMES}" \
  --bounded-policy-long-response-budget "${BUDGET}" \
  "${EXTRA_ARGS[@]}"
