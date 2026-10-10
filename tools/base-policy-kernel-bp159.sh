#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-native}"
OUTPUT="${2:-/tmp/agentank-base-policy-bp159-${MODE}}"
LIMIT="${3:-64}"
EXTRA=("${@:4}")

case "${MODE}" in
  oracle|uniform|native-shadow|native-gated|native) ;;
  *)
    echo "usage: $0 [oracle|uniform|native-shadow|native-gated|native] [output] [scenario-limit]" >&2
    exit 2
    ;;
esac

cd "${ROOT}"
node tools/agentank/diagnostics/v2-native-initiative-arena.js \
  --experiment NATIVE_BOUNDED_POLICY_DIFFERENTIAL_ORACLE_ACTIVE \
  --role DISCOVERY --limit "${LIMIT}" --skill-mode STUN \
  --bounded-policy-active-owner native \
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
  --bounded-policy-risk-frontier joint \
  --bounded-policy-risk-soft-band intent-known \
  --bounded-policy-intent-value bonus \
  --bounded-policy-owner-implementation thin \
  --bounded-policy-domain-implementation thin \
  --bounded-policy-intent-implementation thin \
  --bounded-policy-opponent-context "${MODE}" \
  --trace-all false --output "${OUTPUT}" "${EXTRA[@]}"
