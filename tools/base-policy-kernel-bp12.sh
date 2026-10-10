#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="${1:-/tmp/agentank-base-policy-bp12}"
BASE="${OUTPUT}/robust-base"
SOFT_ROBUST="${OUTPUT}/soft-in-robust"
SOFT_NOMINAL="${OUTPUT}/soft-nominal-only"
AUDIT="${OUTPUT}/audit"

mkdir -p "${OUTPUT}"

bash "${ROOT}/tools/base-policy-kernel-bp5.sh" native "${BASE}" 1 \
  --bounded-policy-response-fire false \
  --bounded-policy-path-evidence single >/dev/null
bash "${ROOT}/tools/base-policy-kernel-bp5.sh" native "${SOFT_ROBUST}" 1 \
  --bounded-policy-response-fire true \
  --bounded-policy-path-evidence single >/dev/null
bash "${ROOT}/tools/base-policy-kernel-bp5.sh" native "${SOFT_NOMINAL}" 1 \
  --bounded-policy-response-fire true \
  --bounded-policy-path-evidence split-nominal >/dev/null

node "${ROOT}/tools/agentank/diagnostics/base-policy-value-ownership-audit.js" \
  --base "${BASE}" --soft-robust "${SOFT_ROBUST}" \
  --soft-nominal "${SOFT_NOMINAL}" --output "${AUDIT}"
