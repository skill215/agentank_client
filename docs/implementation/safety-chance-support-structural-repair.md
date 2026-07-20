# Safety Chance-Support Structural Repair

Status: narrow repair accepted locally; full arena qualification not rerun.

## Scope and evidence

This repair addresses one proven production defect: a root action affected by active stun had one
surviving normal outcome and one fatal reversed outcome, but `InformationSafetyClosure` consumed only
the normal projected cell and published `PROVEN_SAFE`.

The immutable baseline evidence is:

- defect corpus:
  `artifacts/fast-regression/defect-corpora/safety-v1/c03bc4ae6b0d176c8bf317e5aed444eb25619b35fcd66deb35f16ec4425d2eb3.json`;
- baseline focused report:
  `artifacts/fast-regression/reports/native-poison-death/b2bc12608a764996385f777606ea27401562544848e3b2bc9b617f8db1e8da9d.json`;
- repaired focused report:
  `artifacts/fast-regression/reports/native-poison-death-safety-chance/3fe93157179675bb363f9106cc9f47981ed0a2084ee2ccc0d82d72532e76206a.json`;
- repair verification:
  `artifacts/fast-regression/reports/safety-repair-verification/9058ce2062f8ad3307cdceccdfcc4d9c1b7890c3b751a45d537555722dacd17a.json`;
- SR2 verification fingerprint:
  `26ecee73f405b08d157fd8af3478843c937b54f113148724beb40971022f5275`.

The corpus intentionally retains the original classification: one strict one-step contradiction and
thirteen continuation-obligation candidates. Repair verification compares new output with that frozen
baseline; rebuilding the corpus after a fix would destroy the regression signal.

## Test-first reproduction

The production integration UT rehydrates Capsule
`ce7702f0d55f6c9444dcc0eb3e2358381fd43e2c2ae5643dfdc9dcbb6bb36b18` at frame 63.
The V2 action is `GO`, Hard sees two stun outcomes, and the pinned simulator proves that the reversed
outcome moves V2 into the committed projectile and crashes it in the same frame.

Before implementation, the test failed because `FinalActionGate` had no Chance support output. After
the repair it asserts all of the following simultaneously:

- support count is two and fatal support count is one;
- Hard remains `ALLOW` because death is not universal across ChanceOutcome;
- Safety is `POSSIBLE_DEATH`, never `PROVEN_SAFE`;
- exact physical replay remains unchanged and fatal for the recorded reversed outcome.

An implementation-independent exhaustive Safety oracle now covers horizons one through four. It
enumerates deterministic observation-consistent policies, keeps EnemyAction, HiddenWorld,
ChanceOutcome and ObservationSplit as distinct support quantifiers, rejects incomplete support as
`UNKNOWN`, and returns explicit future response obligations for strategy-existential safety. In
particular, a fixed continuation may die even when another future response is a valid witness; this is
why the other corpus frames remain candidates rather than asserted false positives.

## Production change

`HardGate.evaluateAllOwnChance` now exposes fixed integer support counts. `FinalActionGate` stores the
counts in preallocated `Uint8Array` slabs. `InformationSafetyClosure` consumes fatal support as a
Safety/Risk upper bound and mirrors the counts into `SafetyOutcomeSlab` for diagnostics.

No object is allocated in the hot path. No stun probability is invented: the platform-confirmed
support is retained, while its unconfirmed probability uses the conservative fatal-mass upper bound.
Potential Chance death is not written into Hard. Leading protection, global risk settings, combat
pressure, opponent parameters and Candidate bytes were not tuned in this change.

## Results

| Check | Before | After |
|---|---:|---:|
| Strict one-step `PROVEN_SAFE` contradictions | 1 | 0 |
| `PROVEN_SAFE` then fixed-continuation fatal frames | 14 | 12 |
| Exact replay failures | 0 | 0 |
| Control survival regressions | 0 | 0 |
| Focused execution failures | 0 | 0 |

Both reclassified frames belong to the same stun/projectile chain at frames 62 and 63. They now expose
support `2`, fatal support `1`, Hard `ALLOW`, and Safety `POSSIBLE_DEATH`. No new fixed-continuation
fatal frame became `PROVEN_SAFE`.

The final 160-entry focused run completed in 221.56 seconds with all 1,477 physical branches served
from the immutable cache. The 16-entry edit smoke completed in 27.04 seconds. Root action reproduction
differences increased by six because the cold reconstructed engine can now make a different risk
choice; this is expected diagnostic sensitivity, not an event-replay or control-survival failure.

The SR2 five-batch microbenchmark reported P95 712 microseconds against a 3,108 microsecond limit and
zero tracked hot allocations. The complete SR0-SR4/Minimax/fast-regression suite passed 112 tests
after the repeatable repair verifier was added.

## Remaining boundary resolved by the next diagnostic stage

The twelve multi-frame candidates were subsequently classified by the bounded physical strategy
oracle described in [physical-safety-oracle-classification.md](physical-safety-oracle-classification.md).
Four are confirmed production Safety false positives and eight have an observation-consistent window
witness. The four confirmed cases now have an immutable defect corpus and executable pinned-simulator
tests; the eight witnesses are kept separate and cannot be promoted into Hard failures.

The prior full-arena score gate was not rerun. Therefore this repair does not claim the greater-than-60%
qualification threshold, does not freeze a Candidate, and does not authorize official simulate or
publish.
