#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROLE="${1:-DISCOVERY}"
LIMIT="${2:-16}"
SUPPORT="${3:-all}"
OUTPUT="${4:-/tmp/agentank-base-policy-v3-incumbent-${ROLE,,}-${LIMIT}-${SUPPORT}}"
EXTRA=("${@:5}")

case "${SUPPORT}" in
  all|strict|exact) ;;
  *)
    echo "usage: $0 [role] [scenario-limit] [all|strict|exact] [output] [extra options]" >&2
    exit 2
    ;;
esac

cd "${ROOT}"
exec node tools/agentank/diagnostics/v2-native-initiative-arena.js \
  --experiment NATIVE_BOUNDED_POLICY_DIFFERENTIAL_ORACLE_ACTIVE \
  --role "${ROLE}" --limit "${LIMIT}" --skill-mode STUN \
  --bounded-policy-active-owner v3-base \
  --bounded-policy-oracle-audit on \
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
  --bounded-policy-own-chance-mass support-uniform \
  --bounded-policy-leaf v1 --bounded-policy-path-utility v1-exact \
  --bounded-policy-superko v1 --bounded-policy-opponent v1-exact \
  --bounded-policy-depth 3 --bounded-policy-depth-schedule v1-state \
  --bounded-policy-budget 128 \
  --bounded-policy-terminal v1 --bounded-policy-entry-projectile v1-entry \
  --bounded-policy-tactical-contact-mask 1 \
  --bounded-policy-risk-frontier joint \
  --bounded-policy-risk-soft-band intent-known \
  --bounded-policy-intent-value bonus \
  --bounded-policy-chance-complete-escape on \
  --bounded-policy-contact-search-within-escape on \
  --bounded-policy-chance-survival-mass support-uniform \
  --bounded-policy-chance-survival-risk active \
  --bounded-policy-support-owner "${SUPPORT}" \
  --bounded-policy-owner-implementation thin \
  --bounded-policy-domain-implementation thin \
  --bounded-policy-opponent-context native \
  --trace-all false "${EXTRA[@]}" --output "${OUTPUT}"
