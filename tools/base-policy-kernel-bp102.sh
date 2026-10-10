#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-iterative-q}"
OUTPUT="${2:-/tmp/agentank-base-policy-bp102-${MODE}}"
ROLE="${BP_COHORT_ROLE:-DISCOVERY}"
LIMIT="${BP_SCENARIO_LIMIT:-16}"
DEPTH="${BP_DEPTH:-4}"
BUDGET="${BP_BUDGET:-128}"
QPLY="${BP_QUIESCENCE_PLY:-3}"
QCONT="${BP_QUIESCENCE_CONTINUATION:-base-policy}"
OWNCONT="${BP_OWN_CONTINUATION:-full}"
LEAF_CLAMP="${BP_LEAF_CLAMP:-25000}"
LEAF_ABLATION="${BP_LEAF_ABLATION:-}"
SCENARIO_ID="${BP_SCENARIO_ID:-}"

case "${MODE}" in
  current) SCHEDULE="v1-state"; QUIESCENCE="off" ;;
  iterative) SCHEDULE="iterative-complete"; QUIESCENCE="off" ;;
  iterative-q) SCHEDULE="iterative-complete"; QUIESCENCE="projectile-bomb" ;;
  *) echo "usage: $0 [current|iterative|iterative-q] [output]" >&2; exit 2 ;;
esac

EXTRA=()
if [[ -n "${SCENARIO_ID}" ]]; then EXTRA+=(--scenario-id "${SCENARIO_ID}"); fi

cd "${ROOT}"
node tools/agentank/diagnostics/v2-native-initiative-arena.js \
  --experiment NATIVE_BOUNDED_POLICY_DIFFERENTIAL_ORACLE_ACTIVE \
  --role "${ROLE}" --limit "${LIMIT}" --skill-mode STUN \
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
  --bounded-policy-own-chance-mass support-uniform \
  --bounded-policy-leaf v1 --bounded-policy-path-utility v1-exact \
  --bounded-policy-superko v1 --bounded-policy-opponent v1-exact \
  --bounded-policy-depth "${DEPTH}" \
  --bounded-policy-depth-schedule "${SCHEDULE}" \
  --bounded-policy-budget "${BUDGET}" \
  --bounded-policy-event-quiescence "${QUIESCENCE}" \
  --bounded-policy-event-quiescence-ply "${QPLY}" \
  --bounded-policy-event-quiescence-continuation "${QCONT}" \
  --bounded-policy-own-continuation "${OWNCONT}" \
  --bounded-policy-terminal v1 --bounded-policy-entry-projectile v1-entry \
  --bounded-policy-tactical-contact-mask 1 \
  --bounded-policy-risk-frontier joint \
  --bounded-policy-risk-soft-band intent-known \
  --bounded-policy-intent-value bonus \
  --bounded-policy-chance-complete-escape on \
  --bounded-policy-contact-search-within-escape on \
  --bounded-policy-chance-survival-mass support-uniform \
  --bounded-policy-chance-survival-risk active \
  --bounded-policy-leaf-clamp "${LEAF_CLAMP}" \
  --bounded-policy-leaf-ablation "${LEAF_ABLATION}" \
  --trace-all false --output "${OUTPUT}" "${EXTRA[@]}"
