# Current V2 full historical regression (R17 vs R12)

Status: completed on 2026-07-20. No new V1/V2 battle was generated.

## Result

The comparison binds baseline source `fe35647f...` to current source `1c825c88...` on the same
immutable `native-poison-death` cohort.

| Death-window outcome | R12 | R17 | Exact transition |
|---|---:|---:|---:|
| Selected action survives the recorded continuation | 39/256 | 49/256 | 14 death-to-survival, 4 survival-to-death |
| Historical death matches with at least one selected rescue in the final four decisions | 30/64 | 35/64 | 7 unrescued-to-rescued, 2 rescued-to-unrescued |
| Controls surviving | 68/96 | 68/96 | 0 regressions |

The current source therefore has ten net additional surviving death-window decisions and five net
additional death matches with at least one selected rescue. This is a real local improvement, but it
is not regression-free. Four exact decisions that survived under R12 die under R17.

The counterfactual denominator is broader than the selected result: 165 of the 256 primary roots have
at least one action that survives the fixed historical continuation. R17 selects such a survivor in
49 roots (29.70% of the avoidable set), leaving 116 avoidable roots where the current controller still
chooses a fatal continuation.

## Four regressions

| Match / frame | R12 -> R17 | Evidence surface |
|---|---|---|
| `mat_9yOKc6ZUkxI0ob36f:NATIVE_V2_SEAT0:r0`, frame 26 | `TURN_LEFT -> FIRE` | two hidden worlds; no possible or committed projectile |
| `mat_9sAIKzOdmwS9PkCUr:NATIVE_V2_SEAT0:r0`, frame 87 | `GO -> TURN_LEFT` | 15 hidden worlds, two possible projectiles and one committed projectile |
| `mat_1cgtRZXZzoJBXnqMx:NATIVE_V2_SEAT0:r0`, frame 51 | `GO -> TURN_RIGHT` | one possible projectile |
| `mat_2bzASeglmpL5gGcCa:NATIVE_V1_SEAT0:r0`, frame 79 | `GO -> TURN_LEFT` | one committed projectile |

All four regressions are in `NO_ACCEPTABLE_RESCUE`: a recorded-continuation rescue exists, but every
rescue is outside the current risk-acceptance set. This surface grew from 50 to 56 roots. It is the
specific negative movement that must be addressed next; the net +10 result must not hide it.

Two regressions remove the only selected rescue from their historical loss (`mat_9sAI...` and
`mat_2bz...`). The other two loss entries still retain a selected rescue at another one of their last
four decisions.

## Remaining avoidable failures

| Selection surface | R12 | R17 | Delta |
|---|---:|---:|---:|
| Current survivor | 39 | 49 | +10 |
| No acceptable rescue | 50 | 56 | +6 (worse) |
| Every acceptable rescue dominated | 48 | 39 | -9 |
| Non-dominated rescue below robust floor | 14 | 9 | -5 |
| Rescue at/above floor but policy selects fatal action | 14 | 12 | -2 |

Within the 39 remaining dominated-rescue roots, value-depth non-discrimination falls from 29 to 23,
path-risk inversion from 9 to 7, and the previous safer-rescue ordering override from one to zero.
Frontier/support incompleteness is unchanged: four frontier-not-activated, one possible-projectile
support and four other incomplete-support roots.

## Full-root and toolchain verification

The compiled in-memory replay image was reused. It contains 19,136 Capsules grouped into 2,403
historical match bundles and eliminates 487,507 repeated physical prefix frames. Full `capsule-all`
verification completed 19,136/19,136 with:

- avoidable Hard reject: 0;
- risk-dominated selection: 0;
- strict Proof false positive: 0;
- root restore failure: 0;
- Capsule failure: 0.

Fast-regression UTs pass 57/57. The new `compare-focused` command makes the source-pair comparison
repeatable and content-addressed; its key includes role, match, Capsule and frame so reused Capsules
cannot overwrite controls.

## Evidence

- R17 focused diagnostic: `artifacts/fast-regression/reports/native-poison-death-current-full-r17/afba03185a0665468b9d27bee2ae721afb7c861e3b456d74f7c4d2cbba835ae0.json`.
- R17 vs R12 comparison: `artifacts/fast-regression/reports/focused-regression-current-r17-vs-r12/3807ef17a163e3c759053b7e6e863ccec53831eb176e2ab52bae5d065e2e7971.json`.
- Remaining failure analysis: `artifacts/fast-regression/reports/dominated-rescue-current-full-r17/7e8e925cd4f7f76ef0f363629c3fca0364499e762049b6790058d9b4f23aa429.json`.
- Full-root verification: `artifacts/fast-regression/reports/capsule-all/f43c16459ee9322f6fe44384cdf65a50671cb71b482f81d472ade2f7bc408f44.json`.

This replay proves deterministic behavior on persisted roots and recorded continuations. It does not
produce current-source whole-match W/L/D and is not a substitute for a later full V1/V2 arena run.

Subsequent policy-consistent continuation analysis showed that only one of the four apparent
regressions was a current-policy selection defect; two already survive under the R17 policy and one
is horizon/terminal-boundary ambiguous. The constrained repair and R20 evidence are recorded in
[no-acceptable-rescue-structural-repair.md](no-acceptable-rescue-structural-repair.md).
