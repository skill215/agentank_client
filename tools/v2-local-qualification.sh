#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"
exec "$ROOT/tools/wsl-node.sh" "$ROOT/tools/agentank/cli/v2-local-qualification.js" "$@"
