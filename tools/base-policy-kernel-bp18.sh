#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="${1:-/tmp/agentank-base-policy-bp18-shadow}"
LIMIT="${2:-16}"
MODE="${3:-shadow}"
EXTRA_ARGS=("${@:4}")
ENVELOPE_DEPTH="${BP_ENVELOPE_DEPTH:-2}"
ENVELOPE_BUDGET="${BP_ENVELOPE_BUDGET:-384}"
COHORT_ROLE="${BP_COHORT_ROLE:-DISCOVERY}"
if [[ "${MODE}" != "shadow" && "${MODE}" != "active" ]]; then
  echo "usage: $0 [output] [scenario-limit] [shadow|active]" >&2
  exit 2
fi

cd "${ROOT}"
node tools/agentank/diagnostics/v2-native-initiative-arena.js \
  --experiment NATIVE_BOUNDED_POLICY_DIFFERENTIAL_ORACLE_ACTIVE \
  --role "${COHORT_ROLE}" --limit "${LIMIT}" --skill-mode STUN \
  --bounded-policy-active-owner v3-base \
  --bounded-policy-own-skill-domain active \
  --bounded-policy-intent v1 --bounded-policy-intent-map v1-action \
  --bounded-policy-intent-continuity v1-epoch \
  --bounded-policy-intent-classification v1-exact \
  --bounded-policy-root-domain v1-shaped \
  --bounded-policy-root-enemy-domain v1-shaped \
  --bounded-policy-root-column-order v1 --bounded-policy-domain full \
  --bounded-policy-deep-domain v1-shaped --bounded-policy-deep-fire v1-own \
  --bounded-policy-deep-skill both \
  --bounded-policy-stun-duration v1-countdown \
  --bounded-policy-own-chance v1-deterministic \
  --bounded-policy-leaf v1 --bounded-policy-path-utility v1-exact \
  --bounded-policy-superko v1 --bounded-policy-opponent v1-exact \
  --bounded-policy-depth-schedule v1-state --bounded-policy-terminal v1 \
  --bounded-policy-entry-projectile v1-entry \
  --bounded-policy-tactical-contact-mask 1 \
  --bounded-policy-support-owner exact \
  --bounded-policy-response-fire false \
  --bounded-policy-path-evidence single \
  --bounded-policy-resource-owner skill-dominance \
  --bounded-policy-candidate-forced-win shadow \
  --bounded-policy-candidate-exact-dominance shadow \
  --bounded-policy-candidate-proof-depth 4 \
  --bounded-policy-candidate-proof-budget 512 \
  --bounded-policy-response-envelope "${MODE}" \
  --bounded-policy-response-envelope-depth "${ENVELOPE_DEPTH}" \
  --bounded-policy-response-envelope-budget "${ENVELOPE_BUDGET}" \
  "${EXTRA_ARGS[@]}" \
  --output "${OUTPUT}"
