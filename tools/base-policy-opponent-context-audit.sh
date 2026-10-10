#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"
node tools/agentank/diagnostics/base-policy-opponent-context-audit.js \
  "${ROOT}" \
  "${1:-/tmp/agentank-bp158-owner-domain-intent-thin-r2}" \
  "${2:-/tmp/agentank-bp159-opponent-native-active}" \
  "${3:-/tmp/agentank-bp159-opponent-native-gated}" \
  "${4:-/tmp/agentank-bp159-opponent-uniform-fixed16}" \
  "${5:-/tmp/agentank-bp159-opponent-oracle-discovery64}" \
  "${6:-/tmp/agentank-bp159-opponent-native-discovery64}" \
  "${7:-${ROOT}/config/engine-v3/base-policy-kernel-bp159-opponent-context-evidence.json}"
