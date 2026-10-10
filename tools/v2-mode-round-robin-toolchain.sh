#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec "$ROOT/tools/wsl-node.sh" "$ROOT/tools/agentank/cli/v2-mode-round-robin-ops.js" "$@"
