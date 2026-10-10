#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OWNER="${1:-oracle}"
OUTPUT="${2:-/tmp/agentank-base-policy-bp3-${OWNER}}"
ROLE="${BP_COHORT_ROLE:-DISCOVERY}"
LIMIT="${BP_SCENARIO_LIMIT:-16}"
shift "$(( $# > 1 ? 2 : $# ))"

if [[ "${OWNER}" != "oracle" && "${OWNER}" != "native" &&
      "${OWNER}" != "hybrid" && "${OWNER}" != "v3-base" &&
      "${OWNER}" != "v3-only" ]]; then
  echo "usage: bash tools/base-policy-kernel-bp3.sh [oracle|native|hybrid|v3-base|v3-only] [output] [extra options]" >&2
  exit 2
fi

if [[ ! "${LIMIT}" =~ ^[1-9][0-9]*$ ]]; then
  echo "BP_SCENARIO_LIMIT must be a positive integer" >&2
  exit 2
fi

cd "${ROOT}"
node tools/agentank/diagnostics/v2-native-initiative-arena.js \
  --experiment NATIVE_BOUNDED_POLICY_DIFFERENTIAL_ORACLE_ACTIVE \
  --role "${ROLE}" \
  --limit "${LIMIT}" \
  --skill-mode STUN \
  --bounded-policy-active-owner "${OWNER}" \
  --bounded-policy-own-skill-domain active \
  --bounded-policy-intent v1 \
  --bounded-policy-intent-map v1-action \
  --bounded-policy-intent-continuity v1-epoch \
  --bounded-policy-intent-classification v1-exact \
  --bounded-policy-root-domain v1-shaped \
  --bounded-policy-root-enemy-domain v1-shaped \
  --bounded-policy-root-column-order v1 \
  --bounded-policy-domain full \
  --bounded-policy-deep-domain v1-shaped \
  --bounded-policy-deep-fire v1-own \
  --bounded-policy-deep-skill both \
  --bounded-policy-stun-duration v1-countdown \
  --bounded-policy-own-chance v1-deterministic \
  --bounded-policy-leaf v1 \
  --bounded-policy-path-utility v1-exact \
  --bounded-policy-superko v1 \
  --bounded-policy-opponent v1-exact \
  --bounded-policy-depth-schedule v1-state \
  --bounded-policy-terminal v1 \
  --bounded-policy-entry-projectile v1-entry \
  --output "${OUTPUT}" \
  "$@"
