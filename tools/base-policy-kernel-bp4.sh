#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OWNER="${1:-oracle}"
OUTPUT="${2:-/tmp/agentank-base-policy-bp4-${OWNER}}"
shift "$(( $# > 1 ? 2 : $# ))"

if [[ "${OWNER}" != "oracle" && "${OWNER}" != "native" ]]; then
  echo "usage: bash tools/base-policy-kernel-bp4.sh [oracle|native] [output] [extra options]" >&2
  exit 2
fi

exec bash "${ROOT}/tools/base-policy-kernel-bp3.sh" "${OWNER}" "${OUTPUT}" \
  --bounded-policy-committed-search viable \
  "$@"
