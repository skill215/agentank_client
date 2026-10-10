#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-shadow}"
OUTPUT="${2:-/tmp/native-poison-attack-event-${MODE}-first16}"
BUDGET="${3:-2048}"
DEPTH="${4:-4}"
OFFSET="${5:-0}"
LIMIT="${6:-16}"
TRIGGER="${7:-all}"
COHORT="${8:-config/engine-v3/v3-repair-cohort.json}"
ROLE="${9:-DISCOVERY}"
SHARED_SEARCH="${10:-false}"
SNAPSHOT_SEARCH="${11:-false}"
LEAN_SEARCH="${12:-false}"

if [[ "${MODE}" != "shadow" && "${MODE}" != "active" ]]; then
  echo "usage: $0 [shadow|active] [output-directory] [node-budget] [depth] [offset] [limit]" >&2
  exit 2
fi
if [[ "${TRIGGER}" != "all" && "${TRIGGER}" != "axis" ]]; then
  echo "trigger must be all or axis" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

node tools/agentank/diagnostics/v2-native-initiative-arena.js \
  --experiment NATIVE_BOUNDED_POLICY_DIFFERENTIAL_ORACLE_ACTIVE \
  --cohort "${COHORT}" \
  --role "${ROLE}" \
  --skill-mode ASYMMETRIC \
  --offset "${OFFSET}" \
  --limit "${LIMIT}" \
  --bounded-policy-active-owner native \
  --bounded-policy-intent v1 \
  --bounded-policy-intent-map v1-action \
  --bounded-policy-intent-continuity v1-epoch \
  --bounded-policy-intent-classification v1-exact \
  --bounded-policy-resource-owner bomb-dominance \
  --bounded-policy-search-owner margin \
  --bounded-policy-verifier-margin 100 \
  --bounded-policy-own-skill-domain suppress-poison \
  --bounded-policy-poison-attack-event "${MODE}" \
  --bounded-policy-poison-attack-budget "${BUDGET}" \
  --bounded-policy-poison-attack-depth "${DEPTH}" \
  --bounded-policy-poison-attack-trigger "${TRIGGER}" \
  --bounded-policy-poison-attack-shared-search "${SHARED_SEARCH}" \
  --bounded-policy-poison-attack-snapshot-search "${SNAPSHOT_SEARCH}" \
  --bounded-policy-poison-attack-lean-search "${LEAN_SEARCH}" \
  --output "${OUTPUT}"
