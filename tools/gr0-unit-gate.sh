#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Codex/PowerShell launches can leak a Windows TEMP path into WSL. Node then
# tries to create fixtures on a read-only mount. Pin every test run to the
# native WSL temporary filesystem so the gate is reproducible.
export TMPDIR=/tmp
export TMP=/tmp
export TEMP=/tmp

syntax_files=(
  engine-v2/src/abi/policy-codes.js
  engine-v2/src/fast/deadline-kernel.js
  engine-v2/src/fast/hard-gate.js
  engine-v2/src/generated/policy-config.js
  engine-v2/src/policy/strategy-layer.js
  engine-v2/src/policy/strategy-selector.js
  engine-v2/src/runtime/escape-obligation.js
  engine-v2/src/runtime/controller.js
  engine-v2/src/runtime/production-root.js
  engine-v2/src/search/production-depth-search.js
  engine-v2/src/search/production-forced-win-search.js
  engine-v2/src/search/production-information-search.js
  engine-v2/src/search/root-transition-slab.js
  engine-v2/src/search/contender-frontier.js
  engine-v2/src/search/projectile-attack-closure.js
  engine-v2/src/search/risk-acceptance-controller.js
  tools/agentank/benchmark/projectile-survivor-frontier-benchmark.js
  tools/agentank/cli/artifact-retention-ops.js
  tools/agentank/cli/soft-stack-ablation-ops.js
  tools/agentank/cli/strategy-priority-sample-ops.js
  tools/agentank/cli/v1-v2-working-arena.js
  tools/agentank/diagnostics/gr0-change-ablation.js
  tools/agentank/diagnostics/gr0-parent-sample.js
  tools/agentank/diagnostics/soft-stack-ablation-runtime.js
  tools/agentank/diagnostics/soft-stack-ablation.js
  tools/agentank/diagnostics/strategy-priority-runtime.js
  tools/agentank/diagnostics/strategy-priority-sample.js
  tools/agentank/diagnostics/v1-v2-working-arena.js
  tools/agentank/fast-regression/death-category-probe.js
  tools/agentank/retention/artifact-retention.js
  tools/agentank/simulation/paired-arena.js
  tools/agentank/simulation/historical-scenarios.js
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
  test/sr4/projectile-attack-closure.test.js \
  test/sr4/projectile-survivor-frontier.test.js \
  test/imp8/production-root.test.js
