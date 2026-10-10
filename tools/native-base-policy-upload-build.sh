#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="${1:-/tmp/agentank-native-base-policy-upload}"
exec node "$ROOT/tools/agentank/build/native-base-policy-upload-builder.js" \
  "$ROOT" "$OUTPUT"
