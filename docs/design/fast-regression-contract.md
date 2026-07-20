# Fast Regression Contract

## Physical ownership

The subsystem has three non-overlapping physical roots:

- code: `tools/agentank/fast-regression/`
- tests: `test/fast-regression/`
- evidence: `artifacts/fast-regression/`

It does not write into IMP, SR, Candidate, publish, or official-simulation directories.
`artifacts/fast-regression/properties.json` is the machine-readable authority for these
properties.

## Artifact attributes

Every finalized battle run is immutable, append-only, content-addressed, source-bound,
simulator-rule-bound, and explicitly `COMPLETE` or `PARTIAL`. The five evidence streams are
stored as deterministic gzip JSONL: match summaries, scheduled step traces, decision traces,
replay events, and selected windows.

Every Replay Capsule is self-contained and rehydratable. Its persisted truth is:

1. exact historical map, starts, skills, star schedule, seed, and pinned simulator identity;
2. every scheduled physical-frame action before the evaluation root;
3. every V2 decision-frame action and work-unit observation;
4. event and observation fingerprints;
5. V1 source, V2 source, and parameter fingerprints.

Opaque JavaScript engine dumps are forbidden. Plans and caches are never restored. They start
cold; only physical state and cross-frame fact memory are reconstructed.

## Test layers

1. `MINIMAX_ORACLE`: independent slow recursive solver, exhaustive/random depth 1–4,
   proof differential, metamorphic properties, and mutation score.
2. `ROOT`: restore one historical root and enforce Hard, Proof, completeness, domination,
   and root-restore invariants. Action equality is diagnostic only.
3. `WINDOW`: event-selected 4–8 frame capsules. Long-lived projectile/bomb evidence remains
   in the prefix even when the visible window is shorter.
4. `SMOKE`: deterministic greedy set cover, normally at most 64 capsules.
5. `MINIMAX_IMPACTED`, `TERMINAL_ALL`, and `CAPSULE_ALL`: progressively broader reusable
   regression lanes.
6. small/full arena: acceptance only, not the edit-test inner loop.

## Decision-memory boundary

`ProductionRootEngine.observeOnly()` updates observation reconciliation, committed and possible
projectiles, bombs, hidden-state facts, opponent events, action history, and deterministic runtime
state. It does not execute Proof, Minimax, StageMatrix, tactical scoring, or Plan selection.

The required differential invariant is that normal `decide()` and `observeOnly()` produce the
same `V2_DECISION_FACT_MEMORY` fingerprint for the same observation/action prefix. Search caches,
plans, selector results, and query counters are deliberately outside that fingerprint.

## Dynamic history and old evidence

`history-index` consumes the current V1 match index every time; no scenario count is frozen.
`legacy-index` inventories older arena reports without fabricating missing traces. A report without
scheduled step prefixes is marked non-rehydratable and requires one deliberate backfill run.
New history is ingested as a delta and the fast cohort is rebuilt deterministically.

## Absolute gates

- avoidable Hard reject = 0;
- strict Proof on incomplete InformationState = 0;
- selected risk-dominated action = 0;
- root restore failure = 0;
- incomplete support is never exact or strict Proof;
- mutation score = 10000/10000.

Historical action equality and local runtime winner are not pass/fail gates.
