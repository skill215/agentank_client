#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec node "$ROOT/tools/agentank/diagnostics/base-policy-thin-stack-audit.js" \
  "$ROOT" \
  "${1:-/tmp/agentank-bp163-star-cache2-fixed16}" \
  "${2:-/tmp/agentank-bp165-thin-full-fixed16}" \
  "${3:-/tmp/agentank-bp166-thin-noop-pruned-fixed16}" \
  "${4:-/tmp/agentank-bp169-root-topology-rebind-fixed16}" \
  "${5:-/tmp/agentank-bp170-leaf-geometry-table-fixed16}" \
  "${6:-/tmp/agentank-bp160-native-no-oracle-discovery64}" \
  "${7:-/tmp/agentank-bp170-thin-stack-discovery64}" \
  "${8:-$ROOT/config/engine-v3/base-policy-kernel-bp165-bp170-performance-evidence.json}"
