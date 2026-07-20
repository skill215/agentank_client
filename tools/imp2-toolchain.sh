#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
. "$ROOT/tools/load-agentank-local-env.sh"
ACTION=${1:-help}
if [ "$#" -gt 0 ]; then shift; fi

case "$ACTION" in
  verify)
    OUTPUT_DIR="$ROOT/artifacts/reports/imp2"
    TEST_OUTPUT="$OUTPUT_DIR/test-output.pending.tap"
    mkdir -p "$OUTPUT_DIR"
    cd "$ROOT"
    if "$ROOT/tools/wsl-npm.sh" run test:imp2-gate >"$TEST_OUTPUT" 2>&1; then
      TEST_EXIT=0
    else
      TEST_EXIT=$?
    fi
    exec "$ROOT/tools/wsl-node.sh" "$ROOT/tools/agentank/cli/imp2-ops.js" verify \
      --test-output "$TEST_OUTPUT" --test-exit-code "$TEST_EXIT"
    ;;
  test)
    exec "$ROOT/tools/wsl-npm.sh" run test:imp2
    ;;
  probe)
    exec "$ROOT/tools/wsl-node.sh" "$ROOT/tools/agentank/cli/imp2-ops.js" probe "$@"
    ;;
  probe-suite)
    exec "$ROOT/tools/wsl-node.sh" "$ROOT/tools/agentank/cli/imp2-ops.js" probe-suite "$@"
    ;;
  probe-reconcile)
    exec "$ROOT/tools/wsl-node.sh" "$ROOT/tools/agentank/cli/imp2-ops.js" probe-reconcile "$@"
    ;;
  probe-reconcile-suite)
    exec "$ROOT/tools/wsl-node.sh" "$ROOT/tools/agentank/cli/imp2-ops.js" probe-reconcile-suite "$@"
    ;;
  probe-capability-reconcile)
    exec "$ROOT/tools/wsl-node.sh" "$ROOT/tools/agentank/cli/imp2-ops.js" probe-capability-reconcile "$@"
    ;;
  help|-h|--help)
    exec "$ROOT/tools/wsl-node.sh" "$ROOT/tools/agentank/cli/imp2-ops.js" help
    ;;
  *)
    echo "unknown IMP2 toolchain action: $ACTION" >&2
    exit 2
    ;;
esac
