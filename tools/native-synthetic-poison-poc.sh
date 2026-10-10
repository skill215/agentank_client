#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-shadow}"
OUTPUT="${2:-/tmp/native-synthetic-poison-v1intentexact-${MODE}-first16}"

if [[ "${MODE}" != "shadow" && "${MODE}" != "active" ]]; then
  echo "usage: $0 [shadow|active] [output-directory]" >&2
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
  --bounded-policy-synthetic-poison "${MODE}" \
  --output "${OUTPUT}"
