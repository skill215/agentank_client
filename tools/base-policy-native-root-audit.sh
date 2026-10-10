#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "${ROOT}"
node tools/agentank/diagnostics/base-policy-native-root-audit.js \
  "${ROOT}" \
  "${1:-/tmp/agentank-bp170-leaf-geometry-table-fixed16}" \
  "${2:-/tmp/agentank-bp172-native-root-fixed16-r3}" \
  "${3:-/tmp/agentank-bp170-thin-stack-discovery64}" \
  "${4:-/tmp/agentank-bp172-native-root-discovery64}" \
  "${5:-${ROOT}/config/engine-v3/base-policy-kernel-bp172-native-root-evidence.json}"
