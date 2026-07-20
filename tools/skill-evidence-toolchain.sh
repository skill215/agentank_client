#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ACTION=${1:-help}
if [ "$#" -gt 0 ]; then shift; fi
exec "$ROOT/tools/wsl-node.sh" "$ROOT/tools/agentank/cli/skill-evidence-ops.js" "$ACTION" "$@"
