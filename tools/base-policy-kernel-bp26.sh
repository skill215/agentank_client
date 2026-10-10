#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="${1:-/tmp/agentank-base-policy-bp26-long-event-shadow}"
LIMIT="${2:-16}"
FRAMES="${BP_LONG_EVENT_FRAMES:-6}"
BUDGET="${BP_LONG_EVENT_BUDGET:-2048}"
EXTRA_ARGS=("${@:3}")

cd "${ROOT}"
bash tools/base-policy-kernel-bp25.sh "${OUTPUT}" "${LIMIT}" shadow \
  --bounded-policy-long-event-envelope shadow \
  --bounded-policy-long-event-frames "${FRAMES}" \
  --bounded-policy-long-event-budget "${BUDGET}" \
  "${EXTRA_ARGS[@]}"
