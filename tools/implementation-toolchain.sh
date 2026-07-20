#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ACTION=${1:-help}
if [ "$#" -gt 0 ]; then shift; fi

case "$ACTION" in
  accept)
    if [ "${1:-}" != "--stage" ] || [ "$#" -ne 2 ]; then
      echo "accept requires exactly --stage IMP<N>" >&2
      exit 2
    fi
    STAGE=$2
    if [ "$STAGE" = "IMP0" ]; then
      "$ROOT/tools/imp0-toolchain.sh" verify
    elif [ "$STAGE" = "IMP1" ]; then
      "$ROOT/tools/imp1-toolchain.sh" verify
    elif [ "$STAGE" = "IMP2" ]; then
      "$ROOT/tools/imp2-toolchain.sh" verify
    elif [ "$STAGE" = "IMP3" ]; then
      "$ROOT/tools/imp3-toolchain.sh" verify
    elif [ "$STAGE" = "IMP4" ]; then
      "$ROOT/tools/imp4-toolchain.sh" verify
    elif [ "$STAGE" = "IMP5" ]; then
      "$ROOT/tools/imp5-toolchain.sh" verify
    elif [ "$STAGE" = "IMP6" ]; then
      "$ROOT/tools/imp6-toolchain.sh" verify
    elif [ "$STAGE" = "IMP7" ]; then
      "$ROOT/tools/imp7-toolchain.sh" verify
    elif [ "$STAGE" = "IMP8" ]; then
      set +e
      "$ROOT/tools/imp8-toolchain.sh" verify
      GATE_EXIT=$?
      set -e
      if [ "$GATE_EXIT" -ne 0 ] && [ "$GATE_EXIT" -ne 8 ]; then
        exit "$GATE_EXIT"
      fi
    elif [ "$STAGE" = "IMP9" ]; then
      set +e
      "$ROOT/tools/imp9-toolchain.sh" verify
      GATE_EXIT=$?
      set -e
      if [ "$GATE_EXIT" -ne 0 ] && [ "$GATE_EXIT" -ne 8 ]; then
        exit "$GATE_EXIT"
      fi
    fi
    exec "$ROOT/tools/wsl-node.sh" "$ROOT/tools/agentank/cli/implementation-ops.js" \
      accept --stage "$STAGE"
    ;;
  help|-h|--help)
    exec "$ROOT/tools/wsl-node.sh" "$ROOT/tools/agentank/cli/implementation-ops.js" help
    ;;
  *)
    echo "unknown implementation toolchain action: $ACTION" >&2
    exit 2
    ;;
esac
