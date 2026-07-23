#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

syntax_files=(
  engine-v2/src/fast/deadline-kernel.js
  engine-v2/src/runtime/escape-obligation.js
  engine-v2/src/runtime/production-root.js
  engine-v2/src/search/risk-acceptance-controller.js
  tools/agentank/cli/artifact-retention-ops.js
  tools/agentank/cli/v1-v2-working-arena.js
  tools/agentank/diagnostics/gr0-change-ablation.js
  tools/agentank/diagnostics/gr0-parent-sample.js
  tools/agentank/diagnostics/v1-v2-working-arena.js
  tools/agentank/fast-regression/death-category-probe.js
  tools/agentank/retention/artifact-retention.js
  tools/agentank/simulation/paired-arena.js
  tools/agentank/simulation/production-diagnostic-bot.js
)

for file in "${syntax_files[@]}"; do
  node --check "$file"
done

# Deliberately contains no battle-records, artifact baselines, replay capsules,
# focused cohorts, or simulator arenas. GR0 runs this gate once before the only
# full 6,608-match arena.
node --test --test-isolation=none --test-reporter=spec \
  test/minimax-core/*.test.js \
  test/gr0/*.test.js \
  test/sr1/projectile-track-pool.test.js \
  test/sr3/risk-acceptance-controller.test.js \
  test/sr3/deadline-kernel.test.js \
  test/sr3/escape-obligation.test.js \
  test/imp8/production-root.test.js
