#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
COMMIT=1ef804eb2c187138c4c8e5229fb37cd0126beddf
ARCHIVE_SHA256=b9498c1a7d8a2d5bcc015c05fe838ca5a87b7c211629884d3a830cfb6eae70a4
VENDOR_ROOT="$ROOT/artifacts/vendor"
DOWNLOAD_ROOT="$VENDOR_ROOT/downloads"
ARCHIVE="$DOWNLOAD_ROOT/agentank-simulator-$COMMIT.tar.gz"
TARGET="$VENDOR_ROOT/agentank-simulator-$COMMIT"
URL="https://github.com/cyhhao/agentank-simulator/archive/$COMMIT.tar.gz"

mkdir -p "$DOWNLOAD_ROOT"

if [ ! -f "$ARCHIVE" ]; then
  TEMPORARY="$ARCHIVE.tmp-$$"
  curl -fsSL "$URL" -o "$TEMPORARY"
  ACTUAL=$(sha256sum "$TEMPORARY" | awk '{print $1}')
  if [ "$ACTUAL" != "$ARCHIVE_SHA256" ]; then
    echo "agentank-simulator archive hash mismatch: $ACTUAL" >&2
    exit 3
  fi
  mv "$TEMPORARY" "$ARCHIVE"
fi

ACTUAL=$(sha256sum "$ARCHIVE" | awk '{print $1}')
if [ "$ACTUAL" != "$ARCHIVE_SHA256" ]; then
  echo "cached agentank-simulator archive hash mismatch: $ACTUAL" >&2
  exit 3
fi

if [ ! -f "$TARGET/src/index.js" ]; then
  tar -xzf "$ARCHIVE" -C "$VENDOR_ROOT"
fi

if [ ! -f "$TARGET/src/index.js" ]; then
  echo "pinned agentank-simulator extraction is incomplete" >&2
  exit 4
fi

printf '%s\n' "$TARGET"
