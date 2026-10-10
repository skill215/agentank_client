#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIAGNOSTIC="${1:?diagnostic artifact directory required}"
THIN="${2:?thin artifact directory required}"
OUTPUT="${3:-$ROOT/config/engine-v3/base-policy-kernel-bp156-owner-migration-evidence.json}"

node "$ROOT/tools/agentank/diagnostics/base-policy-owner-migration-audit.js" \
  "$ROOT" "$DIAGNOSTIC" "$THIN" "$OUTPUT"
