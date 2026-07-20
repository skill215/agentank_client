#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
. "$ROOT/tools/load-agentank-local-env.sh"
ACTION=${1:-help}
if [ "$#" -gt 0 ]; then shift; fi

case "$ACTION" in
  bootstrap)
    exec "$ROOT/tools/wsl-node.sh" "$ROOT/tools/agentank/cli/agentank-ops.js" bootstrap "$@"
    ;;
  doctor)
    exec "$ROOT/tools/wsl-node.sh" "$ROOT/tools/agentank/cli/agentank-ops.js" doctor "$@"
    ;;
  profiles)
    exec "$ROOT/tools/wsl-node.sh" "$ROOT/tools/agentank/cli/agentank-ops.js" profiles "$@"
    ;;
  context|register-tank|verify-profile|rotate-key|scan-secrets|validate-schema)
    exec "$ROOT/tools/wsl-node.sh" "$ROOT/tools/agentank/cli/agentank-ops.js" "$ACTION" "$@"
    ;;
  test)
    exec "$ROOT/tools/wsl-npm.sh" test
    ;;
  verify)
    "$ROOT/tools/wsl-node.sh" "$ROOT/tools/agentank/cli/agentank-ops.js" bootstrap
    "$ROOT/tools/wsl-node.sh" "$ROOT/tools/agentank/cli/agentank-ops.js" doctor
    "$ROOT/tools/wsl-node.sh" "$ROOT/tools/agentank/cli/agentank-ops.js" scan-secrets
    "$ROOT/tools/wsl-npm.sh" test
    ;;
  help|-h|--help)
    exec "$ROOT/tools/wsl-node.sh" "$ROOT/tools/agentank/cli/agentank-ops.js" help
    ;;
  *)
    echo "unknown platform-toolchain action: $ACTION" >&2
    exit 2
    ;;
esac
