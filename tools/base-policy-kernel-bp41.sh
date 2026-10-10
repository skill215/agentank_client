#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="${1:-/tmp/agentank-base-policy-bp41-selective-verifier}"
LIMIT="${2:-16}"
EXTRA_ARGS=("${@:3}")

cd "${ROOT}"
bash tools/base-policy-kernel-bp40.sh "${OUTPUT}" "${LIMIT}" \
  --bounded-policy-enemy-response-prefix-depth 1 \
  "${EXTRA_ARGS[@]}"
