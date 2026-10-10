#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OWNER="${1:-oracle}"
OUTPUT="${2:-/tmp/agentank-base-policy-bp2-${OWNER}}"
shift "$(( $# > 1 ? 2 : $# ))"

if [[ "${OWNER}" != "oracle" && "${OWNER}" != "native" ]]; then
  echo "usage: bash tools/base-policy-kernel-bp2.sh [oracle|native] [output]" >&2
  exit 2
fi

cd "${ROOT}"
node tools/agentank/diagnostics/v2-native-initiative-arena.js \
  --experiment NATIVE_BOUNDED_POLICY_DIFFERENTIAL_ORACLE_ACTIVE \
  --role DISCOVERY \
  --limit 16 \
  --skill-mode STUN \
  --bounded-policy-active-owner "${OWNER}" \
  --bounded-policy-intent v1 \
  --bounded-policy-intent-map v1-action \
  --bounded-policy-intent-continuity v1-epoch \
  --bounded-policy-intent-classification v1-exact \
  --bounded-policy-root-domain v1-shaped \
  --bounded-policy-root-enemy-domain tactical \
  --bounded-policy-domain full \
  --bounded-policy-deep-domain v1-shaped \
  --bounded-policy-deep-fire v1-own \
  --bounded-policy-deep-skill both \
  --bounded-policy-stun-duration v1-countdown \
  --bounded-policy-leaf v1 \
  --bounded-policy-path-utility v1-exact \
  --bounded-policy-superko v1 \
  --bounded-policy-opponent v1-exact \
  --bounded-policy-depth-schedule v1-state \
  --bounded-policy-terminal v1 \
  --bounded-policy-entry-projectile v1-entry \
  --output "${OUTPUT}" \
  "$@"
