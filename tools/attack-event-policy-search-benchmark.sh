#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"
node tools/agentank/benchmark/attack-event-policy-search-benchmark.js "$@"
