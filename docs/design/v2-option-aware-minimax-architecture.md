# V2 Option-aware Minimax architecture

## Status

`ARCHITECTURE_SUPPORTED / BEHAVIORAL_GATE_MISSED / PRODUCTION_DISABLED`

This document replaces the assumption that a root search row is identical to a
primitive action. The current production default remains unchanged. The
diagnostic implementation is evidence for the next native root, not a second
production search pass.

## Why the current Minimax loses to the simpler controller

The Minimax implementation is not primarily losing because its max/min backup
is weak. It is solving the wrong decision object and owns too little of the
match:

1. A root row currently means only `GO`, `TURN_LEFT`, `TURN_RIGHT`, `FIRE`, and
   so on. The same `TURN_LEFT` can mean attack setup, star control, terminal
   preservation, or positioning. These meanings are merged before search.
2. `ProductionDepthSearch.generateDeep()` then creates one generic continuation
   set. In contact it follows the enemy; outside contact it follows the star.
   The root objective is therefore lost after the first action.
3. Physical Minimax runs only for exact visible contact. In the two frozen
   16-scenario samples, it was eligible at 143 of 6,321 roots (2.26%). Even a
   perfect local search cannot repair the other 97.74% of decisions.
4. The outer controller spends substantially more actions on bombs and poison
   while firing less than the V1-style control. Across the same 64 matches the
   current V2 used 85 bombs, 240 skills, and 283 shots; the control used 5
   bombs, 151 skills, and 327 shots. This is an ownership and opportunity-cost
   problem, not a search-depth problem.

The correct decision unit is therefore:

```text
Option = objective identity
       + target identity/generation
       + deadline
       + admissible response policy
       + primitive first action
```

Multiple Options may share one primitive first action and one physical
successor. They must not share continuation policy or utility semantics.

## Diagnostic evidence

The default-off `OptionPortfolioSlab` and `OptionAwareDepthSearch` preserve
semantic aliases and condition our continuation representatives and leaf
utility on the root Option.

### Shadow

On the first 16 scenarios:

- 3,217 roots, all 3,217 contained at least one aliased primitive row;
- maximum 15 Options in one root, capacity failures 0;
- 78 option-aware searches, 52 complete, 16 different primitive proposals;
- CURRENT and Shadow actions, W/L/D, stars, crashes, shots, bombs and skills
  were exactly identical;
- Hard reject, Risk domination, restore failure and timeout/error were all 0.

### Active causal POC

No parameter was changed between samples.

| sample | CURRENT | Option-aware | transition |
|---|---:|---:|---|
| first 16 scenarios / 32 matches | 3/28/1, 10.94% | 4/27/1, 14.06% | one `LOSS→WIN` |
| independent next 16 / 32 matches | 2/29/1, 7.81% | 2/28/2, 9.38% | one `LOSS→DRAW` |
| combined 64 matches | 5/57/2, 9.38% | 6/55/3, 11.72% | +2.34pp, no reverse transition |

The winning conversion first diverged at frame 36 from `GO` to `FIRE` and
ended with the opponent destroyed at frame 57. The independent conversion
removed a projectile/collision death and reached a draw.

This is directionally positive but below the 3-point behavioral acceptance
gate. It remains diagnostic. It also used 40,903 extra search nodes and changed
only 8 final decisions (0.13% of 6,321 roots), so retaining it as a second
search would be architecturally wrong.

## Single-search ownership recovery evidence

The later diagnostic removed the primitive-action search from the candidate
path and installed one typed Option search. It also tested the ownership layers
around the search instead of attributing every result change to Minimax.

### Contact funnel

On the first 16 scenarios the current controller reached 2,175 tactical roots:

- 78 were exact Physical roots;
- 2,097 were Information roots;
- 2,166 had value budget and only 9 were budget-blocked;
- all 2,097 Information roots had no authorized value consumer.

Therefore early fallback was not the primary reason Minimax owned so few
actions. The dominant cause was the state/consumer contract: almost every
contact was InformationState while primitive Physical value was allowed to own
only the small exact subset.

Broad Information search and visible nominal-Physical ownership were both
rejected. The former changed the first sample from 10.94% to 9.38%, increased
crashes from 12 to 17 and almost doubled local runtime. The latter improved the
first 16 by 3.12 points but lost the same amount on the independent next 16.
An exact negative trace showed why: a nominal depth-two `FIRE` value displaced
a winning `GO` although all six modeled enemy first actions survived the shot.

### Typed tactical Option ownership

Only `DIRECT_KILL` and `ATTACK_SETUP` may now own a diagnostic Minimax
proposal. `COMMITTED_RESCUE` remains owned by Deadline/EO and strategic,
terminal, position and resource Options cannot use a tactical leaf value to
take the root.

An exact negative sample that previously changed `TURN_LEFT` to a losing
`TURN_RIGHT` was a `COMMITTED_RESCUE` Option. The new boundary blocked it. An
exact positive sample changed `GO` to `FIRE` through `ATTACK_SETUP` and retained
the resulting kill. The focused ownership/restore suite passed 62 tests.

### Strategy membership interaction

The tests separated three materially different meanings of "open the action
set":

1. Opening every Risk-frontier row was rejected. It added 34 bombs in the first
   sample; 80 selected resource actions lacked complete typed purpose evidence.
2. Opening ordinary actions while requiring typed resource evidence improved
   the first sample by 9.37 points, but global opening damaged star control.
3. Opening qualified actions only in `TACTICAL_CONTACT`, retaining strategy
   ownership outside contact, was the stable split.

The stable candidate is:

```text
Strict Proof / Physical Hard / committed EO
→ Risk acceptable + Pareto
→ non-contact: existing strategic owner
→ tactical contact: all qualified ordinary rows; typed resources only
→ one typed Option Minimax
→ only DIRECT_KILL / ATTACK_SETUP may override
→ FinalActionGate
```

Across 64 scenarios / 128 paired matches:

| metric | CURRENT | split owner + Option | delta |
|---|---:|---:|---:|
| W/L/D | 12/111/5 | 15/107/6 | +3 wins, -4 losses, +1 draw |
| analysis score | 11.33% | 14.06% | +2.73pp |
| stars | 31 | 33 | +2 |
| crashes | 56 | 55 | -1 |
| FIRE | 671 | 674 | +3 |
| BOMB | 176 | 160 | -16 |
| local total runtime | 8,419,105us | 7,135,025us | -15.25% |
| maximum reported P95 | 7,205us | 4,379us | -39.22% |

Paired transitions were 9 `LOSS→WIN`, 3 `LOSS→DRAW`, 5 `WIN→LOSS`,
1 `WIN→DRAW`, and 3 `DRAW→LOSS`. Net gain was seven half-win score units.
Hard reject, Risk domination, root restore and timeout/error invariants stayed
at zero.

The Option search ran 287 times, completed 101, proposed a different primitive
41 times and overrode only 3. It blocked 28 committed-rescue and 36 other
non-tactical owners. The result is positive architecture evidence, but the
2.73-point gain misses the predeclared 3-point behavioral gate, so production
remains disabled.

### Rejected navigation owner

A separate cached-distance-field star proposal increased star differential but
also added two crashes and scored below the stable split. An exclusion-only
verification layer removed both crashes, but also removed every new behavior;
the result became action-equivalent to the stable split. This proves that
single-frame path progress is not sufficient Option evidence. Navigation needs
a response-aware multi-frame safety/terminal interval, not a larger star
weight or direct ownership of `PlanSketch.rawScore`.

## Target native pipeline

```text
Observation / entity lifecycle
→ Physical Hard and committed rescue proof
→ OptionGenerator
→ deduplicated primitive transition slab
→ Risk dimensions on physical successors
→ option-specific continuation masks and utility intervals
→ one bounded Minimax for tactical Options only
→ OptionArbiter
→ FinalActionGate
→ ACTION_EMIT
```

### OptionGenerator

It emits typed Options rather than globally scoring every legal action:

1. `COMMITTED_RESCUE`: only complete committed hazards and ReverseViability.
2. `STRICT_FORCED_WIN`: only complete proof.
3. `DIRECT_KILL`: complete direct-fire or attack-closure evidence.
4. `ATTACK_SETUP`: aim, intercept, escape denial or verified possible-hit
   pressure, with a target and response policy.
5. `STAR_CONTROL`: target star generation and path deadline.
6. `TERMINAL`: preserve/non-loss or comeback target and deadline.
7. `POSITION`: explicit navigation target, never an untyped `REPOSITION`.
8. `RESOURCE`: bomb/skill effect target, deadline and verified opportunity
   cost. Readiness alone is not a proposal.

`NONE` is not an Option unless no action is possible or a complete waiting
certificate exists.

### Shared physical transition

Aliased Options with the same primitive `(action, argument)` apply the first
frame once. Hard, hazard projection, chance support and the physical successor
are shared. Option-specific work begins only at continuation generation and
utility evaluation.

This removes the diagnostic POC's duplicated root transitions and prevents the
Option count from multiplying the most expensive physics work.

### Continuation policy

An Option is not a fixed action sequence. At every later own node it generates
at most two objective responses, plus any mandatory rescue or strict proof:

- attack: fire, aim turn, safe approach, or effect skill;
- star: path-progress action and one safe tactical interruption;
- terminal: non-loss/comeback response;
- position: path-progress and stability response;
- resource: effect-completing response, otherwise abort.

An observation split may choose a different primitive action while preserving
the Option identity. A target generation change, missed deadline, new committed
hazard, or refutation aborts the Option.

### Risk and selection ownership

Hard still owns only proven physical facts. Risk first filters physical
successors. Option quality is then compared without flattening all dimensions
into one score:

```text
Hard
→ committed rescue
→ Risk acceptable physical successors
→ complete Option support
→ terminal/non-loss interval
→ tactical Minimax interval when applicable
→ objective deadline and progress
→ resource opportunity cost
→ stable row
```

Minimax supplies a tactical interval; it does not globally own navigation.
Bomb and poison can win only as `RESOURCE` or verified attack Options, never
because a generic readiness feature made their primitive score large.

## Performance contract

The production implementation must use one search, not the diagnostic second
pass.

- Option capacity: observed maximum 15; production selects a fixed top-K
  frontier after Hard/Risk and records explicit truncation.
- First-frame physics is keyed by primitive row and shared by all aliases.
- Own continuation width is at most two objective responses plus mandatory
  rescue/proof; enemy width keeps the existing representative policy.
- Non-contact Options use cached path/deadline evaluation and execute zero
  Minimax nodes.
- Fixed TypedArrays only; no per-frame objects.
- Cache identity includes Option kind, target signature and generation only
  after the shared physical successor.
- Any Minimax semantic change triggers depth/work calibration again.

## Execution order

1. Keep the current diagnostic POC default-off and preserve its two A/B
   samples.
2. Add an allocation-free `OptionGenerator` and audit proposal funnels without
   changing actions.
3. Require explicit target/effect evidence for bomb and poison; measure how
   often unverified resources currently own a root.
4. Add primitive-to-Option alias mapping to `RootTransitionSlab`, so the first
   transition is evaluated once.
5. Move option-aware continuation into the existing `ProductionDepthSearch`;
   delete the second diagnostic search from the candidate path.
6. Add a cheap non-contact OptionArbiter. It must run zero Minimax nodes.
7. Run paired Discovery and an untouched independent sample. Action ownership
   needs at least +3pp, no reverse-transition excess, and all hard invariants 0.
8. Only then run a larger arena and repeat depth/work calibration.

## Explicit non-goals

- Do not raise search depth to compensate for missing objectives.
- Do not add a global FIRE bonus.
- Do not weaken Risk to make option-aware proposals pass.
- Do not let possible projectile, future FIRE, or incomplete Information create
  Hard or committed escape ownership.
- Do not copy V1 code into V2. V1 supplies ordering evidence only.

## Information Option interval Shadow result

The first implementation now reuses the existing `FastState`,
`ProductionInformationSearch`, and option-aware physical evaluator. It does not
allocate a second world model. `ProductionInformationSearch` binds the current
root Option while evaluating each Information row, so aliases keep distinct
continuation policies.

The output is deliberately split into three arrays:

```text
ordering[option]  scalar diagnostic estimate
lower[option]     ownership lower bound
upper[option]     ownership upper bound
```

Missing world, direction, enemy-column, typed-Option, budget, or restore
support leaves `[lower, upper] = [-32000, 32000]`. Only a complete depth-one
dependency-projected support can collapse the interval. Even then, only
`DIRECT_KILL` and `ATTACK_SETUP` are eligible, and ownership would require
`candidate.lower > incumbent.upper` after Hard and Risk.

On the fixed first 16 scenarios (32 candidate matches), the initial broad
Shadow ran 2,174 matrices and 18,926 nodes. It found 47 strict Option
dominances, 41 of which changed primitive action, but increased local total
runtime by about 29.5%.

A zero-allocation preflight now skips roots without a complete tactical Option
on a different primitive. It preserved all 41 action-changing certificates
while reducing actual searches from 2,174 to 246 and nodes from 18,926 to
4,856 (74.3% fewer nodes). Against the repeated paired baseline, local total
runtime overhead fell to about 3.4%. Outcome, stars, and crashes were unchanged;
the optional work schedule caused small action-count drift, so Shadow is not
treated as a behavior-equivalence test.

The active ownership experiment was then run twice on the same first-16 set and
reproduced exactly. It is rejected:

| metric | baseline | ACTIVE |
|---|---:|---:|
| V2 W/L/D | 4/27/1 | 2/29/1 |
| analysis score | 14.06% | 7.81% |
| candidate crashes | 12 | 15 |
| candidate FIRE | 162 | 180 |

All Hard, Risk-dominance, restore, timeout and error invariants remained zero,
so this is not a safety bypass or performance-fallback result. Of 34 strict
overrides, 33 were `ATTACK_SETUP` and only one was `DIRECT_KILL`; 27 changed
`GO` to `FIRE`. The local model proved that an attack posture had a larger
one-frame heuristic interval, not that the attack would close into a hit or
kill. Two prior V2 wins became V1 wins and no loss became a win.

Therefore a one-frame `ATTACK_SETUP` interval is ordering evidence only. It may
own an action only after a multi-frame purpose certificate proves a concrete
hit deadline, enemy-response reduction, and own escape continuation. A strict
terminal `DIRECT_KILL` certificate remains architecturally eligible but has
only one sample here and no independent positive evidence.

## AttackSetupClosure result

The one-frame ownership path has now been removed. `ATTACK_SETUP` remains in
the typed Option portfolio and Information search, but cannot own an action
without a separate `AttackSetupClosure`. `DIRECT_KILL` remains independently
eligible.

The closure reuses the existing event-driven `ProjectileAttackClosure` horizon
instead of adding another search stack. For every enemy root response it
requires either a proven doomed branch or measurable setup/mobility/endpoint
restriction. It additionally requires at least one actual doomed branch,
complete post-fire escape, non-regressing counter exposure, Risk tuple and
`robustLower`, plus complete committed-hazard viability when one exists. All
outputs use fixed integer TypedArrays; measured hot allocation is zero.

The 34 legacy overrides were serialized as a 34-root compact corpus and replayed
through the same runtime certificate code. Of 33 setup roots:

- all 33 left at least one enemy response unconstrained;
- 30 had no hit branch at all;
- 30 reduced `robustLower` versus the incumbent;
- 5 lacked complete PAC support;
- 3 worsened the Risk tuple;
- zero obtained a certificate.

The fixed-16 ACTIVE POC then restored the entire behavioral loss:

| metric | baseline | legacy setup owner | strict closure owner |
|---|---:|---:|---:|
| V2 W/L/D | 4/27/1 | 2/29/1 | 4/27/1 |
| analysis score | 14.06% | 7.81% | 14.06% |
| candidate crashes | 12 | 15 | 12 |
| setup overrides | 0 | 33 | 0 |
| direct-kill overrides | 0 | 1 | 1 |

The strict run evaluated 40 setup candidates: 37 were rejected, 3 incomplete,
and 0 certified. Hard, Risk domination, restore, timeout/error and allocation
invariants were all zero. This accepts the ownership boundary but not the
behavioral component: it is `NEUTRAL`, remains diagnostic/default-off, and is
not evidence that attack setup is solved.

The next attack improvement must model a genuine two-stage response policy,
such as `TURN/GO → FIRE → projectile horizon`, and compare that whole chain
against the incumbent navigation chain at equal support. The closure must not
be loosened merely to manufacture ACTIVE overrides.
