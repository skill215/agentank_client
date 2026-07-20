# Native Poison Death-Chain Diagnostic

Status: diagnostic complete; structural repair not yet authorized.

The strict ChanceOutcome defect identified here has since been repaired and locally accepted. See
`docs/implementation/safety-chance-support-structural-repair.md`. This document and its original
report remain the immutable pre-repair baseline; the remaining multi-frame cases are still diagnostic
candidates rather than proven false positives.

## Evidence binding

- source run: `run-595624927158cfa1899170eb60833157df3cb67e4bd3e162e855e292bde987b9`
- source cohort: `initial-full`
- focused cohort: `native-poison-death`
- focused cohort fingerprint:
  `2787476ab2fd4e2ade937c7669fb8a8df23a0f9903d75b6b09ea33ddf563cec2`
- final diagnostic report:
  `artifacts/fast-regression/reports/native-poison-death/b2bc12608a764996385f777606ea27401562544848e3b2bc9b617f8db1e8da9d.json`
- 16-entry edit-loop smoke report:
  `artifacts/fast-regression/reports/native-poison-death-smoke/842202101e3bc60dca277d48791a215c9670d6ac9f89c2953983b65eb39b1b3f.json`
- physical counterfactual batch:
  `artifacts/fast-regression/history/counterfactual-batches/2787476ab2fd4e2ade937c7669fb8a8df23a0f9903d75b6b09ea33ddf563cec2/ca8751d07794636c222914efcc407364bdaf8c60ce23998227f044cfaf9c7a54.json`
- working and captured V2 source SHA-256:
  `d2a2221f3bfff86d4d9db51bc8becf9ac6e5949c2d08e806f800f87b4b06d0e0`
- parameter fingerprint:
  `080aa18a0f3fdf092f1740d372c1f02e4860c30c4dac6a6d666d783d29e649a0`
- compact match index:
  `artifacts/fast-regression/history/match-indexes/run-595624927158cfa1899170eb60833157df3cb67e4bd3e162e855e292bde987b9.json`

The cohort has 160 entries and is exactly seat-balanced: 80 `NATIVE_V1_SEAT0` and 80
`NATIVE_V2_SEAT0`. It contains 64 V2 single-crash losses, the 64 corresponding Native swapped-seat
matches, 16 V2 single-crash win controls, and 16 V2 star-win controls.

## Counterfactual semantics

For each primary loss, the diagnostic rehydrates the physical state and V2 fact memory at the last
four decision frames. Every current `Hard=ALLOW` root action is executed once. Enemy actions and all
later actions are then copied from the historical run. Controls execute only the historical terminal
choice.

The historical action, rather than the rehydrated engine's returned action, is the selected baseline.
This distinction is required because Replay Capsules restore physical facts but intentionally do not
restore Plans or caches. There were 17 primary and four control frames where those derived structures
changed the returned action. They are recorded, but they do not alter the counterfactual classification.

All 160 entries completed. Event-exact replay failures, control survival regressions, and execution
errors were all zero.

The physical branch results are content-addressed by Capsule, simulator identity, branch frame,
terminal frame, and replacement command. They are independent of V2 source code and are stored as a
single immutable batch to avoid per-file synchronization overhead on WSL/NTFS. The final full focused
run reused all 1,477 requested branches with zero recomputation. Root reconstruction still uses the
current V2 source and is never read from this physical cache. The complete 160-entry lane took 230.91
seconds on the fixed local environment; this is a commit-level diagnostic, not the edit loop.

For the edit loop, run:

```sh
./tools/fast-regression-toolchain.sh diagnose-focused --cohort native-poison-death \
  --primary-limit 16 --skip-controls --report-name native-poison-death-smoke
```

On the fixed local environment this completed in 28.83 seconds, with 314 cache hits, zero cache misses,
zero exact-replay failures, and zero execution failures. It is a fast diagnostic lane, not an
acceptance substitute: after it passes, the 64-loss lane and then the complete 160-entry focused lane
must still run before a broader arena.

## Results

| Primary-loss result | Count |
|---|---:|
| A Hard-ALLOW escape exists in the last four frames | 60 / 64 |
| No inspected action escapes the fixed continuation | 4 / 64 |
| Avoidable action-frames | 165 / 256 |
| All inspected actions die | 91 / 256 |

For 58 of the 60 locally avoidable losses, the earliest escape is three frames before the terminal
decision. The remaining two are first avoidable two frames before terminal. This is evidence that a
four-frame death-chain regression lane is useful; a terminal-only test would miss most causes.

The 165 avoidable frames contain 499 surviving action branches. Turn-left and turn-right account for
214 branch survivals, holding position for 81, bomb for 75, fire for 55, go for 52, and poison for 22.
These counts overlap; they do not mean that one global action should receive a fixed bonus. Holding
position is available in 36 of the 64 loss windows but is never the only rescue, so this evidence does
not justify promoting `NONE` globally.

## Defect classes

### 1. Safety/continuation obligation mismatch

Fourteen historical action-frames are classified `PROVEN_SAFE` with zero immediate fatal mass, zero
horizon fatal mass, zero unknown mass, and escape slack four, yet the fixed historical continuation
destroys V2. Twelve of the fourteen have an alternative Hard-ALLOW action that survives. All fourteen
end in `PROJECTILE_OR_COLLISION`.

These fourteen cases are not all strict Safety false positives. For an action one to three frames
before death, `PROVEN_SAFE` may mean that a safe future response exists; replaying the old future actions
does not test that witness strategy. One case is a strict one-step contradiction: at the terminal frame
the modeled-safe action dies under the recorded legal enemy action, with no later own decision available.
The other thirteen are multi-frame continuation-obligation candidates and need an exhaustive strategy
oracle before being called false positives.

The evidence is not explained by hidden enemies: the enemy is visible in all fourteen, HiddenWorld
support is marked complete in all fourteen, and nine have a physically complete root. Ten expose an
enemy bullet in the observation. Visible tank collision pressure is also absent from the safety closure
and is a candidate for the four no-bullet cases.

Code inspection shows a concrete contract gap worth testing: the safety closure records
`committedDeadlineFrames`, but its death-mass calculation consumes possible projectiles and possible
future FIRE rather than the committed hazard timeline. HardGate's reverse viability is existential: it
allows an action when some future escape chain exists. If that is the intended witness, the required
future response is not currently represented as a cross-callback Safety obligation. A committed
projectile must remain a physical fact and create a Safety obligation until normative invalidation,
while Hard must continue rejecting only actions whose death is proven unavoidable.

### 2. Risk/value discrimination is too weak

Of the 165 avoidable frames, 153 label the historical action `POSSIBLE_DEATH`; the engine therefore
usually knows that risk exists. Among the 150 avoidable frames whose root action reproduces exactly,
only 28 have a surviving alternative with a larger modeled expected/robust value. In 112 frames the
historically fatal action is modeled better than every surviving alternative; ten are tied.

This means the dominant failure is not a simple maximum-selection bug. Safety/Risk dimensions do not
distinguish the fatal continuation from the actual escape continuation. A flat FIRE bonus, lower global
risk, or changed tie-break would patch symptoms and would not repair this ordering.

The risk controller also marks 139 of 165 avoidable frames as having at least one acceptable rescue and
115 as having at least one non-dominated rescue, but their robust values are normally below the fatal
choice. Twenty-five of the 28 cases with a numerically higher expected rescue are excluded by the robust
risk floor; only three remain acceptable, and none has a higher robust lower bound. This is consistent
with the controller's present robust ordering, not proof that the controller implementation selected
the wrong matrix row.

### 3. Four losses are already locally committed

Four primary losses have no surviving inspected action in any of the final four frames. One is a bomb
death; three are projectile-or-collision deaths. These do not prove that the whole match was unavoidable.
They require a wider predecessor window or the reverse death-chain oracle to find the first commitment
frame. They must not be used as evidence for relaxing Hard or Risk.

## Proposed structural repair order

No production behavior should be changed until this repair proposal is reviewed.

1. Add defect UTs before implementation:
   - freeze the meaning of `PROVEN_SAFE`: if safety is strategy-existential, a committed hostile
     projectile with only one later escape may be safe only when the complete response obligation or
     witness is emitted; without that witness it must remain `POSSIBLE_DEATH` or `UNKNOWN`;
   - a committed projectile with no future escape must remain Hard-rejected;
   - adjacent visible-tank collision and same-frame movement collision must contribute Safety mass;
   - `PROVEN_SAFE` must agree with an exhaustive 1-4 frame physical oracle across every supported
     enemy/chance branch;
   - the strict one-step contradiction becomes a permanent defect fixture; the other thirteen remain
     continuation-obligation diagnostic fixtures until an exhaustive oracle classifies them.
2. Add a `CommittedHazardObligation` output shared by HazardKernel, SafetyOutcomeSlab, and plan
   continuation. It should expose earliest required response, legal response set, deadline, coverage,
   and escape slack without allocating objects in the hot path.
3. Keep quantifiers separated:
   - committed projectile/bomb facts use PhysicalState and can affect Hard;
   - visible future enemy actions and collisions affect Safety/Risk;
   - hidden/possible FIRE remains InformationState and cannot become Hard.
4. Carry an accepted evasive obligation across callbacks until discharge or physical invalidation.
   Recomputing one action as existentially viable each frame is insufficient for
   `low-risk -> low-risk -> fatal` chains.
5. Re-run only the fixed 64-loss lane first. Acceptance requires zero one-step `PROVEN_SAFE`
   contradictions, zero event-exact replay failures, zero control survival regressions, and no new Hard
   invariant failure. Multi-frame `PROVEN_SAFE`/fixed-continuation mismatches are tracked as a regression
   metric, not asserted as proof failures. Then run Minimax/Safety UTs, the 160-entry focused cohort, a
   small arena, and only after those pass the full dynamic arena.

The repair must not change leading protection, stun semantics, global risk parameters, or combat
pressure in the same change. Those dimensions need separate cohorts so a Safety fix cannot be hidden
by tactical retuning.
