#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec node --expose-gc \
  "$ROOT/tools/agentank/benchmark/base-policy-runtime-calibration.js" \
  "$ROOT" \
  "${1:-/tmp/agentank-bp170-leaf-geometry-table-fixed16/manifest.json}" \
  "${2:-$ROOT/config/engine-v3/base-policy-kernel-bp171-runtime-calibration.json}" \
  "${3:-5}" \
  "${4:-8}"
