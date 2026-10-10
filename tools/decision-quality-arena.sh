#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMMAND="${1:-run}"
shift || true

case "$COMMAND" in
  freeze|verify|report)
    exec node "$ROOT_DIR/tools/agentank/diagnostics/decision-quality-arena.js" \
      "$COMMAND" --root "$ROOT_DIR" "$@"
    ;;
  run)
    LABELS="${DECISION_QUALITY_LABELS:-/tmp/agentank-decision-quality-labels.json}"
    REPORT="${DECISION_QUALITY_REPORT:-/tmp/agentank-decision-quality-report.json}"
    node "$ROOT_DIR/tools/agentank/diagnostics/root-counterfactual-labels.js" \
      --branch-mode RESET_SUFFIX \
      --response-policies V2,V3 \
      --root-sampling STRATIFIED \
      --capture-outcomes V1_WIN,V2_WIN,DRAW \
      --output "$LABELS" "$@"
    exec node "$ROOT_DIR/tools/agentank/diagnostics/decision-quality-arena.js" \
      report --root "$ROOT_DIR" --input "$LABELS" --output "$REPORT"
    ;;
  *)
    echo "usage: $0 freeze|verify|run|report [options]" >&2
    exit 2
    ;;
esac
