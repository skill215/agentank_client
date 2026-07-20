#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
. "$ROOT/tools/load-agentank-local-env.sh"
ACTION=${1:-help}
if [ "$#" -gt 0 ]; then shift; fi

case "$ACTION" in
  preflight)
    cd "$ROOT"
    exec "$ROOT/tools/wsl-node.sh" "$ROOT/tools/agentank/cli/imp9-ops.js" preflight
    ;;
  simulate|publish|reconcile-simulation)
    cd "$ROOT"
    exec "$ROOT/tools/wsl-node.sh" "$ROOT/tools/agentank/cli/imp9-ops.js" "$ACTION" "$@"
    ;;
  verify)
    OUTPUT_DIR="$ROOT/artifacts/reports/imp9"
    TEST_OUTPUT="$OUTPUT_DIR/test-output.pending.tap"
    mkdir -p "$OUTPUT_DIR"
    cd "$ROOT"
    if "$ROOT/tools/wsl-npm.sh" run test:imp9-gate >"$TEST_OUTPUT" 2>&1; then TEST_EXIT=0
    else TEST_EXIT=$?; fi
    exec "$ROOT/tools/wsl-node.sh" "$ROOT/tools/agentank/cli/imp9-ops.js" verify \
      --test-output "$TEST_OUTPUT" --test-exit-code "$TEST_EXIT"
    ;;
  test) exec "$ROOT/tools/wsl-npm.sh" run test:imp9 ;;
  help|-h|--help)
    exec "$ROOT/tools/wsl-node.sh" "$ROOT/tools/agentank/cli/imp9-ops.js" help
    ;;
  *) echo "unknown IMP9 toolchain action: $ACTION" >&2; exit 2 ;;
esac
