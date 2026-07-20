# AgenTank platform toolchain

This directory is the shared control plane for v1, v2, and future TankProfiles. It is intentionally outside `engine-v2` and cannot be bundled into production tank code.

Use `../platform-toolchain.sh` for repeatable actions. `bootstrap` is idempotent: it creates missing directories and profiles but does not overwrite existing identity, baseline, run, corpus, or candidate artifacts.

IMP1 enables WSL runtime checks, profile bootstrap, secret-safe profile listing, authenticated context GET, explicit first-binding tankId confirmation, strict tankId/tankUrlId/skill/branch verification, local key-reference rotation, branch baseline archival, UNKNOWN-safe CapabilityProfile generation, deterministic hashing, atomic writes, and secret scanning. Simulation, publish, and challenge remain disabled until their manifest and authorization layers are implemented.

Repeatable profile operations are:

```text
../platform-toolchain.sh context --tank-profile v2 [--dry-run]
../platform-toolchain.sh register-tank --tank-profile v2 --expected-tank-id <id>
../platform-toolchain.sh verify-profile --tank-profile v2
../platform-toolchain.sh rotate-key --tank-profile v2 --secret-ref-env <ENV> \
  --key-generation <new> --expected-key-generation <current>
```

`--dry-run` resolves no secret and writes nothing. Rotation accepts an environment-variable name, never a key value, and commits the new reference only after a GET context proves that it still identifies the same tank. Bootstrap name/skill expectations are mismatch guards; only successful platform GET upgrades provenance to `PLATFORM_CONTEXT`.

The wrappers optionally load the Git-ignored `.env.agentank.local` into the environment before resolving registry secretRefs. This local credential input is never copied into registry, context, baseline, capability, test, or acceptance artifacts.

IMP0 has a separate network-free gate at `../imp0-toolchain.sh`. Its `verify` command owns the
repeatable engineering-foundation workflow and writes immutable evidence-shaped reports under
`artifacts/reports/imp0`. Do not reconstruct that workflow as ad-hoc shell commands.

IMP1 has its own gate at `../imp1-toolchain.sh` and independent acceptance at
`../implementation-toolchain.sh accept --stage IMP1`. Missing rotated keys or unbound profiles make
the stage `BLOCKED`; they never become a local PASS or a guessed platform identity.

IMP2 has a separate Reference/G1 gate at `../imp2-toolchain.sh`. Its `probe` action is narrower
than the future general simulation workflow: it permits only pre-registered official rule probes,
requires `--authorize-official-simulate`, verifies TankProfile identity, shares the owner cooldown,
and stores sanitized response evidence. It exposes neither publish nor challenge.

```text
../imp2-toolchain.sh test
../imp2-toolchain.sh verify
../imp2-toolchain.sh probe --probe-id P2-FAILED-CAST --profile v2 \
  --authorize-official-simulate
../imp2-toolchain.sh probe-reconcile --probe-id P2-FAILED-CAST
../imp2-toolchain.sh probe-suite --authorize-official-simulate
../imp2-toolchain.sh probe-reconcile-suite
../imp2-toolchain.sh probe-capability-reconcile --profile v2
../implementation-toolchain.sh accept --stage IMP2
```

`probe-suite` skips evidence already present, applies the shared owner cooldown, and never retries an
ambiguous POST automatically. `probe-reconcile-suite` re-runs only local analyzers over saved raw
responses. A valid `INCONCLUSIVE` result proves that the targeted official simulation ran but does
not upgrade a RuleVariant. Runtime probes are reconciled into the profile-specific
CapabilityProfile; current v2 evidence selects calibrated integer work counters and records the
separate 1500ms callback watchdog.

The local IMP2 gate may PASS while acceptance remains BLOCKED for missing official probe evidence;
this is intentional fail-closed behavior. FastKernel implementation is authorized only by the latest
immutable IMP2 AcceptanceReport.

IMP3 has a network-free Fast/Hard gate and independent acceptance:

```text
../imp3-toolchain.sh test
../imp3-toolchain.sh verify
../implementation-toolchain.sh accept --stage IMP3
```

It verifies fixed TypedArray layout, apply/undo, Reference differential, committed SourcePlans,
ReverseViability, per-action Hard, overflow semantics and hot-loop bounds. Its conservative capacity
profile is not a platform release profile.

IMP4 has a network-free Value/Matrix/Proof/Risk gate and independent acceptance:

```text
../imp4-toolchain.sh test
../imp4-toolchain.sh verify
../implementation-toolchain.sh accept --stage IMP4
```

It verifies sound intervals, separated uncertainty quantifiers, full best-response Double Oracle,
Coverage Proof/DFPN, recursive integer robust risk, deep Fast make/undo, exhaustive small-state
oracles, budget equivalence and bounded integer TypedArray search pools. It performs no official
simulation, publish or challenge.

IMP7 has an offline-only dynamic corpus gate and independent acceptance:

```text
../imp7-toolchain.sh test
../imp7-toolchain.sh verify
../implementation-toolchain.sh accept --stage IMP7
```

It rebuilds the append-only MatchLedger from the latest valid local aggregate without a fixed match
count, verifies the frozen legacy root, keeps v1/v2 denominators separate, extracts failure and
positive windows, and runs Truth/Observed-isolated counterfactual analysis from both sides. Missing
historical public inputs remain UNKNOWN. These modules stay outside `engine-v2/src` and never enter
the production tank bundle.

Public skill semantics are collected separately in the Discovery lane. A public tank name is enough
when it resolves to one exact result; duplicate names fail closed and require a public tank URL id.
The collector performs GET requests only, freezes the current recent-match index, saves
`summary/events/raw` plus SHA-256 metadata, and produces a skill-specific machine report:

```text
../skill-evidence-toolchain.sh collect --skill boost --tank-name '无米粿' --limit 10 \
  --known-matches mat_a,mat_b,mat_c --run-id boost-wumiguo-20260717-v1
../skill-evidence-toolchain.sh analyze --skill boost --tank-url-id tnk_9Gn7nNb7EqODtynnS \
  --run-id boost-wumiguo-20260717-v1
../skill-evidence-toolchain.sh regress
```

The number 10 is an initial discovery window, not an evidence guarantee. A skill claim remains
INCONCLUSIVE when the selected matches contain no relevant interaction. Discovery evidence may
create rule fixtures, but it is never silently added to Calibration or Frozen denominators. The
offline `analyze` command reuses the frozen artifacts and updates only the deterministic report and
manifest fingerprints; use it after an analyzer upgrade instead of downloading the matches again.
`regress` verifies every frozen replay artifact in the registered Discovery-only suite and reruns
the skill analyzers. It cannot tune parameters and contributes zero Calibration/Frozen members.

IMP8 candidate selection, freezing, and Frozen regression are separate repeatable actions:

```text
../imp8-toolchain.sh compare-candidates --plan config/engine-v2/imp8-candidate-comparison-v6.json
../imp8-toolchain.sh freeze-candidate --plan config/engine-v2/imp8-candidate-comparison-v6.json \
  --comparison artifacts/imp8/calibration/candidate-comparison-v6/candidate-comparison-report.json
../imp8-toolchain.sh reject-candidate
../imp8-toolchain.sh g10a
../imp8-toolchain.sh verify
../implementation-toolchain.sh accept --stage IMP8
```

Candidate comparison output is version-isolated by its plan filename. Freeze accepts only a full
pre-registered Calibration run with an unchanged v1 snapshot and a qualified selected candidate;
it embeds integer candidate configuration into byte-reproducible source/minified artifacts without
editing generated source files. G10A then runs every DD9 Frozen member and reruns the 40-match
Discovery skill corpus as a separate physical-rule regression gate.

`reject-candidate` requires a fingerprint-valid failed IMP8 Gate and writes an immutable disposition.
Only a rejected current Candidate may be superseded, and the successor id includes the production
source hash as well as the selected parameters.

IMP9 loads the same local environment wrapper as the platform and IMP2 tools. If an authorized
official suite stops before attestation, preserve and classify the partial attempt offline:

```text
../imp9-toolchain.sh reconcile-simulation
../imp9-toolchain.sh preflight
../imp9-toolchain.sh verify
```

Reconciliation performs no network request. Timeout, script failure, and missing mandatory cases
remain explicit failure evidence; they never become `NOT_RUN` or authorize publish.

The rejected frozen Candidate can be compared with the frozen v1 script on historical physical
scenarios without publishing or making network requests:

```text
../v1-v2-diagnostic.sh
../v1-v2-diagnostic.sh --limit 2 --repetitions 2 --max-traces 4 --output /tmp/v1-v2-probe
../v1-v2-diagnostic.sh --limit 8 --repetitions 4 --max-traces 8 \
  --progress-every 8 --output /tmp/v1-v2-repeat-4
```

The command prints exact-match and trace progress with percentage, elapsed time,
throughput, ETA, and cumulative new/resumed counts. Reusing the same output
directory with the same inputs resumes the immutable JSONL journal. Use a new
output directory when the requested repetitions or scenario set changes, or
when a fully fresh rerun is required.

The exact lane loads both frozen script byte streams, crosses seats and native/counterfactual skills,
and journals each match for fail-closed resume. Selected native failures are replayed with the same
v2 parameters through an instrumented mirror. Maps, starts, and historical star coordinates/earliest
frames are preserved. Results are Discovery-only: local runtime is not platform runtime, known
simulator deviations remain explicit, and any future Candidate requires a new holdout split.

For a structural working-tree candidate, use the separate source-addressed arena. It keeps the
Frozen candidate and its evidence immutable, reuses the Frozen v1 bytes and parameter profile,
crosses seats and skills, prints progress, and compares every common match ID with the Frozen v2
baseline:

```text
../v1-v2-working-arena.sh --limit 8 --repetitions 1 --progress-every 8
../v1-v2-working-arena.sh --repetitions 2 --progress-every 32
../v1-v2-working-arena.sh --repetitions 2 --trace actions --progress-every 32
../v1-v2-runtime-matrix.sh --progress-every 16
```

By default the working arena also appends every v1 scenario in the rolling corpus that is newer
than the locked 244-scenario DD9 assignment. Thus the validation denominator grows with downloaded
battles; `--no-rolling` exists only for an exact comparison with the old locked split.

`--trace actions` retains every V1/V2 action and local callback time. Each V2 frame also records
root, Hard, Proof, search depth/nodes and runtime mode. `--trace full` is intended for selected
failures because it additionally stores candidate rows, observed state and simulator replay events.

The runtime matrix replays identical observed-frame sequences through frozen V1 and every
pre-registered V2 fallback profile before running a paired gameplay sample. It records every
threshold and search budget with P50/P95/P99, strict invariants and selection provenance. These
same-input local ratios are suitable for relative tuning but do not replace the official platform
three-second gate.

The resulting overview is Discovery evidence. In particular, the vendored simulator's bomb phase
differs from the replay-confirmed platform phase, so local bomb deaths are reported but excluded
from platform-correctness claims.

Before freezing a release Candidate, combine the structural baseline, selected runtime matrix and
post-tuning action-trace arena into one content-addressed local qualification report:

```text
../v2-local-qualification.sh --pre <pre-tuning-overview.json> \
  --performance <runtime-matrix-report.json> --post <post-tuning-overview.json>
```

Any native win regression or `WIN_TO_LOSS` transition leaves explicit gameplay review pending.
The engine-level report must later be bound to the frozen Candidate id and exact publish hash;
IMP9 simulation admission fails closed when that attestation is absent.
