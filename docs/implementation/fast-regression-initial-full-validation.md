# Fast Regression Initial Full Validation

Status: structural regression `ACCEPTED`; gameplay qualification `REJECTED`.

## Immutable evidence

- run: `run-595624927158cfa1899170eb60833157df3cb67e4bd3e162e855e292bde987b9`
- history snapshot: `f94a7b5ab148572044f09e135cc75ebcb4fb97a8c8e662cad2d8d9ffdfeaed90`
- denominator: 598 scenarios, four seat/skill variants, one repetition, 2,392 matches
- replay windows: 19,136
- logical unique windows: 19,136; 80 earlier acceptance capsules were logical duplicates
- full cohort: `initial-full`, fingerprint
  `9ad8441eef9ceaf947a677024477fea2b77433fb8f42bfbd215bfb9de16f1c5e`
- structural report:
  `artifacts/fast-regression/reports/all/80cdd22e1a54e01b802e581b0b3918b376d21ba5111034417b43223627ec0007.json`
- gameplay report:
  `artifacts/fast-regression/reports/arena-full/efdabbdbee9e039b4e848f6380b0957904adcfb953a491cf8281796593e26837.json`

## Structural result

- 512 independent Minimax depth 1-4 differential cases: zero mismatch
- permanent mutant campaign: 8/8 killed
- selected smoke Replay Capsules: 64/64 passed
- avoidable Hard reject: 0
- selected risk-dominated action: 0
- strict Proof false positive: 0
- root restore failure: 0
- capsule reproduction failure: 0
- complete `test:4`: 97/97 passed

## Runtime-independent gameplay result

| Result | Count |
|---|---:|
| V2 win | 1,330 |
| V1 win | 905 |
| Draw | 157 |
| Strict V2 win rate | 55.60% |
| Win + half-draw score rate | 58.88% |

The score rate gate is strictly greater than 60%. The run has 2,817 score units and requires
2,871, a deficit of 54 units. Equal-star frame limits and equal-star mutual crashes are draws;
local runtime never changes the analysis winner.

The single-crash gate passes: V2 has 386 single-crash wins versus the baseline 325. The required
10% threshold is 358, so the observed increase is 18.76%. However, V1 has 699 single-crash wins in
the same run. This is the dominant gameplay deficit.

## Skill and seat split

| Family / variant | V2 W | V1 W | Draw | Score rate |
|---|---:|---:|---:|---:|
| Native: V2 poison, V1 stun | 591 | 521 | 84 | 52.92% |
| Skill cross: V2 stun, V1 poison | 739 | 384 | 73 | 64.84% |
| Native, V1 starts seat 0 | 291 | 268 | 39 | 51.92% |
| Native, V2 starts seat 0 | 300 | 253 | 45 | 53.92% |
| Cross, V1 starts seat 0 | 374 | 186 | 38 | 65.71% |
| Cross, V2 starts seat 0 | 365 | 198 | 35 | 63.96% |

Seat exchange changes the result by roughly two percentage points. Skill assignment changes it by
almost twelve points. Because the production V2 tank owns poison, the Native 52.92% result is the
most relevant qualification signal; the combined 58.88% result is partly lifted by assigning stun
to V2 in the diagnostic cross family.

## Terminal and pair structure

- star-count frame-limit decisions: V2 864, V1 110, score rate 88.70%
- single crash: V2 386, V1 699, score rate 35.57%
- unequal-star mutual crash: V2 80, V1 96, score rate 45.45%
- equal-star frame-limit draws: 136
- equal-star mutual-crash draws: 21

Across 1,196 seat-swapped pairs: V2 sweep 378, V1 sweep 182, split 493, V2-win/draw 81,
V1-win/draw 48, double draw 14. Native pairs contain 147 V2 sweeps and 120 V1 sweeps; skill-cross
pairs contain 231 V2 sweeps and 62 V1 sweeps.

## Pressure and local performance observations

- V2 FIRE actions: 10,584
- V1 FIRE actions: 17,586
- V2/V1 FIRE ratio: 60.18%
- local V2 total runtime / V1: 123.44%
- local V2 P95 / V1: 129.87%
- V2 timeout/error: 0/0

Local runtime is relative benchmark evidence only and cannot substitute for the platform three-second
timeout. It nevertheless shows that V2 has not reached the stated performance target. The low FIRE
ratio, 35.57% single-crash score, and Native poison split identify combat closure and poison-specific
decision quality as the next diagnostic scope. This report does not authorize a strategy change.

## Toolchain defects found by the full run

The first two attempts correctly finalized as `PARTIAL` and were not merged into the accepted run.
They exposed two evidence-layer defects: non-physical fractional metadata attached to scheduled
actions, and fractional `runtimeMs` embedded inside decision commands. Both are now normalized away
from physical commands and covered by tests.

The full run also exposed slow per-capsule reinitialization. Capsule materialization was interrupted
after the arena had already finalized, resumed from the retained spool, and completed through the new
batch-initialized `materialize-spool` command. Match streams are now prevalidated as one unit before
append, so a future partial run stops on aligned stream denominators.
