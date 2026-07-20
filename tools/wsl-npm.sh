#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
VERSION=$(tr -d '[:space:]' < "$ROOT/.nvmrc")
NVM_ROOT=${NVM_DIR:-"$HOME/.nvm"}
NODE_DIR="$NVM_ROOT/versions/node/v$VERSION/bin"

if [ ! -x "$NODE_DIR/node" ] || [ ! -x "$NODE_DIR/npm" ]; then
  echo "WSL Node/npm $VERSION not found under $NODE_DIR" >&2
  exit 127
fi

if [ "$("$NODE_DIR/node" -p process.platform)" != "linux" ]; then
  echo "Refusing non-WSL Node runtime" >&2
  exit 126
fi

TMPDIR=${AGENTANK_TMPDIR:-/tmp}
npm_config_cache=${AGENTANK_NPM_CACHE:-/tmp/agentank-npm-cache}
export TMPDIR npm_config_cache
PATH="$NODE_DIR:$PATH" exec "$NODE_DIR/npm" "$@"
