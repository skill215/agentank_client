#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ACTION=${1:-help}
if [ "$#" -gt 0 ]; then shift; fi

case "$ACTION" in
  verify)
    if [ "${1:-}" != "--stage" ] || [ "$#" -ne 2 ]; then
      echo "verify requires exactly --stage SR<n>" >&2; exit 2
    fi
    STAGE=$2; OUTPUT="$ROOT/artifacts/reports/structural-repair/$STAGE"
    TEST_OUTPUT="$OUTPUT/test-output.pending.tap"; mkdir -p "$OUTPUT"; cd "$ROOT"
    if "$ROOT/tools/wsl-npm.sh" run "test:${STAGE#SR}" >"$TEST_OUTPUT" 2>&1; then TEST_EXIT=0
    else TEST_EXIT=$?; fi
    exec "$ROOT/tools/wsl-node.sh" "$ROOT/tools/agentank/cli/structural-repair-ops.js" verify \
      --stage "$STAGE" --test-output "$TEST_OUTPUT" --test-exit-code "$TEST_EXIT"
    ;;
  accept)
    if [ "${1:-}" != "--stage" ] || [ "$#" -ne 2 ]; then
      echo "accept requires exactly --stage SR<n>" >&2; exit 2
    fi
    STAGE=$2
    "$ROOT/tools/structural-repair-toolchain.sh" verify --stage "$STAGE"
    exec "$ROOT/tools/wsl-node.sh" "$ROOT/tools/agentank/cli/structural-repair-ops.js" accept --stage "$STAGE"
    ;;
  help|-h|--help)
    exec "$ROOT/tools/wsl-node.sh" "$ROOT/tools/agentank/cli/structural-repair-ops.js" help
    ;;
  *) echo "unknown structural repair action: $ACTION" >&2; exit 2 ;;
esac
