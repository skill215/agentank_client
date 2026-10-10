#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

node tools/agentank/diagnostics/base-policy-search-reachability-audit.js \
  "${ROOT}" \
  "${1:-/tmp/agentank-bp159-opponent-native-active}" \
  "${2:-/tmp/agentank-bp160-search-method-census-fixed16}" \
  "${3:-/tmp/agentank-bp160-native-no-oracle-fixed16}" \
  "${4:-/tmp/agentank-bp160-native-no-oracle-census-fixed16}" \
  "${5:-/tmp/agentank-bp159-opponent-native-discovery64}" \
  "${6:-/tmp/agentank-bp160-native-no-oracle-discovery64}" \
  "${7:-/tmp/agentank-bp163-star-cache1-fixed16}" \
  "${8:-/tmp/agentank-bp163-star-cache2-fixed16}" \
  "${9:-/tmp/agentank-bp163-star-cache4-fixed16}" \
  "${10:-/tmp/agentank-bp164-leaf-path-cache2-census-fixed16}" \
  "${11:-${ROOT}/config/engine-v3/base-policy-kernel-bp160-search-reachability-evidence.json}"
