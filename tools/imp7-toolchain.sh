#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ACTION=${1:-help}
if [ "$#" -gt 0 ]; then shift; fi
case "$ACTION" in
  verify)
    OUTPUT_DIR="$ROOT/artifacts/reports/imp7"
    TEST_OUTPUT="$OUTPUT_DIR/test-output.pending.tap"
    mkdir -p "$OUTPUT_DIR"
    cd "$ROOT"
    if "$ROOT/tools/wsl-npm.sh" run test:imp7-gate >"$TEST_OUTPUT" 2>&1; then TEST_EXIT=0
    else TEST_EXIT=$?; fi
    exec "$ROOT/tools/wsl-node.sh" "$ROOT/tools/agentank/cli/imp7-ops.js" verify \
      --test-output "$TEST_OUTPUT" --test-exit-code "$TEST_EXIT"
    ;;
  test) exec "$ROOT/tools/wsl-npm.sh" run test:imp7 ;;
  help|-h|--help) exec "$ROOT/tools/wsl-node.sh" "$ROOT/tools/agentank/cli/imp7-ops.js" help ;;
  *) echo "unknown IMP7 toolchain action: $ACTION" >&2; exit 2 ;;
esac
