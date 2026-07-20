# Possible-projectile path support and shared-cache repair

## Result

This repair extends the four-frame quantitative Safety path from future enemy `FIRE` to tracked
possible projectiles without changing Hard, Proof, the frozen V1, or any historical Candidate. It
uses the persisted Native-poison death/control cohort; no new V1/V2 arena was run.

Against the preceding R6 source, current V2 changes five additional avoidable fatal decisions into
fixed-continuation survivors. No preceding survivor is lost, all 96 controls have zero survival
regression, exact replay failures remain zero, and the one-step `PROVEN_SAFE` contradiction count is
zero.

The validated working-source SHA-256 is
`51dd20eb96eda192d7129a769caaf7f4c2ccfc84c4ff82fb261a11ed70feed79`.

## Structural change

`InformationSafetyClosure` keeps committed physical death, tracked-possible-projectile death, future
enemy-FIRE death, and unknown support in separate integer slabs. `MultiFrameRiskBounds` then solves
future FIRE and possible-projectile hazards under one future action policy. It publishes only after
the complete comparable root action/Chance set is solved; incomplete hidden world, projectile,
capability, Chance, capacity, or budget support still publishes no partial row.

`PossibleProjectileTracker` now owns one fixed four-frame directional hazard field. Its key is the
tracker trajectory version, state identity, terrain version, and requested horizon. The same field is
shared by all root candidates, `InformationSafetyClosure`, and `MultiFrameRiskBounds`. It is invalidated
by reset, projectile creation/advance, or terrain change. Generation stamps avoid clearing the full
map, and the hot path allocates no temporary object.

This cache does not merge projectiles. Each track keeps its own pool handle, generation, direction,
mass, and physical lifetime. The field stores the maximum mass per `(frame, cell, direction)` only as
a derived query cache.

## Executable correctness constraints

The SR2 differential UT reconstructs the former direct-scan definition independently and compares it
with the shared field for three crossing projectiles, different masses, wall/dirt invalidation, every
map cell, every candidate direction, and horizons one through four. It also proves:

- all candidates share one projection for a fixed trajectory/terrain revision;
- tracker reset/generation reuse cannot leak an old cell;
- terrain-version changes rebuild the field;
- unresolved possible-projectile support prevents joint path publication;
- source-specific risk ownership cannot overwrite committed physical death;
- the permanent historical fixture preserves all older survivors and the five new survivors.

The complete SR0-SR4, Minimax-core, and fast-regression gate passes **162/162**.

## Historical outcome

The source-bound focused report is
`artifacts/fast-regression/reports/native-poison-death-possible-projectile-path-r10-final/1aaa6bc4a22a8b8487474c826e6bd0940896822d522e9ded7c4a3074b3d0b4bf.json`.

| Fixed-continuation classification | R6 | Current | Delta |
|---|---:|---:|---:|
| Current action survives | 20 | 25 | +5 |
| Current action dies | 145 | 140 | -5 |
| No acceptable rescue | 38 | 40 | +2 |
| Every acceptable rescue dominated | 65 | 61 | -4 |
| Non-dominated rescue below robust floor | 28 | 25 | -3 |
| Rescue at/above floor but fatal policy selected | 14 | 14 | 0 |
| Previously surviving primary decision lost | 0 | 0 | 0 |
| Control survival regression | 0 | 0 | 0 |

The five new survivors are:

- `mat_D4Y0spBqIy5CEuWNa:NATIVE_V1_SEAT0:r0`, frame 89: `GO -> CAST_POISON`;
- the same match, frame 90: `GO -> TURN_LEFT`;
- `mat_5Jf3hnxmURxAePYqM:NATIVE_V1_SEAT0:r0`, frame 17: `GO -> FIRE`;
- `mat_6LwmI5DD4N9Kt87Sk:NATIVE_V1_SEAT0:r0`, frame 105: `GO -> TURN_LEFT`;
- `mat_1cgtRZXZzoJBXnqMx:NATIVE_V2_SEAT0:r0`, frame 51: `TURN_RIGHT -> GO`.

These are causal only under the persisted historical continuation. They are not new whole-match wins.

## Remaining main cause

The reusable classifier report is
`artifacts/fast-regression/reports/dominated-rescue-r10-final-analysis/0a30600f2ad0a5ff557ac3d7228e9c6b80f19a6c696e78355dd9c809c777a3f7.json`.

The 61 remaining dominated-rescue frames split as follows:

| Root cause | Frames |
|---|---:|
| Possible projectile plus incomplete hidden-world path support | 27 |
| Complete path, value-depth non-discrimination | 20 |
| Path-risk inversion | 2 |
| Path frontier not activated | 4 |
| Incomplete hidden-world support only | 3 |
| Incomplete possible-projectile support only | 1 |
| Other incomplete support | 4 |

Before this repair, 13 dominated frames were classified as possible-projectile-only incomplete. That
bucket is now one. Seven newly complete cases moved into value-depth diagnosis, so the value bucket's
increase from 13 to 20 is a more precise classification, not a gameplay regression.

The next structural target is therefore the 27-frame intersection between hidden-world support and
possible projectiles. It must close the joint InformationState/observation policy or preserve an
explicit conservative residual. Marking hidden support complete merely because an explicit prefix
fits in 128 cells, independently minimizing each hazard source, or changing Minimax scores would
violate the existing quantifier and strategy-consistency contracts.

That target is now closed by the separate conservative Risk-support relation documented in
[hidden-world-possible-projectile-joint-risk-repair.md](hidden-world-possible-projectile-joint-risk-repair.md).
The exact hidden support remains incomplete for Proof; only the allocation-free joint Risk envelope
is published.

## Performance

The immutable benchmark is
`artifacts/fast-regression/reports/multi-frame-risk-benchmark/fcb8c057ddf416975cf75b3039c125523412acdf674d4f273b28a59d0c31bc80.json`.
It uses Node v24.16.0, five warmup batches and five measured batches of 1,000 roots:

- ordinary composite P95: 1,258 microseconds, below the 3,108-microsecond gate;
- active future-FIRE P95: 7,884 microseconds;
- future-FIRE plus possible-projectile P95: 8,881 microseconds;
- possible path / adjacent active-threat P95: 112.64%, below the 120% gate;
- tracked hot allocations: zero.

Local microbenchmarks remain relative engineering evidence and do not replace the official platform
three-second evidence.
