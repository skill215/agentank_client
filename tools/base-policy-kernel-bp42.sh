#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="${1:-/tmp/agentank-base-policy-bp42-selective-execution}"
LIMIT="${2:-16}"
MODE="${3:-shadow}"
EXTRA_ARGS=("${@:4}")
if [[ "${MODE}" != "shadow" && "${MODE}" != "guarded-shadow" &&
      "${MODE}" != "active" &&
      "${MODE}" != "strict-active" && "${MODE}" != "value-active" ]]; then
  echo "usage: $0 [output] [scenario-limit] [shadow|guarded-shadow|active|strict-active|value-active]" >&2
  exit 2
fi

cd "${ROOT}"
bash tools/base-policy-kernel-bp25.sh "${OUTPUT}" "${LIMIT}" shadow \
  --bounded-policy-selective-response-verifier "${MODE}" \
  --bounded-policy-long-response-frames 6 \
  --bounded-policy-long-response-budget 2048 \
  "${EXTRA_ARGS[@]}"
