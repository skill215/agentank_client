#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
. "$ROOT/tools/load-agentank-local-env.sh"
: "${AGENTANK_KEY_V1:?AGENTANK_KEY_V1 is required}"
export AGENTANK_KEY="$AGENTANK_KEY_V1"

STAMP=$(date '+%Y%m%d-%H%M-cst')
OUTPUT=${1:-"$ROOT/battle-records/all-missing-$STAMP"}
NODE="$ROOT/tools/wsl-node.sh"

"$NODE" "$ROOT/sync-missing-matches.js" "$ROOT/battle-records" "$OUTPUT"
"$NODE" "$ROOT/tools/matches/rebuild-batch-manifest.js" "$OUTPUT"
"$NODE" "$ROOT/tools/matches/build-match-index.js" "$ROOT/battle-records" "$ROOT/battle-records/index"
"$NODE" "$ROOT/tools/matches/build-tank-skill-index.js" "$ROOT/battle-records" "$ROOT/battle-records/index"
"$NODE" "$ROOT/batch-analyze-matches.js" "$OUTPUT"
"$NODE" "$ROOT/tools/matches/classify-match-batch.js" "$OUTPUT"
"$NODE" "$ROOT/tools/matches/write-batch-report.js" "$OUTPUT"

echo "$OUTPUT"
