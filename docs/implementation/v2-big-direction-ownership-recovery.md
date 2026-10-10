# V2 big-direction ownership recovery

Status: `ATTACK SETUP OWNERSHIP CLOSED / ACTIVE NEUTRAL / PRODUCTION DEFAULT UNCHANGED`

## Result

The principal Minimax defect is not depth. Primitive Minimax was evaluating an
action after its objective identity had already been discarded, while
StrategyBand and soft Risk had already narrowed its action domain. Almost all
tactical roots were InformationState, so the expensive search rarely had a
sound consumer.

The best tested structure separates owners:

```text
Hard/EO facts
→ Risk qualification
→ strategic owner outside contact
→ qualified open action set inside contact
→ typed tactical Options
→ one Minimax
→ FinalActionGate
```

Only direct-kill and attack-setup Options may take the action from Minimax.
Rescue, star, terminal, position and resource objectives retain their own
owners. Resource actions need explicit typed purpose evidence.

## Causal scorecard

| experiment | first 16 | next 16 | decision |
|---|---:|---:|---|
| CURRENT | 10.94% | 7.81% | baseline |
| primitive Minimax off | 14.06% | 7.81% | primitive owner harmful |
| typed tactical Option single search | 17.19% | 7.81% | positive, sparse |
| open every Risk row | 12.50% | not run | rejected: resource explosion |
| qualified global open + Option | 20.31% | 7.81% | rejected: star/navigation loss |
| qualified contact open + Option | 17.19% | 9.38% | stable split |
| add direct path owner | 15.63% | not run | rejected: +2 crashes |
| add path verification | 17.19% | not run | neutral: no action change |

An additional 32-scenario validation gave CURRENT 13.28% and the stable split
14.84%, with two fewer crashes and a ten-star differential improvement.
Combined exact totals are recorded in the design document.

## Information Option Shadow

The next step was implemented as a default-off evidence service. It searches
typed tactical Options over InformationState and publishes separated
lower/upper bounds. Incomplete scalar results remain ordering-only and cannot
own an action.

First-16 evidence after the different-primitive preflight:

| metric | value |
|---|---:|
| inexact contact attempts | 2,168 |
| no different-primitive tactical challenger | 1,922 |
| matrices actually searched | 246 |
| complete finite-horizon roots | 139 |
| ordering-only roots | 107 |
| action-changing strict dominances | 41 |
| search nodes | 4,856 |
| maximum nodes/root | 54 |
| Hard/Risk/restore/timeout invariant failures | 0 |

The preflight retained all 41 useful certificates from the broad version while
cutting nodes by 74.3%. Local total overhead versus the repeated paired baseline
was about 3.4%, down from about 29.5%.

## What remains

The stable split is not a release candidate. It improved 128-match analysis
score by 2.73 points, below the 3-point gate, and still scored only 14.06%
against the V1-style controller.

The causal ACTIVE POC was repeated and produced the same negative result:

```text
baseline  4W / 27L / 1D = 14.06%
ACTIVE    2W / 29L / 1D =  7.81%
```

The 34 overrides were dominated by `ATTACK_SETUP` (33); 27 were `GO→FIRE`.
FIRE increased by 18 while candidate crashes increased by three. Both changed
whole-game outcomes were `V2_WIN→V1_WIN`; there were no positive transitions.
Local total runtime increased only about 2.8%, and all structural invariants
were zero. This isolates utility/continuation semantics as the cause.

The next high-leverage task is therefore not a deeper or broader search. Split
the evidence contract:

1. `DIRECT_KILL`: terminal/forced result may remain an owner after independent
   proof validation.
2. `ATTACK_SETUP`: Shadow ordering only until a multi-frame closure supplies a
   hit deadline, reduced enemy legal-response set, and complete own escape.
3. The attack continuation must compare the whole objective chain against the
   incumbent navigation continuation; one-frame alignment, distance and FIRE
   pressure cannot form an ownership interval.

Default production flags remain off. No official simulate, publish or
challenge was executed.

## Strict AttackSetupClosure follow-up

The rejected one-frame behavior is retained only behind
`diagnosticInformationOptionLegacySetupOwnership` so it can reproduce the
negative corpus. Normal ownership now treats `ATTACK_SETUP` as searchable
evidence but requires an allocation-free `AttackSetupClosure` before selection.

The implementation and checks completed in order:

1. `optionSearchOwnableKind()` was narrowed to `DIRECT_KILL`; setup remained a
   tactical/searchable Option.
2. The 34 legacy override roots were captured as compact schema-v2 records,
   including per-enemy PAC columns and committed-escape evidence.
3. A fixed-array closure was added and wired after strict interval, Hard and
   Risk qualification.
4. The offline verifier replayed all 34 roots using the production closure:
   0 of 33 setup roots certified.
5. The fixed-16 ACTIVE POC returned to 4/27/1 and 14.06%, with zero result,
   star or crash regression. One independent `DIRECT_KILL` override remained.

The full Minimax core suite passed 200 tests. The closure-specific suite covers
complete certification, uncovered response, no-hit pressure, incomplete
support, Risk/value/exposure regression, and committed escape. Production
construction still leaves both Information Option interval search and the
closure unallocated unless a diagnostic flag explicitly enables them.

Evidence summary is stored in
`config/engine-v2/information-option-attack-setup-closure-evidence.json`.
Large match data and the compact root corpus remain outside Git under `/tmp`.

## Shot quality and contact construction follow-up

The all-frame geometry census separated attack *opportunity construction* from
FIRE volume. On fixed32, V2 reached only 86 direct-clear visible poses and 53
new direct entries, versus 249 and 151 for the V1-style controller. It fired in
17 direct poses versus 119. The largest transition gaps were
`WRONG_FACING→DIRECT` (33/98), `OFF_AXIS→DIRECT` (20/50), and short-range
distance-3/4 entries (10/59). V2's longest continuous direct run was three
frames versus five.

Three state-consistent ACTIVE POCs then isolated ownership:

| POC | fixed32 result | decision |
|---|---:|---|
| fast long-range aim setup | +1 win, -1 loss, +1 kill, -5 FIRE | directional positive |
| direct-clear safe FIRE | no outcome or kill change | reject local FIRE owner |
| one-frame visible alignment | -1 win, +1 draw, -1 kill | reject local turn owner |

The fast long-range mode removes the expensive depth-four post-FIRE closure.
Its O(1) prefilter plus depth-two candidate safety reproduced the positive
fixed32 result with zero post-FIRE nodes. On the already-open 96-scenario set it
again produced exactly one `LOSS→WIN` and no `WIN→LOSS`, but improved score by
only 0.52 percentage points (10.16% to 10.68%). That is below the three-point
action-owner gate, so production remains unchanged.

The geometry deficit persisted when the simulator assigned poison to both
controllers and when it assigned stun to both: V2 still reached roughly
2.6–3 times fewer direct positions and fired directly roughly 6–8 times less.
The stun run is only control-structure stress evidence because native V2 stun
emission is not implemented; it is not a skill qualification.

The next experiment must therefore own a bounded *target-continuous chain*,
not a TURN or FIRE primitive. It must keep one target generation through
alignment/contact, revalidate Hard/Risk/committed escape every frame, and
compare the entire chain's opportunity cost against the incumbent. A local
geometry improvement is only progress evidence and cannot select an action.

## Native minimax semantic isolation on Discovery64

The compact native owner isolated the remaining gap without changing the
production bundle. The stable base was `leaf + contact representative +
resource domain + Markov history`: across both Discovery32 halves it scored
30W/8D/90L (26.56%) against 12W/5D/111L (11.33%) for current V2. It doubled
kills from 11 to 23 and produced 23 `LOSS→WIN` versus five `WIN→LOSS`.

Four follow-ups were rejected on the sealed second Discovery half:

| semantic change | score | evidence |
|---|---:|---|
| response-conditioned FIRE hard domain | 27.34% | higher shot efficiency, but fewer kills than the stable base |
| exact maximin bypass of that domain | 26.56% | 313 bypasses restored FIRE without restoring outcomes |
| integer attack-arrival leaf | 18.75% | 816 FIRE, 10 kills; immediate-line reward was amplified by minimax |
| own-only attack representatives | 23.44% | preserving only enemy star representatives removed necessary attack replies |

A 20% nominal / 80% worst-response root backup changed 40 of 64 action
streams but yielded exactly nine improving and nine regressing matches. It is
valid evidence that opponent expectation belongs in a risk-dependent backup,
not evidence for a fixed blend.

The Markov audit found a real state-contract defect: physically identical
`LEFT→RIGHT` and `NONE→NONE` sequences had identical V2 TT keys although V1's
path value differs. Adding the last eight command events to the diagnostic TT
identity and integer reversal/streak cost improved the difficult half from
10.94% to 15.63%; combined with resource qualification it reached 28.13%.
This must be represented natively before production ownership is reconsidered.

The V1 tactical-stage oracle reached 47.66% on the same difficult half. A
first-divergence audit found 63/64 differing roots and a net 23 improving versus
10 regressing outcomes. The dominant pairs were `GO→TURN` (19), `GO→FIRE`
(10), `FIRE→TURN` (9), `FIRE→GO` (10), and `TURN→GO` (10). Since the same action
pair appears in both improving and regressing outcomes, fixed action bonuses,
FIRE thresholds, and turn demotions are ruled out.

The next representation must therefore be an attack-pose option rather than a
target cell: `(cell, direction, fire deadline, enemy response coverage, own
post-fire escape)`. It must be generated once, keep a stable generation across
the bounded search, and expose a lower/upper interval. Primitive FIRE/TURN/GO
remain implementation steps; they are not independent strategic owners.

## AttackPoseOption causal POCs

The option representation was implemented in the diagnostic native owner with
fixed arrays and no production wiring.  The useful variant replans a concrete
firing pose every frame and accepts only GO/TURN steps that are on a shortest
route to that pose.  A TURN is progress only when it opens a shortest next
step; merely turning toward the eventual muzzle direction is not progress.

Across Discovery64 under the actual asymmetric poison/stun assignment, the
stable native minimax scored 30W/8D/90L (26.56%).  Route-proven AttackPose
scored 38W/3D/87L (30.86%), with 29 projectile kills versus 23 and zero Hard,
Risk-domination, restore or timeout failures.  On the already-used VC0 64
scenarios it scored 35W/3D/90L (28.52%) versus the stable 30W/2D/96L (24.22%).
The combined 128-scenario effect is +4.30 percentage points, 42 improving
matches versus 29 regressions.  Exact scenario-level paired randomization is
directional but not yet significant (`p=0.0926517` one-sided).

The same option was neutral under symmetric stun: 15.63% versus 16.41% for the
stable owner, with 11 improvements and 11 regressions.  The evidence is thus
skill/role conditioned; it cannot be enabled globally.

Five structural alternatives were tested and rejected:

| alternative | evidence | decision |
|---|---|---|
| persist concrete `(cell,direction)` | first32 fell to 25.00%; 1,293 keeps did not preserve value | persist purpose, replan geometry |
| require full enemy-response coverage | combined score tied route at 29.69%; VC0 fell 28.52%→28.13%; one Discovery risk-dominated selection | binary coverage gate rejected |
| require no one-step minimax regression on uncovered responses | Discovery64 fell 30.86%→28.52%; 3 improvements/7 regressions | one-step value cannot veto long option |
| generate poses from every projected response cell | identical 38W/3D/87L; kills fell 29→27 | action-domain expansion neutral |
| let the option outrank all non-terminal minimax values | exact first16 fell 31.25%→28.13%; FIRE 269→171; kills 9→8 | unrestricted option owner rejected |

Full-coverage and route-only both scored 29.69% on the combined 256 candidate
matches.  Full coverage had `p=0.0700772`, still above the preregistered 0.05
gate and did not reproduce a relative gain on VC0.  Response coverage must
therefore remain a vector keyed by enemy response, not a count or an all/none
threshold.

The next evidence task is a compact first-divergence root corpus for the 42
improvements and 29 regressions.  It must record the chosen pose, response
bitset, route successor, post-fire escape, counter-exposure and complete root
cell values.  A new quality rule is admissible only if it separates those
paired roots; no further score-band, FIRE-bonus or coverage-threshold scan is
justified.  Production source, current Holdouts and platform state remain
untouched.

## AttackPose first-divergence and causal intervention

The compact corpus captured all 71 outcome-changing first divergences from the
Discovery64 and VC0 asymmetric runs (`44 + 27`), with exact root replay in all
71 cases.  A rotation-invariant one-turn feature looked strong in that selected
corpus (`18 improvement / 2 regression`), but failed the whole-game check:
Discovery64 scored 28.91% and VC0 26.17%, both below the unrestricted route at
30.86% and 28.52%.  The selected first-divergence label is therefore
trajectory-confounded and cannot be promoted into a static gate.

A stronger causal test enabled AttackPose only at the first divergent root.
On Discovery it produced 10 local improvements, 17 regressions and 17 neutral
matches; on VC0 it produced 4, 9 and 14.  Fixed 1/2/4/8-decision interventions
remained net negative on both cohorts.  At horizon eight only 29/44 Discovery
and 17/27 VC0 outcomes reproduced the unrestricted route.  This establishes
two different effects: many regressions are caused immediately by the first
override, while most gains require repeated state-dependent replanning across
the match.

The full route also separates by realized conversion rather than invocation
count.  Discovery improvements averaged 2.84 overrides and produced 18 kills;
regressions averaged 3.21 overrides but produced one kill.  VC0 improvements
averaged 3.47 overrides and produced 10 kills; regressions averaged 3.10 and
produced none.  Override frequency, response coverage count and aim-turn count
are not sufficient quality variables.

## Rejected successor gates and feedback-action expansion

A committed-only successor-response gate required every modeled enemy first
response to retain a reachable firing option within five steps.  It improved
the first Discovery32 half from 32.81% to 35.94%, but failed independent
replication on the second half (28.91% to 28.13%) and increased local runtime
by roughly 52%.  The binary all-response gate is rejected; it confuses a
receding feedback policy with one static post-action reachability test.

The next narrow POC inserted a freshly recomputed AttackPose route action into
every own deep Minimax node, without changing root rows, Risk or leaf scores.
On the exact first16 sample it changed search work but not outcomes: both old
and new route scored 9W/2D/21L (31.25%) with nine projectile kills.  Star delta
worsened from -23 to -25 and crashes rose 16 to 17.  It executed 14,776 feedback
preparations, injected 2,734 and promoted 1,048 deep actions, while candidate
runtime rose from 1,749,983us to 3,346,251us and P95 from 3,102us to 6,238us.
This implementation is rejected and will not be expanded.

These results identify the remaining architectural defect precisely.  Adding
the same feedback action to every root row is not policy evaluation.  The
current root first runs Minimax under one continuation semantics and then
AttackPose may replace the action under another; this violates Bellman/policy
consistency.  The next POC must compare two explicit policy identities under
the same enemy quantifier:

```text
baseline root option  -> baseline continuation policy -> [lower, upper]
attack root option    -> receding AttackPose policy   -> [lower, upper]
```

The attack option must recompute geometry after every simulated response, but
its identity and purpose stay bound throughout that root branch.  It may own
the action only when its completed lower bound exceeds the baseline upper
bound, or when a separately strict terminal certificate exists.  It must use a
separate cache namespace, retain Hard/EO at every node, and initially exclude
Information worlds.  This is a policy-level Minimax experiment, not another
primitive-action bonus, static gate or persistent concrete target.

## Policy-prior ownership attribution

The policy-level interval experiments showed that their finite-horizon scalar
was not a terminal certificate.  A separate behavior-neutral census therefore
used frozen V1 `TACTICAL_SEARCH` only as an oracle policy prior and inspected
how the current V2 stack classified the proposed row.  The already-open second
Discovery32 reproduced the prior result exactly: 27W/7D/30L (47.66%), versus
7W/3D/54L (13.28%) for current V2.  Crashes fell from 27 to 17 and projectile
kills rose from 6 to 24.

The ownership attribution is decisive:

- 2,823 policy-prior proposals passed Physical Hard;
- zero had a complete publishable V2 Minimax value at the final ownership
  point; the contact funnel separately recorded 3,588 inexact roots and only
  316 exact contact roots overall;
- 649 proposals were outside the V2 Risk acceptable set and 374 were marked
  Pareto dominated;
- 1,356 had lower `robustLower` than the V2 incumbent, 1,159 tied and only 308
  were higher;
- 2,559 lacked V2 `purposeCompleteness`, despite the full policy producing the
  much better trajectory result.

This proves that an incomplete point estimate, Risk row or one-frame purpose
flag cannot be allowed to refute a coherent policy.  It does not prove that any
policy prior is good.  A native POC using only V1-style `determineIntent` plus
one-step progress was an intentionally minimal counterexample: on the first
Discovery16 it fell from 4W/1D/27L (14.06%) to 0W/1D/31L (1.56%).  Of 328
overrides, 253 were GO; crashes rose from 11 to 29 and kills fell from four to
zero.  The simple prior is rejected.

The next implementation target is therefore a structured native
`BasePolicyKernel` that reproduces the *whole* V1 tactical-stage contract:
bounded simultaneous maximin, action qualification, opponent expectation,
intent hysteresis, repetition state and leaf semantics.  It must first reach
root-by-root action equivalence with the frozen stage.  V2 Hard/EO/Proof remain
above it; V2 Minimax may refute it only with complete terminal evidence.  This
is a migration oracle, not permission to embed V1/V3 in the production tank.
