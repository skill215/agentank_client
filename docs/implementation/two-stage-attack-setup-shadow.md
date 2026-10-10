# Two-stage AttackSetup Shadow

## Outcome

The one-frame `ATTACK_SETUP` owner was not repaired by adding score or search
depth. It was replaced with a diagnostic-only two-stage physical closure:

```text
GO/TURN
→ every root EnemyAction × ChanceOutcome
→ Hard
→ FIRE
→ every successor EnemyAction × ChanceOutcome
→ Hard / committed viability
→ ProjectileAttackClosure to normative projectile invalidation
```

The first implementation scanned only rows already labelled `ATTACK_SETUP`.
That found only three movement candidates among 40 setup Options. The final
frontier therefore scans every `GO`, `TURN_LEFT`, and `TURN_RIGHT` primitive
after a successful Information interval evaluation. It does not change the
selected action and remains absent unless its diagnostic option is enabled.

## Fixed-16 evidence

The pure Shadow comparison used the same Information interval implementation
on both sides. All 32 candidate matches were behavior-identical: 4 wins, 27
losses, 1 draw, 8 candidate stars, 12 candidate crashes, and 167 FIRE actions.
Hard, Risk dominance, restore, timeout, and error failures were zero.

The physical frontier evaluated 738 movement candidates:

| result | count |
|---|---:|
| certified | 7 |
| rejected | 657 |
| incomplete | 74 |

The main rejection dimensions were 435 uncovered enemy responses, 422 cases
without a hit branch, 150 successors that could not FIRE, 73 incomplete PAC
supports, and 44 second-frame Hard failures. There was no budget exhaustion,
root restore failure, or hot allocation. The explicit transition counter used
1,409 nodes total and at most 56 for one candidate.

These are PhysicalState certificates, not automatically InformationState
action proofs. Six of the seven certified rows still had full-range
`[-32000, 32000]` Information intervals. Only one had an exact interval.

## ACTIVE POC

An isolated ACTIVE mode required all of the following:

```text
two-stage physical certificate
+ exact Information interval
+ strict lower > incumbent upper
+ Hard ALLOW
+ Risk acceptable and not dominated
```

It produced zero `ATTACK_SETUP` proposals and zero setup overrides. The only
proposal was the already accepted `DIRECT_KILL`. Baseline and candidate were
again exactly 4/27/1 with zero action, star, crash, FIRE, bomb, or skill delta.

This is a useful negative result: candidate generation is no longer the main
blocker. The missing layer is a sound InformationState lower bound for the six
physically certified but unresolved setup chains. Directly granting those rows
ownership would reintroduce the same unsupported-value bug as the rejected
one-frame owner.

## Next boundary

The next implementation should be a common-policy Information closure only for
the seven certified physical roots. It must reuse existing hidden-world and
possible-projectile support, keep the first action common until an observation
split, and return a lower/upper interval. It must not add a second general
Minimax, relax Risk, or run on the 731 non-certified movement rows.

Before production use, its work must enter the runtime ledger and be depth/
fallback calibrated. Local wall-clock ordering from this small paired run is
too noisy to qualify performance.

## Possible-projectile common-policy closure

The seven PhysicalState certificates were then evaluated against the missing
projectile world. Six roots contained exactly one hostile possible projectile;
the seventh had none. The closure injects that projectile as a committed entity
inside one undoable transition and requires the same movement and the same
second-frame `FIRE` in both worlds.

The first pass found four enemy capability gaps. All four were the same known
local-simulator deviation: the pinned simulator exposes poison action cadence
from absolute frame parity, while the platform contract and V2 model use parity
relative to the poison application. The proof service now reconstructs phase
from the observed `canActThisFrame` only inside its injected world. It does not
change the root PhysicalState or production poison rule, and undo/restore is
verified after every candidate.

Final fixed-16 result:

| result | count |
|---|---:|
| robust certificate across projectile absent/present worlds | 2 |
| rejected by the projectile-present world | 4 |
| incomplete | 0 |
| cadence-rephased proof worlds | 4 |
| explicit present-world nodes | 17 |
| maximum nodes for one present world | 7 |

One robust certificate was already in a V2 win. The other occurred at frame 57
of `mat_KlF8S4gI3ryC6gSoB`, where `GO → FIRE` survived all represented worlds
while the current action was `FIRE`; the match was a V2 loss. However, both
robust rows still had the full Information interval `[-32000, 32000]`.

Therefore this phase closes the possible-projectile support question but still
does not establish action ownership. An ACTIVE switch would need both a sound
relative value/nonloss certificate and persistent execution of the verified
second action. Granting ownership from attack pressure alone would repeat the
rejected one-frame override. Production remains disabled.
