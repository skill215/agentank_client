#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OWNER="${1:-oracle}"
OUTPUT="${2:-/tmp/agentank-base-policy-bp5-${OWNER}}"
MASK="${3:-7}"
shift "$(( $# > 2 ? 3 : $# ))"

if [[ "${OWNER}" != "oracle" && "${OWNER}" != "native" &&
      "${OWNER}" != "hybrid" && "${OWNER}" != "v3-base" &&
      "${OWNER}" != "v3-only" ]]; then
  echo "usage: bash tools/base-policy-kernel-bp5.sh [oracle|native|hybrid|v3-base|v3-only] [output] [mask] [extra options]" >&2
  exit 2
fi

if [[ ! "${MASK}" =~ ^[0-7]$ ]]; then
  echo "mask must be an integer from 0 to 7" >&2
  exit 2
fi

exec bash "${ROOT}/tools/base-policy-kernel-bp3.sh" "${OWNER}" "${OUTPUT}" \
  --bounded-policy-tactical-contact-mask "${MASK}" \
  "$@"
