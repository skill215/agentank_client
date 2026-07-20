#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
VERSION=$(tr -d '[:space:]' < "$ROOT/.nvmrc")
NVM_ROOT=${NVM_DIR:-"$HOME/.nvm"}
NODE_BIN="$NVM_ROOT/versions/node/v$VERSION/bin/node"

if [ ! -x "$NODE_BIN" ]; then
  echo "WSL Node $VERSION not found at $NODE_BIN" >&2
  echo "Install it with NVM inside WSL; Windows node.exe is intentionally not used." >&2
  exit 127
fi

PLATFORM=$($NODE_BIN -p process.platform)
if [ "$PLATFORM" != "linux" ]; then
  echo "Refusing non-WSL Node runtime: $PLATFORM" >&2
  exit 126
fi

TMPDIR=${AGENTANK_TMPDIR:-/tmp}
export TMPDIR
exec "$NODE_BIN" "$@"
