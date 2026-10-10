#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="${1:-/tmp/agentank-base-policy-bp13}"
V3="${OUTPUT}/v3-only"
BUDGET="${OUTPUT}/budget-complete"
EXACT="${OUTPUT}/value-exact"
AUDIT="${OUTPUT}/audit"
COMMON=(--bounded-policy-response-fire false --bounded-policy-path-evidence single
  --bounded-policy-resource-owner skill-dominance)

mkdir -p "${OUTPUT}"
bash "${ROOT}/tools/base-policy-kernel-bp5.sh" v3-only "${V3}" 1 \
  --bounded-policy-support-owner strict "${COMMON[@]}" >/dev/null
bash "${ROOT}/tools/base-policy-kernel-bp5.sh" v3-base "${BUDGET}" 1 \
  --bounded-policy-support-owner strict "${COMMON[@]}" >/dev/null
bash "${ROOT}/tools/base-policy-kernel-bp5.sh" v3-base "${EXACT}" 1 \
  --bounded-policy-support-owner exact "${COMMON[@]}" >/dev/null
node "${ROOT}/tools/agentank/diagnostics/base-policy-host-ownership-audit.js" \
  --v3 "${V3}" --budget "${BUDGET}" --exact "${EXACT}" --output "${AUDIT}"
