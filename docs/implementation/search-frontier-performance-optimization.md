# Search frontier performance optimization

## Scope

This change optimizes the production PhysicalState Minimax search without changing HardGate,
strict Proof, HiddenWorld safety, risk acceptance, leading protection, or stun semantics.
It does not run a new V1/V2 arena and does not change the 10% destruction or 60% total-win gates.

## Finding

Normal configuration requests 512 value nodes, but the callback reserve and the combined
FAST_TRANSITION + HARD work charge reduce the effective maximum to 250 nodes. The old schedule
usually completed `(depth=1,width=2)` and `(depth=2,width=2)`, then consumed every remaining node
in an incomplete depth-three attempt. Only the last complete depth-two result was published, so
the abandoned nodes increased runtime without improving the selected action.

Depth and representative width are different approximation axes. Direct full-width search was
also measured, but it cannot be used as the production default: at 250 nodes its completion rate
was 23.95%, and even at 312 nodes it was only 63.54%.

## Production schedule

The production search now uses a calibrated adaptive schedule:

- with at least 250 available nodes, no active stun, and no tank holding an immediately available
  aligned FIRE ray, execute depth two directly at width two;
- with active stun, an immediate FIRE contact, a smaller budget, or target depth below two, keep
  conservative iterative deepening;
- never publish an incomplete iteration;
- keep root restore and cache semantics unchanged.

Immediate FIRE contact deliberately stays on the conservative path because its depth-one
selective trap extension contains evidence that an approximate deeper value must not erase.

Chance support for one joint action is also stored in fixed per-frame integer slabs. Outcome
enumeration reuses the stored own/enemy support sizes instead of recomputing stun and compound
action support for every outcome. The hot path still allocates zero temporary objects.

Hazard planes now use the active map cell count as their time-row stride instead of always
allocating for 32x32. Exposure counts use `Uint8Array`: the configured physical maximum is only
8 projectiles plus 4 bombs, so one byte covers every possible simultaneous source without loss.
The 32x32 maximum-map build remains capacity-safe; smaller maps gain proportionally better cache
locality and clear less memory on every hazard rebuild.

## Reusable benchmark

`npm run benchmark:search-frontier` runs deterministic contact scenarios in five measured batches.
It reports completion, support completeness, node and time P95, selected rows, and regret against
an unbounded depth-two/full-width oracle. Reports are source-bound and immutable under
`artifacts/benchmarks/search-frontier/`.

Final report:

`artifacts/benchmarks/search-frontier/0a9b8783d76865f64dc33d6e410fd2d1a160599240da2f795ceb03083df7752e.json`

| Metric | Legacy | Adaptive | Change |
| --- | ---: | ---: | ---: |
| completed searches | 480/480 | 480/480 | no loss |
| mean nodes | 250 | 194 | -22.4% |
| P95 search time | 1734 us | 1405 us | -19.0% |
| mean depth-two/full-width regret | 504 | 233 | -53.8% |
| maximum regret | 26550 | 8202 | -69.1% |
| root restore failures | 0 | 0 | unchanged |
| hot allocations | 0 | 0 | unchanged |

Two of 96 unique scenarios changed selection. One changed from TURN_LEFT to POISON and removed
26550 oracle regret; one made the same action change and added 550 regret. This is a net benchmark
improvement, not a claim of platform win rate.

## Historical regression

The existing native poison death/control cohort was replayed without creating new battles:

- 160 focused entries completed with zero replay failures;
- 25 previously rescued avoidable frames remain rescued;
- control survival regressions remain zero;
- the 61 dominated-rescue frames and all root-cause counts are unchanged;
- exact replay failures remain zero.

Focused report:

`artifacts/fast-regression/reports/native-poison-death-search-frontier-r11/c469ec3d4e61ce2c413f1c549f7a29072087d013e6a281f6f41cc26c8a90a9ec.json`

## Verification and remaining gate

- SR0-SR4, Minimax-core, and fast-regression tests: 165/165 passed.
- production source/minified differential: zero mismatches;
- two independent builds produced identical source and minified hashes;
- source size: 498267 bytes, below the 500000 local source gate;
- maximum-map TypedArray total: 901271 bytes, below the 1000000 gate;
- a 20x20 map uses 575543 bytes and the 5x5 build fixture uses 379793 bytes;
- minified SHA-256: `c180424ba9a068faaf1eecd9375a6374b143a238a3953630c8ac9dfe961f9037`;
- IMP6 local gate: PASS, 202/202 tests, no local blocker.

Platform byte/runtime calibration remains external release evidence and is not inferred from local
time measurements.
