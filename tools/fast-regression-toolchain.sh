#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
exec "$ROOT/tools/wsl-node.sh" "$ROOT/tools/agentank/cli/fast-regression-ops.js" "$@"
