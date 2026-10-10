#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="${1:-${ROOT}/config/engine-v3/base-policy-kernel-bp178-footprint-evidence.json}"
node tools/agentank/build/base-policy-footprint-audit.js "${ROOT}" "${OUTPUT}"
