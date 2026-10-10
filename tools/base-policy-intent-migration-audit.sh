#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PREVIOUS="${1:?previous artifact directory required}"
THIN="${2:?thin artifact directory required}"
OUTPUT="${3:-$ROOT/config/engine-v3/base-policy-kernel-bp158-intent-migration-evidence.json}"

node "$ROOT/tools/agentank/diagnostics/base-policy-intent-migration-audit.js" \
  "$ROOT" "$PREVIOUS" "$THIN" "$OUTPUT"
