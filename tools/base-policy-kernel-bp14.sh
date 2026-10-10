#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="${1:-/tmp/agentank-base-policy-bp14}"
RUN="${OUTPUT}/value-exact"
CENSUS="${OUTPUT}/census"

mkdir -p "${OUTPUT}"
bash "${ROOT}/tools/base-policy-kernel-bp5.sh" v3-base "${RUN}" 1 \
  --bounded-policy-support-owner exact \
  --bounded-policy-response-fire false \
  --bounded-policy-path-evidence single \
  --bounded-policy-resource-owner skill-dominance >/dev/null
node "${ROOT}/tools/agentank/diagnostics/base-policy-exact-blocker-census.js" \
  --input "${RUN}" --output "${CENSUS}"
