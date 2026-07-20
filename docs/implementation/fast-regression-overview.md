# Fast Regression Implementation Overview

Status: implemented and locally testable.

The subsystem replaces repeated anonymous full-arena experiments with an evidence pipeline:

`history index -> append-only battle capture -> Replay Capsules -> deterministic cohort -> layered verify`.

Commands:

```sh
./tools/fast-regression-toolchain.sh init
./tools/fast-regression-toolchain.sh history-index
./tools/fast-regression-toolchain.sh sync-history
./tools/fast-regression-toolchain.sh legacy-index
./tools/fast-regression-toolchain.sh capture --delta-only --repetitions 1
./tools/fast-regression-toolchain.sh build-cohort --maximum 64
./tools/fast-regression-toolchain.sh verify --cohort current --lane minimax
./tools/fast-regression-toolchain.sh verify --cohort current --lane smoke
./tools/fast-regression-toolchain.sh analyze-run --run-id RUN_ID
./tools/fast-regression-toolchain.sh build-focused --run-id RUN_ID \
  --source-cohort initial-full --maximum-losses 64 --control-count 16 \
  --name native-poison-death
./tools/fast-regression-toolchain.sh diagnose-focused --cohort native-poison-death
./tools/fast-regression-toolchain.sh diagnose-focused --cohort native-poison-death \
  --primary-limit 16 --skip-controls --report-name native-poison-death-smoke
./tools/fast-regression-toolchain.sh compare-focused \
  --before-name BASELINE_REPORT --after-name CURRENT_REPORT \
  --verification-name capsule-all --output-name COMPARISON_REPORT
./tools/fast-regression-toolchain.sh build-safety-corpus --report-name native-poison-death
./tools/fast-regression-toolchain.sh verify-safety-repair \
  --report-name native-poison-death-safety-chance
./tools/fast-regression-toolchain.sh verify-observation-frontier
./tools/fast-regression-toolchain.sh compile-replay --cohort initial-full
./tools/fast-regression-toolchain.sh benchmark-replay \
  --cohort initial-full --maximum-matches 32
```

`capture` always persists traces; it has no `persist=false` mode. Full V1/V2 arena execution is
still required for SR acceptance and gameplay thresholds, but it is no longer required for every
Minimax logic or parameter edit.

If materialization is interrupted after a run is finalized, the complete spool is retained and can
be resumed without rerunning the arena:

```sh
./tools/fast-regression-toolchain.sh materialize-spool --spool DIRECTORY --run-id RUN_ID
```

The materializer validates the complete spool denominator, reuses identical immutable capsules,
and removes the spool only after every capsule is accepted. `verify --cohort NAME` binds a report
to a named cohort instead of silently relying on `current.json`.

`build-focused` creates a balanced Native poison/stun cohort from one immutable battle run. It
persists a compact, source-bound match index under `history/match-indexes`, so rebuilding cohorts
from the same run does not repeatedly parse the full compressed match stream. `diagnose-focused`
replaces the historical V2 action at each of the final four decision frames, then replays the
recorded continuation. The result is a causal diagnostic for that fixed continuation, not a proof
that the alternative policy wins against every enemy response.

The focused diagnostic has two execution lanes over the same immutable evidence. The default runs all
64 primary losses plus 96 controls. `--primary-limit 16 --skip-controls` is the edit-loop smoke lane;
it trims only the execution denominator and does not build a second cohort or change semantics. Root
states are reconstructed with the current V2 source in one shared simulator-prefix pass per Capsule.
Physical counterfactual branches are stored in a content-addressed batch and reused until the Capsule,
simulator rules, branch frame, terminal frame, or replacement action changes.

`compare-focused` performs a source-pair-bound, frame-for-frame comparison of two full focused
reports. Its frame identity includes role, match, Capsule and frame, so a Capsule reused as a loss
and a control cannot collide. The immutable result reports `death -> survival`, `survival -> death`,
entry-level rescue changes, controls, remaining failure surfaces and an optional full `capsule-all`
invariant report. A positive net change never hides individual survival regressions.

`build-safety-corpus` freezes proven one-step defects separately from multi-frame continuation
candidates. It must read the immutable pre-repair report; it must not be rebuilt from repaired output.
`verify-safety-repair` then performs a content-addressed before/after comparison and rejects any new
safe/fatal mismatch, Hard promotion, exact-replay error, control survival regression, or execution
failure.

`verify-observation-frontier` is the composite SR2 physical-frontier gate. It binds the full focused
diagnostic, physical/capability comparison, SR2 tests and P95, IMP6 local capacity, deterministic
build, and working-source identity into one content-addressed report. Any root-restore failure,
source drift, 1 MB overflow, or source/minified mismatch rejects the verification.

`capsule-all` uses the high-performance replay path. A full fingerprint or a cohort `relativePath`
is resolved directly; a verification run may never scan the complete capsule directory for each
lookup. `compile-replay` performs the expensive source-capsule verification once and produces one
content-addressed compressed memory image per immutable cohort. Future verification loads and
checks that image before executing any root.

The memory image groups by historical match, source run, simulator, assignment, and source binding.
Different capture runs are never merged merely because their public match id is equal. Within one
compatible group, the simulator advances the physical prefix once while each evaluation target owns
an independent cold `ProductionRootEngine`. Prefix divergence, observation divergence, event
divergence, denominator drift, or compressed/raw hash drift fails closed. This changes execution
cost only; physical fingerprints, fact-memory fingerprints, emitted actions, and invariant audits
must remain exactly equal to the legacy per-Capsule implementation.
