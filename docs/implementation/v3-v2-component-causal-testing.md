# V3–V2 component causal test overview (VC0–VC8)

Status: completed locally on 2026-07-29. No official simulate, publish, or
challenge was performed.

## Frozen experiment

- Frozen V1 SHA-256:
  `8da68843a292c6a6230a32baf60392916f9fb85aaa5d9a94feac7085ddc9e82e`
- Cohort fingerprint:
  `bcfc3a2de8675abefb04f531cc8c9e3c77fdd4cd600e65590ff50073321a6d70`
- Cohort file SHA-256:
  `6af59b951ec38b97b8db56992c17be74deaf4b7b01350e0294daea641a039b92`
- Dynamic source at freeze: 1,243 unique scenarios, including 977 outside
  the older 266-scenario set.
- Fixed cohort: 16 new-history scenarios plus 48 deterministic hash samples.
- Split: 16 Discovery scenarios (32 matches), 48 Holdout scenarios (96
  matches), two seat swaps per scenario, symmetric `stun` skills.

The fixed manifest is `config/engine-v3/vc0-scenario-manifest.json`. Raw battle
records remain outside Git. All component arena artifacts together use 346,504
bytes; every individual stage is below the 2 MiB limit.
The machine-readable decision record is
`config/engine-v3/vc0-vc8-acceptance.json`.

## Accepted-component cumulative recheck (2026-08-03)

Later ownership corrections produced one additional safety component that is
safe to combine with the fact bridge: final-only strict committed rescue. The
canonical experimental mode is now `BEST_ACCEPTED_COMPONENTS`; it intentionally
does not activate direct-kill, Information preemption, stability, TacticalCore,
Strategy, or Plan ownership.

On the complete fixed cohort it scored 63/61/4 (50.78%) directly against
`V3_BASE`. It issued six certified rescue overrides in five matches, reduced
candidate crashes from 57 to 52, and kept root restore failures, search nodes,
and declared hot allocations at zero. The result has only one non-zero paired
scenario and `p=1.0`, so it is accepted as `CORRECT_POSITIVE_SAFETY`, not as a
statistically significant general-strength owner. Diagnostic-host total runtime
was 109.87% of control and maximum per-match P95 was 118.63%; this passes the
local 120% experiment guard but is not a production performance qualification.
The exact frozen boundary is recorded in
`config/engine-v3/v3-accepted-component-best.json`.

## Native V2 transfer result (2026-08-03)

The V3 result did not transfer as a wholesale ownership replacement. On the
16-scenario native Discovery, disabling V2's existing early EO restriction and
keeping only final rescue reduced the V2 score from 21.88% to 18.75%. The
outcome regression was a frame-112 LEFT/RIGHT divergence after Risk had no
acceptable row; early EO restored the committed-viable set and preserved the
eventual star win. Final-only rescue had no proved-dead selected action to
replace.

Production therefore retains early EO membership and adds strict final rescue
only as a backstop. This combined form was action- and outcome-identical on
both Discovery (32 matches per implementation) and independent Holdout (96 per
implementation). It inspected 2,368 complete committed roots in total, found no
post-EO dead selection, and introduced no invariant failure or hot allocation.
The native classification is `ACCEPTED_NEUTRAL_SAFETY_BACKSTOP`, not a strength
gain. See `config/engine-v2/native-strict-rescue-acceptance.json`.

## Native EO×PAC causal kill transfer (2026-08-03)

The V3 direct-kill owner did not transfer directly: on native Discovery only
three geometric direct-kill rows existed, and all three were outside the Risk
acceptable set. Root diagnostics separated them into an incomplete
counter-fire case, a case with one surviving enemy response, and one exact
cross-layer composition.

The accepted native certificate requires complete PAC with zero surviving or
unknown enemy first actions, plus an EO-proven viable FIRE successor for every
committed hazard. Immediate and unknown fatal mass, possible projectiles,
projected possible risk, enemy shield and counter exposure must all be zero.
This permits only future-enemy-fire mass to be causally removed.

Discovery changed one action and converted one loss to a kill win
(21.88% to 25.00%). Holdout was action-identical at 16.15%, with no negative
transition. The component is enabled as a rare correctness path, not as a
statistically qualified general attack owner. Reproduce with
`npm run arena:native-causal-kill`.

The certificate was then tightened at the raw Safety source. A Risk-rejected
FIRE may cross the gate only when its nonzero fatal mass is exclusively future
enemy FIRE: committed and possible-projectile masses are zero, and combined
horizon mass equals raw future-FIRE mass. This prevents PAC from cancelling a
bomb, observed projectile, chance-fatal support, or unattributed risk.

The positive root remained `raw committed / possible / future = 0 / 0 / 3998`
and still converted LOSS to WIN. Repeated Discovery remained 6/24/2 versus
7/23/2; Holdout remained exactly 12/77/7 on both sides. Three of seven
Risk-blocked Holdout direct-kill roots were explicitly source-blocked. Every
remaining action-divergent root retained one proven surviving enemy first
action, so it stays Shadow until later counterfire can be proved harmless.

That survivor boundary has now been tested with a residual AND/OR theorem. PAC
doomed columns are reused as proofs; every remaining survivor column is expanded
through the real FastKernel, with existential own continuations and universal
enemy/chance responses. At depth 4 and a 4,096-node diagnostic budget, the
fixed Discovery found one residual root and disproved it. The full Holdout found
eight: seven were disproved and one was proved only on incomplete InformationState
support. That lone proof occurred at frame 125 of an already-winning match.

There were zero complete-support residual proofs and zero action or outcome
changes. Consequently the one-survivor relaxation is rejected for ACTIVE use;
the fixed-array search and its quantifier/restore tests remain available as a
Shadow theorem. Evidence is frozen in
`config/engine-v2/native-residual-attack-proof-evidence.json` and reproduced by
`npm run arena:native-residual-proof`.

## Component result

| Stage | Candidate | Matches | Candidate / baseline / draw | Score | Classification | Default |
| --- | --- | ---: | ---: | ---: | --- | --- |
| VC0 | V3 pass-through vs frozen V1 | 128 | 62 / 62 / 4 | 50.00% | ACCEPTED baseline | on |
| VC1 | shared observation/projectile bridge (Shadow) | 128 | 62 / 62 / 4 | 50.00% | ACCEPTED fact layer | on |
| VC2 | complete physical Hard final gate | 128 | 62 / 62 / 4 | 50.00% | ACCEPTED safety layer | on |
| VC3 | committed Deadline/EO action owner | 128 | 41 / 70 / 17 | 38.67% | NEGATIVE | off |
| VC4 | strict ForcedWin owner | 128 | 62 / 62 / 4 | 50.00% | NEUTRAL | off |
| VC5 | CombatPressure/PAC Holdout | 96 | 47 / 45 / 4 | 51.04% | NEUTRAL, `p=0.876953` | off |
| VC6 | full V2 TacticalCore Discovery | 32 | 2 / 30 / 0 | 6.25% | NEGATIVE, `p=0.000122` | off |
| VC7 | V2 StrategicArbiter Discovery | 32 | 10 / 19 / 3 | 35.94% | NEGATIVE | off |
| VC8 | `V3_BEST = VC1 + VC2` vs frozen V1 | 128 | 62 / 62 / 4 | 50.00% | ACCEPTED stable best | on |

VC8 final report fingerprint:
`af9116f0a46cfb8689facdc90de9f4f59d1488cd6133e95ab1a656b22f5366e5`.
The V3_BEST and V1 action counts are identical: TURN 4,163; GO 3,885;
FIRE 659; STUN 331; BOMB 42. Stars are 74:74, crashes 56:56, and emitted
projectiles 659:659. No component in this pass demonstrated a statistically
significant strength improvement over V1.

## Causal findings

1. **VC3 is not a safe drop-in action owner.** It reduced FIRE from 727 to 611,
   raised candidate crashes from 35 to 62, and lowered the score by 11.33
   points. Deadline/EO rule fixtures are correct, but replacing V1's three
   escape ports gives it too much root ownership.
2. **VC5 creates more attacks but not better outcomes.** On Holdout it raised
   FIRE from 495 to 527 while candidate crashes rose from 38 to 46. Its 1.04
   point score change is not significant and fails the required +3 point gate.
3. **The complete V2 TacticalCore is the largest negative component.** It
   scored 6.25% against the V1-style tactical baseline. This confirms that the
   V2 search/risk stack cannot own the whole tactical root merely because its
   local Minimax contracts are correct.
4. **InformationSafety/MultiFrame is the strongest harmful internal VC6
   contribution in this Discovery cohort.** FULL scored 28.13% against
   FULL-minus-InformationSafety, with `p=0.039062`. Physical search,
   InformationSearch, and Risk were directionally harmful but not significant;
   StageMatrix and HiddenProjectileRisk were behaviorally inert in this sample.
5. **VC7 lacks a usable non-contact proposal before Plan logic runs.** The
   arbiter emitted 886 `NONE` actions and collected only 6 stars against 40.
   When both sides used that base, PlanSketch, PersistentPlan, and PVA each
   produced 4,064 `NONE` actions and 32 frame-limit draws. Plan persistence
   cannot repair an empty or hold-only strategic proposal set.
6. **OpponentModel did not recover TacticalCore.** FULL with OpponentModel
   scored 45.31% against FULL without it (`p=0.625000`).

These results separate local correctness from decision ownership. VC1 and VC2
are useful structural safeguards. The other V2 components may remain available
for later redesign or Shadow measurement, but none should be activated in the
current V3_BEST.

## Verification

- V3 component/ABI tests: 15/15 pass.
- All 1,184 retained compact component rows: timeout 0, script error 0, root
  restore failure 0, adapter exception 0, projectile capacity failure 0, and
  declared hot-path allocation 0.
- Minimax core: 91/91 pass.
- GR0 fact, safety, search, projectile and strategy suite: 208/208 pass.
- IMP5: 14/14 pass.
- IMP6: 15/16 pass. The sole failure is the pre-existing source byte capacity
  gate: source 534,151 bytes and minified 515,064 bytes versus the current
  204,800-byte platform contract. Typed arrays (999,280 bytes), cold init,
  callback, source/minified semantics, sandbox, cache and fallback tests pass.
- Legacy SR4 combat-pressure suite: 19/20 pass. The remaining assertion expects
  the removed `maximum robustLower safe floor` to own selection. It conflicts
  with the current GR0 ownership contract and was not changed to make VC5 pass.

## Reproduction

```bash
npm run test:v3
npm run test:minimax-core
npm run test:gr0
npm run test:imp5
node tools/agentank/diagnostics/v3-component-arena.js verify-cohort

node tools/agentank/diagnostics/v3-component-arena.js run \
  --stage VC8-BEST-VC2 --role DISCOVERY \
  --baseline VC1_SHADOW --candidate BEST_VC1_VC2

node tools/agentank/diagnostics/v3-component-arena.js run \
  --stage VC8-BEST-VC2 --role HOLDOUT \
  --baseline VC1_SHADOW --candidate BEST_VC1_VC2

node tools/agentank/diagnostics/v1-v3-arena.js \
  --matches 128 \
  --cohort config/engine-v3/vc0-scenario-manifest.json \
  --v3-mode BEST_VC1_VC2 \
  --output /tmp/vc8-v1-v3-best-128.json
```

Holdout data was read only after the corresponding Discovery condition allowed
it. No failed or neutral component was tuned against Holdout and rerun.

## 2026-08-03 VC3 ownership correction

The original VC3 conclusion remains valid for its tested implementation: early
replacement of all three V1 escape ports was negative. A new final-only contract
was tested after adding exact V1 ownership traces:

```text
complete committed support
+ V1 final action PROVEN_DEAD
+ replacement PROVEN_VIABLE
+ Physical Hard ALLOW
= COMMITTED_RESCUE proposal
```

On Discovery, 279 committed-evidence roots produced one strict rescue. It
converted one loss into one win, moving the 32-match score from 50.00% to
53.13%. On the independent 96-match Holdout, 1,136 committed-evidence roots
produced four rescues. Every runtime-independent outcome stayed identical;
three candidate deaths became non-crash frame-limit losses and no surviving
result became a death. Root restore failures, search nodes and declared hot
allocations were zero.

This corrected component is `CORRECT_POSITIVE_SAFETY` and may enter the V3
experimental BEST. It does not rehabilitate early VC3 ownership and is not yet
enabled in V2 production.

## 2026-08-03 verified attack ownership correction

The attack stage first corrected two adapter-level ownership errors. Global
Information incompleteness no longer blocks usable Physical combat evidence,
and the final owner scans FIRE directly instead of ranking every purposeful
action and only afterward requiring the winner to be FIRE. A proposal now
requires Physical Hard allow, complete PAC support, post-fire self escape, no
increase in counter exposure, complete purpose evidence, and a reduced enemy
response set.

The combined `direct kill OR response reduction` owner was neutral on
Discovery: two losses became wins and two wins became losses. Both regressions
were non-direct response-reduction shots overriding GO/TURN. That combination
is classified `NEGATIVE_INTERACTION`.

The purpose contract was then split without tuning a continuous threshold:
strict direct-kill may propose while intercept/response-reduction remains
Shadow. After correcting the stale synthetic NONE row described below, the
results were:

| Cohort | Matches | Active W/L/D | Score | Delta versus same-config Shadow |
|---|---:|---:|---:|---|
| Discovery | 32 | 17/15/0 | 53.13% | net +2 wins, no negative transition |
| Holdout | 96 | 47/44/5 | 51.56% | one loss-to-win, one loss-to-draw |

Holdout Shadow was 46/46/4 at 50%. Active changed only three first actions from
LEFT/GO to FIRE. Candidate crashes fell from 38 to 36, stars stayed 60 to 60,
and FIRE rose from 548 to 560. One override converted a single crash into a
kill win, one converted it to an equal-star mutual-crash draw, and one avoided
death but still lost on stars. Only two scenario pairs had non-zero outcome
effects, so the paired randomization result was `p=0.5`.

Strict direct-kill is therefore `DIRECTIONALLY_POSITIVE_NEUTRAL`, not an
accepted action owner: it misses both the +3 percentage-point and p<0.05 gates.
The frozen contract may be retested on a larger independent cohort, but the
current Holdout must not be used to tune it.

Sharing the Physical prefix also exposed a fixed-array domain bug. EO refreshes
only `physicalSelectionCount`, while the old owner scanned all of `actionCount`.
A synthetic NONE row could therefore inherit an old member bit. Both lookup and
selection now use the evaluated domain, with a stale-member fault UT. Corrected
Discovery and Holdout have exact prepare/emission accounting (1,815/1,815 and
7,832/7,832), and every rescue proposal is GO/LEFT rather than NONE.

## 2026-08-03 preemptive soft-safety shadow

The next port tested V2 future-FIRE and possible-projectile risk without giving
Information evidence action ownership. `prepareSoftSafetyEvidence()` reuses the
shared Physical arrays and existing SafetyClosure/MultiFrame slabs. It excludes
an already active enemy projectile, performs no Minimax/StageMatrix/Strategy
work, allocates no per-frame object, and publishes only an ineligible Shadow
proposal.

On the 32-match Discovery cohort all actions and outcomes remained exact. Of
1,716 calls reaching the V1 preemptive port, V1 returned an evasion 25 times.
V2 produced a differentiated soft-risk recommendation 1,046 times. The overlap
was 21 and all 21 action tokens agreed; four V1 evasions had complete V2 support
but no four-frame soft fatal source. V2 alone recommended on 1,025 frames.

| Owner of a V2 recommendation | Frames |
|---|---:|
| V1 TacticalSearch | 928 |
| V1 Stability | 58 |
| V1 FinalActionGate | 28 |
| V1 PreemptiveSafety | 21 |
| V1 Navigation | 11 |

This is high-recall risk evidence but a very low-precision action trigger. It
describes danger present in a world where V1 usually continues tactical work;
promoting it would recreate V2's excessive evasion. The component is classified
`CORRECT_EVIDENCE_ONLY / ACTION_OWNER_REJECTED`. No Active candidate or Holdout
was run. The four V1-only cases also prevent using absence of four-frame mass to
cancel the existing V1 geometric guard.

## 2026-08-03 inline stability causal test

Stability was evaluated at the final action boundary after strict rescue. The
wide contract required turn streak at least three, a moving GO row, Physical
Hard allow, no committed entity, V1-compatible edge/star progress, and projected
risk below 35,000. FIRE, skills, bombs, and rescue were never overridden.

Discovery contained 122 streak roots. V1 already emitted GO on 88, retained a
higher-priority non-turn action on 17, and still preferred TURN on 17. Only
seven passed the wide V2 contract. Activating all seven produced one
loss-to-win and one win-to-loss, for zero net score, so the wide owner was
rejected.

A single semantic endpoint was then frozen for independent validation:
projected `possibleRisk == 0`. This was not a fitted intermediate threshold.
It changed two Discovery matches and produced one loss-to-win with no negative
transition (53.13%), qualifying for Holdout. On the 96-match Holdout it changed
six action streams and produced one loss-to-win, one win-to-draw, and one
draw-to-loss. Both Shadow and Active remained 46/46/4 at 50%, with paired
`p=1.0`.

Zero local modeled risk therefore does not certify the long continuation after
breaking a turn sequence. Both stability owners are `ACTION_OWNER_REJECTED`.
The fixed-array Shadow remains useful for oscillation/Plan diagnostics, but no
stability behavior enters BEST.
