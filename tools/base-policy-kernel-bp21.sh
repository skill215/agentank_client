#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="${1:-/tmp/agentank-base-policy-bp21-event-closure-shadow}"
LIMIT="${2:-16}"
MODE="${3:-shadow}"
EXTRA_ARGS=("${@:4}")
if [[ "${MODE}" != "shadow" && "${MODE}" != "active" ]]; then
  echo "usage: $0 [output] [scenario-limit] [shadow|active]" >&2
  exit 2
fi

cd "${ROOT}"
bash tools/base-policy-kernel-bp18.sh "${OUTPUT}" "${LIMIT}" "${MODE}" \
  --bounded-policy-response-envelope-event-closure true \
  "${EXTRA_ARGS[@]}"
