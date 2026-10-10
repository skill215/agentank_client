#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
node "$ROOT/tools/agentank/diagnostics/minimax-support-restoration-audit.js" "$ROOT" "${1:-$ROOT/config/engine-v3/base-policy-kernel-bp154-bp155-support-restoration-evidence.json}"
