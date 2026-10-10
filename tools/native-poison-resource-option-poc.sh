#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-shadow}"
OUTPUT="${2:-/tmp/native-poison-resource-option-v1intentexact-${MODE}-first16}"
BUDGET="${3:-2048}"
FEEDBACK="${4:-representative}"

if [[ "${MODE}" != "shadow" && "${MODE}" != "active" ]]; then
  echo "usage: $0 [shadow|active] [output-directory] [per-policy-node-budget] [representative|v1-shaped]" >&2
  exit 2
fi
if [[ "${FEEDBACK}" != "representative" && "${FEEDBACK}" != "v1-shaped" ]]; then
  echo "feedback must be representative or v1-shaped" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

node tools/agentank/diagnostics/v2-native-initiative-arena.js \
  --experiment NATIVE_BOUNDED_POLICY_DIFFERENTIAL_ORACLE_ACTIVE \
  --role DISCOVERY \
  --skill-mode ASYMMETRIC \
  --offset 0 \
  --limit 16 \
  --bounded-policy-active-owner native \
  --bounded-policy-intent v1 \
  --bounded-policy-intent-map v1-action \
  --bounded-policy-intent-continuity v1-epoch \
  --bounded-policy-intent-classification v1-exact \
  --bounded-policy-resource-owner bomb-dominance \
  --bounded-policy-search-owner margin \
  --bounded-policy-verifier-margin 100 \
  --bounded-policy-own-skill-domain suppress-poison \
  --bounded-policy-synthetic-poison shadow \
  --bounded-policy-poison-resource-option "${MODE}" \
  --bounded-policy-poison-option-budget "${BUDGET}" \
  --bounded-policy-poison-option-feedback "${FEEDBACK}" \
  --output "${OUTPUT}"
