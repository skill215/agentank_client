#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "${ROOT}"
node tools/agentank/diagnostics/base-policy-production-hook-audit.js \
  "${ROOT}" \
  "${1:-/tmp/agentank-bp170-leaf-geometry-table-fixed16}" \
  "${2:-/tmp/agentank-bp173-production-hook-off-fixed16-r2}" \
  "${3:-/tmp/agentank-bp173-production-hook-active-fixed16-r3}" \
  "${4:-/tmp/agentank-bp173-production-hook-active-fixed16}" \
  "${5:-/tmp/agentank-bp172-native-root-discovery64}" \
  "${6:-/tmp/agentank-bp173-production-hook-active-discovery64}" \
  "${7:-${ROOT}/config/engine-v3/base-policy-kernel-bp173-production-hook-evidence.json}"
