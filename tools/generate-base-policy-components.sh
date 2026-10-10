#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec node "$ROOT/tools/agentank/build/generate-base-policy-components.js" "$ROOT"
