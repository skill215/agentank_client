#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="${1:-/tmp/agentank-bp174-native-base-policy-candidate}"

cd "${ROOT}"
node tools/agentank/build/base-policy-candidate-builder.js "${ROOT}" "${OUTPUT}"
