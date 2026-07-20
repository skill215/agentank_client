# Fast Regression Subsystem

This directory is the only source-code authority for reusable V1/V2 battle evidence,
Replay Capsules, fast cohorts, and the independent Minimax oracle.

Physical isolation:

- source: `tools/agentank/fast-regression/`
- tests: `test/fast-regression/`
- immutable evidence: `artifacts/fast-regression/`

The artifact root has explicit properties in `artifacts/fast-regression/properties.json`.
It never overwrites IMP/SR artifacts. A finalized run is append-only and content-addressed.
A Replay Capsule persists an initial scenario and the scheduled action prefix, not an
opaque JavaScript object dump. Plans and caches are deliberately cold after rehydration.
