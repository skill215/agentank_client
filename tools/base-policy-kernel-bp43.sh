#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="${1:-/tmp/agentank-base-policy-bp43-host-continuation}"
LIMIT="${2:-16}"
MODE="${3:-shadow}"
ROLE="${4:-DISCOVERY}"
EXTRA_ARGS=("${@:5}")
if [[ "${MODE}" != "shadow" && "${MODE}" != "guarded-shadow" &&
      "${MODE}" != "active" &&
      "${MODE}" != "strict-active" && "${MODE}" != "value-active" ]]; then
  echo "usage: $0 [output] [scenario-limit] [shadow|guarded-shadow|active|strict-active|value-active] [cohort-role]" >&2
  exit 2
fi

cd "${ROOT}"
BP_COHORT_ROLE="${ROLE}" bash tools/base-policy-kernel-bp42.sh \
  "${OUTPUT}" "${LIMIT}" "${MODE}" "${EXTRA_ARGS[@]}"
