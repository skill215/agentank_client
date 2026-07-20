# Initial-full historical result analysis

This report is result-first. `PASS`, `ACCEPTED`, and invariant counts are supporting evidence only;
they are not gameplay outcomes.

No new V1/V2 match was generated for this analysis. Whole-match W/L/D therefore belongs to the
captured V2 source `d2a2221f...`. Current V2 source `2586b3c4...` was evaluated on persisted roots
and fixed historical continuations. A current-source whole-match W/L/D cannot be inferred from those
root replays.

## Captured V2 whole-match result

The immutable arena contains 598 historical scenarios, four seat/skill variants, one repetition,
and 2,392 complete matches.

| Runtime-independent result | Matches | Share |
|---|---:|---:|
| V2 win | 1,330 | 55.60% |
| V1 win | 905 | 37.83% |
| Draw | 157 | 6.56% |
| V2 win + half draw | 1,408.5 equivalent wins | 58.88% |

The analysis deliberately ignores local runtime as a winner. The simulator's raw result was V2
1,343 and V1 1,049 with no draws. Reclassification changed 144 raw V1 runtime tiebreak wins and 13
raw V2 runtime tiebreak wins into draws. It did not rewrite the persisted raw result.

The required score rate is strictly over 60%. This run has 2,817 half-point score units and needs
2,871, so the captured V2 is short by 54 units, equivalent to 27 losses changing to wins or 54 losses
changing to draws.

## Why V2 won and lost

| Terminal cause | V2 win | V1 win | Draw | V2 score rate | Interpretation |
|---|---:|---:|---:|---:|---|
| Frame limit, unequal stars | 864 | 110 | 0 | 88.70% | V2's star collection and 128-frame positioning are its strongest behavior. |
| Single crash | 386 | 699 | 0 | 35.57% | V2 is destroyed alone far too often; this is the dominant loss source. |
| Mutual crash, unequal stars | 80 | 96 | 0 | 45.45% | Trade resolution is slightly unfavorable. |
| Frame limit, equal stars | 0 | 0 | 136 | 50.00% | Runtime winner is intentionally ignored. |
| Mutual crash, equal stars | 0 | 0 | 21 | 50.00% | Runtime winner is intentionally ignored. |

The totals reconcile exactly: V2's 1,330 wins are `864 + 386 + 80`; V1's 905 wins are
`110 + 699 + 96`.

The main structural diagnosis is not "V2 cannot win." It wins the star race decisively, but gives
back much of that advantage in direct survival and combat. Single-crash results have a V1 advantage
of 313 matches. V2 fired 10,584 times versus V1's 17,586, only 60.18% as often. That does not prove
that every missing shot is wrong, but together with the crash split it is direct evidence that combat
closure and threat conversion are weaker than star control.

## Skill, seat, and paired-map result

| Assignment | V2 win | V1 win | Draw | V2 score rate |
|---|---:|---:|---:|---:|
| Native: V2 poison, V1 stun | 591 | 521 | 84 | 52.92% |
| Skill cross: V2 stun, V1 poison | 739 | 384 | 73 | 64.84% |
| Native, V1 in seat 0 | 291 | 268 | 39 | 51.92% |
| Native, V2 in seat 0 | 300 | 253 | 45 | 53.92% |
| Skill cross, V1 in seat 0 | 374 | 186 | 38 | 65.71% |
| Skill cross, V2 in seat 0 | 365 | 198 | 35 | 63.96% |

Seat exchange moves the score by about two percentage points. Skill assignment moves it by almost
twelve points. Because the real V2 owns poison, the Native 52.92% result is more representative than
the combined 58.88%; the combined score is materially lifted by giving V2 stun.

Across 1,196 seat-swapped pairs:

- V2 wins both seats: 378 pairs.
- V1 wins both seats: 182 pairs.
- Each wins one seat: 493 pairs.
- V2 win plus draw: 81 pairs.
- V1 win plus draw: 48 pairs.
- Both draw: 14 pairs.

Native poison pairs contain 147 V2 sweeps and 120 V1 sweeps. Skill-cross pairs contain 231 V2 sweeps
and only 62 V1 sweeps. This again identifies skill-specific decision quality, rather than seat bias,
as the larger problem.

## Current V2 versus captured V2 on death windows

The focused cohort contains 64 Native poison single-crash losses. Each was inspected at the final
four decisions, giving 256 fatal-window roots. Ninety-six swapped/win/star terminal roots act as
controls. Every branch changes one V2 action and then keeps the historical continuation fixed; it is
causal evidence for that continuation, not a claim about the opponent's minimax response.

Sixty of the 64 losses have at least one last-four-frame action that survives the historical terminal
window. Four have no surviving action among the inspected candidates.

| Measure | Captured V2 `d2a2221f...` | Pre-repair `ad6605ac...` | Current `2586b3c4...` |
|---|---:|---:|---:|
| Fixed-continuation fatal frames labelled `PROVEN_SAFE` | 14 | 1 | 1 |
| One-step `PROVEN_SAFE` contradiction | 1 | 0 | 0 |
| Avoidable fatal frames where selected action survives | 13 | 12 | 15 |
| Loss entries with at least one selected rescue | 12/64 | 12/64 | 15/64 |
| Control terminal roots surviving | 67/96 | 67/96 | 67/96 |
| Previously surviving primary/control roots made fatal versus pre-repair | n/a | n/a | 0 |

The remaining fixed-continuation `PROVEN_SAFE` case is not a strict proof false positive. Its root
action has a different common later policy that survives the four-frame AND/OR closure, while the
diagnostic deliberately replays the old historical later actions. A fixed continuation dying does
not refute the existence of that later policy. The independently checkable one-step contradiction
count is zero.

The current source improves actual action choice on this cohort. Relative to `ad6605ac...`, nine
primary decisions change: three previously fatal decisions survive and none of the previously
surviving primary decisions become fatal. The 96 control entries also have zero survival regression.
The three new rescues are:

- `mat_2XBvJOhUc5TK0tBIt:NATIVE_V1_SEAT0:r0`, frame 120: `GO -> TURN_LEFT`;
- `mat_HiB4dgFkibuB1WcuY:NATIVE_V2_SEAT0:r0`, frame 22: `GO -> TURN_LEFT`;
- `mat_0UdXAgMVjR8JKedYL:NATIVE_V1_SEAT0:r0`, frame 38: `GO -> TURN_LEFT`.

Current V2's 15 rescued fatal decisions are:

- `GO -> TURN_LEFT`: 6.
- `TURN_LEFT -> THROW_BOMB`: 4.
- `TURN_LEFT -> GO`: 3.
- `FIRE -> GO`: 2.

Four rescued decisions occur at the historical terminal action, two at terminal-minus-one, six at
terminal-minus-two, and three at terminal-minus-three.

The structural change is quantifier-specific. A future enemy `FIRE` remains `POSSIBLE_DEATH` risk;
it is no longer converted from a boolean `NO_WITNESS` result into probability-one physical death.
At the same time, all supported `ChanceOutcome` command geometries are stored in fixed integer
arrays and priced by the Safety closure. This catches reversed/alternative movement into a firing
ray without changing Hard or assuming a floating/uniform chance probability.

## Where current action selection is still wrong

There are 165 fatal frames with at least one fixed-continuation rescue. Current V2 selects a survivor
in 15 and still dies in 150. The 150 remaining failures split into mutually exclusive controller
failure surfaces:

| Failure surface | Frames | Meaning |
|---|---:|---|
| No rescue passes the risk-acceptance gate | 27 | The risk gate excludes every action that survives this continuation. |
| A rescue is acceptable but every rescue is marked dominated | 76 | Pareto inputs/value estimates make the fatal action look preferable. This is the largest defect class. |
| A non-dominated rescue exists but has lower robust value | 33 | Search/value backup ranks the fatal action above the observed rescue. |
| A rescue shares or exceeds the selected robust floor but policy chooses the fatal action | 14 | Matrix/tie policy cannot distinguish equal-valued survival and fatal branches. |

Of the 150 selected fatal actions, 148 are labelled `POSSIBLE_DEATH`, one is `UNKNOWN`, and one has
the valid alternative-policy `PROVEN_SAFE` certificate described above. The remaining problem is
mostly not an immediate proof error. It is the translation from Safety/Risk dimensions and opponent
behavior estimates into acceptance, dominance, robust value, and final policy. A warning exists,
and 132 of the 150 fatal selections still pass the risk gate.

Relative to pre-repair `ad6605ac...`, the controller surface changed as follows:

- acceptable-but-dominated rescue failures improved from 80 to 76;
- no-acceptable-rescue failures stayed at 27;
- lower-robust rescue failures stayed at 33;
- equal/above-floor policy failures moved from 13 to 14;
- selected rescues improved from 12 to 15 with zero observed survival regression.

This is a positive but deliberately narrow result. It proves a local structural improvement on
persisted fatal windows; it does not establish a new whole-match win rate.

The 76 dominated-rescue frames were inspected separately before proposing another change. In 73 of
them the selected fatal action itself dominates at least one fixed-continuation rescue; every one of
the 76 has some fatal candidate that dominates a rescue. Only 34 also have a surviving candidate that
dominates a rescue. Across 183 selected-versus-rescue comparisons, 127 have the same modeled risk
vector, 50 rate the selected fatal action as safer, and only six rate the rescue as safer. Sixty-six
of the 76 roots completed only InformationSearch depth 1, seven completed depth 2, two used physical
depth 1, and one completed no value depth. The selected fatal action is `GO` in 42 of the 76.

This rules out a simple dominance-operator or tie-policy patch as the next repair. The dominant
missing information is multi-frame quantitative differentiation: the one-frame value and coarse
four-frame risk often assign equal or better vectors to a path that dies two to four frames later.
The next structural repair should therefore produce fixed-budget multi-frame risk/value bounds and
commit them only as a complete comparable action set. Globally penalizing `GO`, promoting turns, or
removing Pareto dominance would fit the historical continuation rather than repair Minimax.

### Multi-frame quantitative repair result

That next Safety/Risk step is now implemented. The optimized source-bound focused report rescues 20
of the 165 avoidable fatal frames, compared with 15 after the preceding quantifier/Chance repair: five
net additional rescues, no lost primary survivor, no control survival regression, no exact replay
failure, and no one-step `PROVEN_SAFE` contradiction. The remaining 145 frames split into 38 with no
acceptable rescue, 65 where all acceptable rescues are dominated, 28 with a lower robust rescue, and
14 at/above the floor but still lost by policy.

The path stage is a conservative four-frame upper envelope, not a Proof. It publishes the complete
root action set atomically, handles future stun by taking the worse normal/reversed geometry, refuses
incomplete hidden or possible-projectile support, and never weakens committed hazard evidence. Union
reachability, generation-stamped `(depth, cell)` caching, and a zero-frontier fast path reduced the
maximum focused-root threat work to 51 unique cells. The five-batch ordinary composite P95 is 1,661
microseconds against a 3,108 microsecond limit; tracked hot allocation is zero.

Detailed architecture, rejected intermediate variants, UT coverage, performance evidence, and limits
are recorded in `docs/implementation/multi-frame-risk-bounds-structural-repair.md`.

### Possible-projectile path follow-up

The next source-specific repair added tracked possible projectiles to the same four-frame future
policy and moved their trajectory projection into one revision-keyed shared TypedArray field. On the
same immutable 165-frame denominator, selected survivors improve from 20 to 25 with no lost earlier
survivor and no control survival regression. The 140 remaining fatal selections are 40 with no
acceptable rescue, 61 dominated-rescue cases, 25 below the robust floor, and 14 at/above the floor.

The 61 dominated cases are no longer treated as one “increase depth” problem: 27 are blocked by the
joint possible-projectile/hidden-world support boundary, while 20 have complete path publication and
genuine value-depth non-discrimination. This ordering prevents score calibration from hiding an
InformationState coverage defect. Architecture, exact artifacts, UTs, benchmark and the next support
boundary are recorded in
`docs/implementation/possible-projectile-path-support-repair.md`.

## What the 19,136-root replay does and does not prove

Current V2 emitted the following actions on the persisted roots: `GO` 6,290, `TURN_LEFT` 2,910,
`TURN_RIGHT` 221, `FIRE` 1,062, `THROW_BOMB` 3,376, `CAST_POISON` 4,779, and `NONE` 498. This root
sample is event-selected and is not an action frequency distribution over complete matches.

The replay proves that current V2 can restore and evaluate every saved root consistently. It does not
continue each match with current V2 decisions, so it cannot produce current-source W/L/D. The only
honest current gameplay conclusions available without a new arena are the fixed-continuation death
and control deltas above.

## Performance result

The captured whole-match run shows local V2 total time at 123.44% of V1 and local P95 at 129.87% of
V1. This is relative local evidence only, not platform three-second timeout evidence, and it shows the
captured V2 was slower than V1.

The historical regression tool now executes all 19,136 roots in about 149.44 seconds instead of the
previous projected 6.6 hours. That is a test-harness improvement of roughly 159x; it is not a V2
engine performance improvement. Current V2 still needs a source-bound complete-match benchmark before
claiming engine runtime improvement.

For the 160-entry focused cohort, the rejected broad boolean-frontier experiment consumed 21,807
frontier nodes and introduced two primary survival regressions. The current quantifier-correct path
uses 98 frontier nodes, rescues three additional primary fatal decisions, and introduces zero primary
or control survival regression. The reduction comes from fixed-array ChanceOutcome geometry in the
existing quantitative Safety pass, not from increasing search depth.

## Evidence

- Captured whole-match analysis:
  `artifacts/fast-regression/reports/arena-full/efdabbdbee9e039b4e848f6380b0957904adcfb953a491cf8281796593e26837.json`.
- Current fixed-continuation result delta:
  `artifacts/fast-regression/reports/native-poison-death-result-delta/355d6283b1873c93167ed1e17f4ca24eb3762069dbbada5fefc0b26500e1190a.json`.
- Quantifier/ChanceOutcome repair result:
  `artifacts/fast-regression/reports/native-poison-death-quantifier-chance-r2/d5db1c1784dc4dc177104cbbf4a15c512836155a9407ec5d34d55e8eaefdd9a2.json`.
- The five real-history non-regression fixtures are executable UTs in
  `test/fast-regression/chance-geometry-regression.test.js`.
- Complete current-root replay:
  `artifacts/fast-regression/reports/capsule-all/c9782bca3f4185ab24d65f5ca2a46facb11ef4a5eeeaba182c448a7100220088.json`.
