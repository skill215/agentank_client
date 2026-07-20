# Hidden-world plus possible-projectile joint Risk repair

## Result

The 27 historical roots previously classified as
`PATH_SUPPORT_POSSIBLE_PROJECTILE_AND_HIDDEN_WORLD` now all complete the four-frame joint Risk
closure. None stops for support, capacity, or budget, and the root-cause bucket is reduced from 27
to zero.

This is a Safety/Risk repair, not an exact-state promotion. `hiddenSupportComplete` remains false for
all 27 roots, strict Proof remains unavailable, and no possible projectile becomes a Hard fact.

On the immutable Native-poison death/control cohort, fixed-continuation selected survivors increase
from 25 to 39. Exact replay failures, control survival regressions, one-step `PROVEN_SAFE`
contradictions, and root restore failures remain zero. No new V1/V2 arena was run.

## Quantifier boundary

Production now owns two separate hidden-state completeness relations:

- `hiddenSupportComplete` means the exact InformationState support is suitable for strict search or
  Proof;
- `hiddenRiskSupportComplete` means a conservative finite superset covers every relevant hidden
  position and direction for the four-frame Risk calculation.

The second relation can publish only multidimensional Safety/Risk values. It cannot write Hard,
`PROVEN_SAFE`, `PROVEN_DEAD`, or ForcedWin.

For a hidden enemy, a fixed pair of `Uint8Array` reachability planes propagates position-direction
support without temporary objects. Each frame includes wait/attack/skill hold, both turns, ordinary
GO, stun-reversed GO, and conservative one/two-cell boost movement. Teleport uses a bounded
all-traversable-cell superset and fails closed if it exceeds fixed support capacity. Direction masks
remain attached to compact hidden cells; future FIRE takes the worst supported direction.

Possible projectiles and future hidden FIRE are then evaluated in one `MultiFrameRiskBounds`
recurrence. The own continuation policy is indexed only by the own observable position-direction
state, so it cannot independently choose incompatible evasions for different hidden worlds or
projectile hypotheses. Publication remains atomic across every root action and ChanceOutcome.

## Performance structure

Threat work is cached per `(deadline, target cell)`. Hidden-world members are evaluated inside that
one allocation-free aggregate instead of being charged as separate search transitions. On the 27
historical roots:

- completed joint closures: 27/27;
- budget or capacity stops: 0;
- total aggregate threat nodes: 916;
- maximum aggregate threat nodes in one root: 49;
- tracked hot allocations: 0.

The source-bound 64-hidden-world composite benchmark is
`artifacts/fast-regression/reports/multi-frame-risk-benchmark/cb5e5af6f27f34ac0c6d7133be3d605a07953e1c69a8634b0ee279aee970ee00.json`.
With Node v24.16.0, five warmups, five measured batches, and 1,000 roots per batch:

- ordinary composite P95: 1,281 microseconds per batch;
- active future-FIRE P95: 7,926 microseconds per batch;
- future-FIRE plus possible projectile P95: 8,521 microseconds per batch;
- 64-world joint hidden composite P95: 133,926 microseconds per batch, or about 134 microseconds
  per root;
- hot allocations: zero.

The 64-world absolute gate is 150 microseconds per root. This accepted result is the predecessor for
future paired 120% gates; it is local relative engineering evidence, not platform timeout evidence.

## Historical outcome

The focused report is
`artifacts/fast-regression/reports/native-poison-death-hidden-possible-joint-r12-final/a2c468260b3c457153ebda37448e605994b249adf28a40f31b2293d11b1b4d2e.json`.
The reusable dominated-rescue analysis is
`artifacts/fast-regression/reports/dominated-rescue-hidden-possible-joint-r12-final/6b6dc0dd2c008e589dfe6503a17d25f93929e7e41a780270cce25eb0d60fe901.json`.

| Fixed-continuation classification | Previous | Current | Delta |
|---|---:|---:|---:|
| Current selected action survives | 25 | 39 | +14 |
| No acceptable rescue | 40 | 50 | +10 |
| Every acceptable rescue dominated | 61 | 48 | -13 |
| Non-dominated rescue below robust floor | 25 | 14 | -11 |
| Rescue at/above floor but fatal policy selected | 14 | 14 | 0 |
| Control survival regression | 0 | 0 | 0 |
| Exact replay failure | 0 | 0 | 0 |

Within the original 27 roots, three now select a fixed-continuation survivor. The other 24 are no
longer support defects: 14 are dominated-rescue/value-ordering cases, eight have no action inside the
current risk-acceptable set, and two have a rescue below the robust floor. The 14 dominated cases
split into seven path-risk inversions, six value-depth non-discriminations, and one value-ordering
override. Those are distinct subsequent repair surfaces; changing their scores inside this support
repair would mix layers and overfit historical continuations.

## Executable constraints

The SR2 unit tests cover atomic refusal, direction-mask worst support, Risk-only publication, and
Hard preservation. The permanent historical test loads all 27 immutable roots and requires:

- hidden strict support remains incomplete;
- conservative Risk support is complete;
- a possible projectile is present;
- `MultiFrameRiskBounds` returns `APPLIED` with no interruption;
- strict Proof is not produced;
- at least the three observed fixed-continuation rescues remain selected.
