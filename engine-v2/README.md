# engine-v2

The v2 production engine is isolated from the legacy tank. Platform tooling lives under `tools/agentank` and must never be imported into this directory's production bundle.

IMP2 implements the cold, object-oriented Reference Oracle under `src/reference`. It includes
ObservedRoot/TrackedState reconciliation, Physical/InformationState, canonical timeline and terminal
semantics, eight skill handlers, RuleCorpus loading, variant/UNKNOWN propagation and replayable traces.
It is deliberately excluded from the production bundle.

IMP3 implements the production `abi`, `state`, `fast`, and generated-capacity slice: TypedArray
SoA, reversible physical transitions, committed hazards, ReverseViability and per-action Hard.

IMP4 implements `search`: TypedArray InformationGraph, sound Value intervals, recursive integer
robust risk, restricted Double Oracle, integer mixed Policy, InformationState AND/OR/DFPN Proof,
CoverageCertificate and an explicit-stack Fast make/undo physical-tree bridge.

IMP5 implements `policy`: integer FeatureRegistry and Table/Generated evaluators, fixed profile
weights with action/Plan deltas, hysteretic StrategySelector, current-match OpponentModel, one
build-specialized own-skill emitter plus eight enemy descriptors, bounded Plan arenas and hidden
PossibleHazard features. Search always runs strict Proof before this layer; policy cannot write
Terminal, Hard, Proof or physical state. Cache/runtime/build tuning remain later stages.

Run `../tools/imp0-toolchain.sh verify` before adding physical code. The IMP0 gate fixes the
fixture seed, semantic/root comparators, allocation/high-water instrumentation, six performance
benchmark layers, and production allow/deny policy. Empty benchmark layers must remain `NOT_RUN`.

Run `../tools/imp2-toolchain.sh verify` for the Reference/G1 regression gate. The immutable IMP2
AcceptanceReport is `ACCEPTED`; unresolved RuleVariants remain explicit and cannot be guessed by IMP3.

Run `../tools/imp3-toolchain.sh verify` for the complete IMP0-IMP3 regression and Fast/Hard gate.
The immutable IMP3 AcceptanceReport is `ACCEPTED`; its capacity profile is correctness-oriented and
is not yet a platform-benchmarked release profile.

Run `../tools/imp4-toolchain.sh verify` for the complete IMP0-IMP4 regression and search-algorithm
gate. The immutable IMP4 AcceptanceReport is `ACCEPTED`; search capacities and risk tables are
correctness/build configured and remain uncalibrated for release.

Run `../tools/imp5-toolchain.sh verify` for the complete IMP0-IMP5 regression and integer-policy
gate. The immutable IMP5 AcceptanceReport is `ACCEPTED`; policy weights, alphas, capacities and
observed nanosecond metrics remain build-configured inputs for later calibration, not release claims.
