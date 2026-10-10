#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PREVIOUS="${1:?previous artifact directory required}"
THIN="${2:?thin artifact directory required}"
OUTPUT="${3:-$ROOT/config/engine-v3/base-policy-kernel-bp157-domain-migration-evidence.json}"

node "$ROOT/tools/agentank/diagnostics/base-policy-domain-migration-audit.js" \
  "$ROOT" "$PREVIOUS" "$THIN" "$OUTPUT"
