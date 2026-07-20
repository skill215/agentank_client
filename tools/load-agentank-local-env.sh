#!/usr/bin/env sh

# This file is sourced by toolchain wrappers. It intentionally emits nothing.
AGENTANK_LOCAL_ENV_FILE=${AGENTANK_LOCAL_ENV_FILE:-"$ROOT/.env.agentank.local"}
if [ -f "$AGENTANK_LOCAL_ENV_FILE" ]; then
  PERMISSIONS=$(stat -c '%a' "$AGENTANK_LOCAL_ENV_FILE")
  case "$PERMISSIONS" in
    400|600|777) ;;
    *)
      echo "local AgentTank environment file must have mode 400/600, or DrvFS mode 777" >&2
      return 9 2>/dev/null || exit 9
      ;;
  esac
  set -a
  # shellcheck disable=SC1090
  . "$AGENTANK_LOCAL_ENV_FILE"
  set +a
fi
