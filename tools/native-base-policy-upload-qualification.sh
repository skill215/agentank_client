#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec node "$ROOT/tools/agentank/build/native-base-policy-upload-qualification.js" \
  --root "$ROOT" "$@"
