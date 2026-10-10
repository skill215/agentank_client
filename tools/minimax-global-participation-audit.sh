#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="${1:-${ROOT}/config/engine-v3/base-policy-kernel-bp152-bp153-minimax-participation-evidence.json}"

cd "${ROOT}"
node tools/agentank/diagnostics/minimax-global-participation-audit.js \
  --input artifacts/v2-native-initiative/bp152-minimax-physical-search-ablation-discovery64 \
  --input artifacts/v2-native-initiative/bp153-minimax-information-participation-shadow-fixed16 \
  --output "${OUTPUT}"
