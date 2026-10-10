#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="${1:-/tmp/agentank-base-policy-bp11}"
DISCOVERY_OFF="${OUTPUT}/discovery-off"
DISCOVERY_ON="${OUTPUT}/discovery-on"
DISCOVERY_AUDIT="${OUTPUT}/discovery-audit"
ROOTS_OFF="${OUTPUT}/roots-off"
ROOTS_ON="${OUTPUT}/roots-on"
FINAL_AUDIT="${OUTPUT}/first-divergence"

mkdir -p "${OUTPUT}"

bash "${ROOT}/tools/base-policy-kernel-bp5.sh" native "${DISCOVERY_OFF}" 1 \
  --bounded-policy-response-fire false >/dev/null
bash "${ROOT}/tools/base-policy-kernel-bp5.sh" native "${DISCOVERY_ON}" 1 \
  --bounded-policy-response-fire true >/dev/null
node "${ROOT}/tools/agentank/diagnostics/base-policy-first-divergence-audit.js" \
  --off "${DISCOVERY_OFF}" --on "${DISCOVERY_ON}" \
  --output "${DISCOVERY_AUDIT}" >/dev/null

IDS="$(node -e "const o=require(process.argv[1]);process.stdout.write((o.outcomeChangedScenarioIds||[]).join(','))" \
  "${DISCOVERY_AUDIT}/overview.json")"
if [[ -z "${IDS}" ]]; then
  echo "BP11: no outcome-changing scenario; discovery evidence is ${DISCOVERY_AUDIT}"
  exit 0
fi

bash "${ROOT}/tools/base-policy-kernel-bp5.sh" native "${ROOTS_OFF}" 1 \
  --bounded-policy-response-fire false --scenario-id "${IDS}" \
  --bounded-policy-capture-roots true >/dev/null
bash "${ROOT}/tools/base-policy-kernel-bp5.sh" native "${ROOTS_ON}" 1 \
  --bounded-policy-response-fire true --scenario-id "${IDS}" \
  --bounded-policy-capture-roots true >/dev/null
node "${ROOT}/tools/agentank/diagnostics/base-policy-first-divergence-audit.js" \
  --off "${ROOTS_OFF}" --on "${ROOTS_ON}" --output "${FINAL_AUDIT}"
