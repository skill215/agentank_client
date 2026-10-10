#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-shadow}"
OUTPUT="${2:-/tmp/agentank-base-policy-bp17-${MODE}}"
LIMIT="${3:-64}"

FORCED="shadow"
EXACT="shadow"
case "${MODE}" in
  shadow) ;;
  forced) FORCED="active" ;;
  exact) FORCED="off"; EXACT="active" ;;
  *) echo "usage: $0 [shadow|forced|exact] [output] [scenario-limit]" >&2; exit 2 ;;
esac

cd "${ROOT}"
node tools/agentank/diagnostics/v2-native-initiative-arena.js \
  --experiment NATIVE_BOUNDED_POLICY_DIFFERENTIAL_ORACLE_ACTIVE \
  --role DISCOVERY --limit "${LIMIT}" --skill-mode STUN \
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
  --bounded-policy-candidate-forced-win "${FORCED}" \
  --bounded-policy-candidate-exact-dominance "${EXACT}" \
  --bounded-policy-candidate-proof-depth 4 \
  --bounded-policy-candidate-proof-budget 512 \
  --output "${OUTPUT}"
