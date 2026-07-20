# Multi-frame quantitative risk bounds structural repair

> Historical R6 record. The subsequent possible-projectile path and shared-cache extension is
> documented in [possible-projectile-path-support-repair.md](possible-projectile-path-support-repair.md).
> R6 artifacts remain immutable; statements below describing R6 as “current” are scoped to that
> historical checkpoint.

## Outcome

The production root now has an allocation-free, path-aware four-frame quantitative Safety stage for
future enemy `FIRE`. On the frozen focused historical cohort it preserves every previously observed
survival and changes five additional fatal root decisions into fixed-continuation survivors. It does
not write Hard or strict Proof, and it does not claim a new whole-match win rate.

The accepted working-source identity for this result is
`70a90a83f8dbb0ece8da2e6e83bf8e7e402e54ff54363ba13b3cd2225ca07fda`.

## Quantifier and ownership boundary

The stage consumes only complete support owned by Safety/Risk:

- every Hard-`ALLOW` root action in the selectable action set;
- every supported root `ChanceOutcome` geometry;
- one shared future policy over each observable physical state;
- the conservative maximum across stun-reversed future command geometries;
- hidden-world mass and opponent FIRE propensity as integer risk inputs.

It never converts a possible future enemy action into committed PhysicalState evidence. A completed
result can tighten `POSSIBLE_DEATH` mass and the multidimensional risk gate, but cannot produce a Hard
reject, `PROVEN_DEAD`, or forced-win certificate.

Publication is whole-set atomic. The implementation first writes fixed staging slabs. Budget stop,
capacity stop, incomplete Chance support, incomplete hidden support, or an unresolved possible
projectile publishes no row. Committed projectiles and bombs remain in the original physical Safety
slab and are never removed by this stage.

## Algorithm and memory layout

`MultiFrameRiskBounds` uses only constructor-owned integer TypedArrays. It builds the union of cells
and directions reachable from all root action/Chance supports, then performs one backwards four-frame
dynamic program over that union. Future `NONE`, `GO`, left turn, and right turn are evaluated. Active
stun expands `GO` into forward/backward support and turns into left/right support; the worse supported
continuation is retained without assuming a probability.

The risk recurrence uses integer contamination arithmetic:

`combined = immediate + ceil((10000 - immediate) * future / 10000)`.

Threat mass is cached once per `(depth, cell)` for the whole root. Generation stamps avoid clearing
large arrays. Only actually reachable state slots are written. The stage is event-driven: if the
existing Safety closure finds no future-FIRE frontier inside four frames, it returns without any path
work.

The original static future-FIRE estimate and the path estimate form a per-deadline maximum upper
envelope. A theoretical future escape therefore cannot erase risk before that future policy is
committed. Physical/committed death mass is stored separately from replaceable future-FIRE mass.

## Regression result

The final source-bound report is
`artifacts/fast-regression/reports/native-poison-death-multiframe-risk-r6-clean/09d1547088ec3c33abc501359794724b3dd49f5e81173693915b7aeed9ff07e3.json`.

| Metric | Quantifier/Chance baseline | Current | Delta |
|---|---:|---:|---:|
| Avoidable fatal frames with current survivor | 15 | 20 | +5 |
| Remaining avoidable fatal selections | 150 | 145 | -5 |
| No acceptable rescue | 27 | 38 | +11 reclassified |
| Every acceptable rescue dominated | 76 | 65 | -11 |
| Non-dominated rescue below robust floor | 33 | 28 | -5 |
| Rescue at/above floor but fatal policy chosen | 14 | 14 | 0 |
| Primary survival losses relative to baseline | 0 | 0 | 0 |
| Control survival regressions | 0 | 0 | 0 |

Across the 165 avoidable frames, 56 run the completed path stage, 104 fail closed because support is
incomplete, and five have no active future-FIRE frontier. The optimized path stage performs 1,995
unique threat evaluations in total on those frames, with a maximum of 51 on one root. Exact replay
failures and one-step `PROVEN_SAFE` contradictions are both zero.

The five net gains are executable real-history fixtures in
`test/fast-regression/chance-geometry-regression.test.js`. The same test also freezes all earlier
survivors and the unresolved-possible-projectile non-publication case.

Intermediate reports remain immutable and explain why the final boundary matters:

| Variant | Survivors | Survival loss | Disposition |
|---|---:|---:|---|
| R1, deterministic future cadence only | 19 | 0 | Superseded; unnecessary stun incompleteness |
| R2, stun support without possible-projectile guard | 21 | 1 | Rejected |
| R3, path risk excluded from acceptance | 16 | 0 | Rejected as too weak |
| R4, complete-input guard | 20 | 0 | Semantically accepted, then optimized |
| R5, union DP and generation cache | 20 | 0 | Semantically accepted |
| R6, dead-field cleanup | 20 | 0 | Current |

R2 is the key negative test: a path model that omitted an unresolved possible projectile raised all
safe turns above the risk threshold and left a fatal `GO`. R6 treats that missing input as incomplete
and publishes nothing, rather than adding a tactical exception for that historical state.

## Correctness and performance gates

The SR0-SR4, Minimax-core, and fast-regression suites pass 156/156. New UTs cover path separation,
whole-set atomic budget interruption, Chance maximum support, FIRE-probability monotonicity, complete
future-stun support, incomplete support, zero-frontier skip, and zero tracked hot allocation.

The reusable benchmark command is `npm run benchmark:multi-frame-risk`. Its immutable report is
`artifacts/fast-regression/reports/multi-frame-risk-benchmark/7e7a8540ef3e3cc517a25923c2bf7b672aa33e4ae827bc41362b60e67fce86e8.json`.
On Node v24.16.0, after two warmups and five measured batches of 1,000 roots:

- ordinary composite P95: 1,661 microseconds;
- predecessor P95: 2,590 microseconds;
- 120% limit: 3,108 microseconds;
- active-threat P95: 8,658 microseconds, or about 8.7 microseconds per root;
- last active root unique threat nodes: 32;
- tracked hot allocations: zero.

The active-threat number is deliberately reported separately; the zero-frontier fast path is not used
to hide the cost of actual path closure.

## Limits and next defect surface

This repair does not solve hidden-world path risk because current hidden support lacks a complete
direction/observation program. It also deliberately refuses to publish while an unresolved possible
projectile is outside the path model. Those cases stay in Risk/InformationState and fail closed.

The largest remaining bucket is still 65 frames where every fixed-continuation rescue is dominated.
The next analysis should separate those 65 by completed path coverage and value-search depth before
changing robust backup. A new complete V1/V2 arena, parameter calibration, Candidate freeze, and
official simulate remain later gates and were not run in this repair.
