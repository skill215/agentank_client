#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ACTION=${1:-help}
if [ "$#" -gt 0 ]; then shift; fi
case "$ACTION" in
  bootstrap-simulator)
    exec "$ROOT/tools/bootstrap-local-simulator.sh"
    ;;
  arena)
    cd "$ROOT"
    exec "$ROOT/tools/wsl-node.sh" "$ROOT/tools/agentank/cli/imp8-arena.js" "$@"
    ;;
  calibrate)
    cd "$ROOT"
    exec "$ROOT/tools/wsl-node.sh" "$ROOT/tools/agentank/cli/imp8-ops.js" calibrate
    ;;
  compare-candidates)
    cd "$ROOT"
    exec "$ROOT/tools/wsl-node.sh" "$ROOT/tools/agentank/cli/imp8-compare-candidates.js" "$@"
    ;;
  freeze-candidate)
    cd "$ROOT"
    exec "$ROOT/tools/wsl-node.sh" "$ROOT/tools/agentank/cli/imp8-freeze.js" "$@"
    ;;
  reject-candidate)
    cd "$ROOT"
    exec "$ROOT/tools/wsl-node.sh" "$ROOT/tools/agentank/cli/imp8-reject-candidate.js" "$@"
    ;;
  g10a)
    cd "$ROOT"
    exec "$ROOT/tools/wsl-node.sh" "$ROOT/tools/agentank/cli/imp8-g10a.js" "$@"
    ;;
  runtime-evidence)
    cd "$ROOT"
    exec "$ROOT/tools/wsl-node.sh" "$ROOT/tools/agentank/cli/imp8-runtime-evidence.js" "$@"
    ;;
  trace-match)
    cd "$ROOT"
    exec "$ROOT/tools/wsl-node.sh" "$ROOT/tools/agentank/cli/imp8-trace-match.js" "$@"
    ;;
  verify)
    OUTPUT_DIR="$ROOT/artifacts/reports/imp8"
    TEST_OUTPUT="$OUTPUT_DIR/test-output.pending.tap"
    mkdir -p "$OUTPUT_DIR"
    cd "$ROOT"
    if "$ROOT/tools/wsl-npm.sh" run test:imp8-gate >"$TEST_OUTPUT" 2>&1; then TEST_EXIT=0
    else TEST_EXIT=$?; fi
    exec "$ROOT/tools/wsl-node.sh" "$ROOT/tools/agentank/cli/imp8-ops.js" verify \
      --test-output "$TEST_OUTPUT" --test-exit-code "$TEST_EXIT"
    ;;
  test) exec "$ROOT/tools/wsl-npm.sh" run test:imp8 ;;
  help|-h|--help)
    echo "usage: ./tools/imp8-toolchain.sh bootstrap-simulator|arena|calibrate|compare-candidates|freeze-candidate|reject-candidate|g10a|runtime-evidence|trace-match|verify|test"
    ;;
  *) echo "unknown IMP8 toolchain action: $ACTION" >&2; exit 2 ;;
esac
