#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ "${1:-}" == --* ]]; then
  exec node "$ROOT/tools/agentank/diagnostics/native-base-policy-standalone-arena.js" "$@"
fi
exec node "$ROOT/tools/agentank/diagnostics/native-base-policy-standalone-arena.js" \
  --role "${1:-DISCOVERY}" --limit "${2:-16}" \
  --output "${3:-/tmp/agentank-bp179-native-standalone-fixed16}"
