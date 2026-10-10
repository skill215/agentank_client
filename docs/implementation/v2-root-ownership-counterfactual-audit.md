# V2 root ownership counterfactual audit

Status: local diagnostic evidence only. Production defaults are unchanged. No
official simulate, publish, or challenge was performed.

## What was tested

The exact-replay labeler replays the full prefix, matches the V2 physical hash,
forces one Hard-allowed root action, and then resumes the same V2/V3 controllers.
The selected action reproduced the original terminal result in every captured
root.

Two early-horizon batches contain 8 historical scenarios, both seat swaps,
16 matches, 114 roots and 510+ action continuations. The reusable report is:

```bash
node tools/agentank/diagnostics/root-counterfactual-causal-report.js \
  --inputs <early-batch-a.json>,<early-batch-b.json> \
  --output <causal-report.json>
```

The combined report fingerprint is
`52d6ffcffd606780e2d2d7772a88e1221709a7b4c4c22f310c7802f961f16896`.
It contains 14 recoverable roots in 9 matches. Ten recoveries are score
inversions: the action that wins the continuation currently has a lower
`expectedValue` than the selected losing action.

| Root frame | Roots | CURRENT score | Per-root oracle ceiling | Recoverable |
|---:|---:|---:|---:|---:|
| 0 | 16 | 31.25% | 50.00% | 3 |
| 16 | 16 | 31.25% | 50.00% | 3 |
| 32 | 15 | 33.33% | 46.67% | 2 |
| 48 | 14 | 35.71% | 42.86% | 1 |
| 64 | 14 | 35.71% | 35.71% | 0 |
| 80 | 14 | 35.71% | 50.00% | 2 |
| 96 | 13 | 30.77% | 46.15% | 3 |
| 112 | 12 | 25.00% | 25.00% | 0 |

The earliest recoveries use nine different transitions: navigation to FIRE,
navigation to BOMB, FIRE to navigation, poison to navigation, poison to FIRE,
and navigation-to-navigation. This is not a single action-priority defect.

## Rejected local models

| Diagnostic | Evidence | Decision |
|---|---|---|
| Existing score/risk/purpose linear ranker | Holdout 31.75% -> 26.98% | reject |
| Add projected topology, four-frame action history and Plan deadline | Training 25.00% -> 31.25%; Holdout 31.75% -> 25.40% | reject as overfit |
| Max expected/robust/tactical selector | two sampled losses recovered and two sampled wins destroyed | net zero, reject |
| Persistent navigation Plan owns selection | 28.13% -> 15.63% | reject |
| Persistent navigation continuity only | 28.13% -> 18.75% | reject |
| Information expected-value owner | 28.13% -> 25.00%, positive 4 / negative 5 | reject |
| Long-range poison loses ownership without contact evidence | 28.13% -> 10.94%, positive 3 / negative 8 | reject |
| V1-style direct attack-arrival owner | 28.13% -> 25.00%, positive 0 / negative 1 | reject |
| Objective-first star GO/TURN selector | zero action differences in every comparable labelled root | already represented |

The poison ablation is particularly informative. Every first divergence was a
frame-0 poison action at distance 24. Removing it recovered three matches but
destroyed eight wins. Both tanks were tied on current star-path distance in all
11 outcome transitions. Future star sequence and later interaction, not the
local contact threshold, determine the value of the global four-frame cadence
denial.

The direct-arrival owner proposed four times and overrode once. The sole
override replaced a winning frame-19 BOMB with TURN_RIGHT and lost the match.
Arrival-frame advantage did not represent the bomb's zone-denial continuation.

## Positive finding

The PersistentPlan lifecycle can maintain a stable navigation identity without
changing ownership. In two independent 32-match batches the lifecycle-only
profile produced zero action/frame/argument differences. Total local runtime
was 3.11% and 4.22% lower, although P95 did not improve consistently. It remains
default-off until a larger performance-only qualification; it is not gameplay
evidence.

## Stateful option / intent POC

The next experiment implemented a diagnostic-only `StatefulOptionRollout`.
For every Hard-allowed row it uses the real FastKernel and apply/undo to build
a deterministic four-frame sequence.  Each exact replay branch can then keep
that sequence for four real simulator frames; every emitted step still passes
the production FinalActionGate and aborts to the normal controller when the
planned action is unavailable or physically rejected.

The initial first-action-only experiment was strongly negative.  On the first
four scenarios the balanced selector changed 40/58 roots, improved none and
regressed seven.  That experiment was methodologically insufficient because
the hypothetical rollout assumed a continuation which the exact branch did not
execute.

After exact sequence execution the plan wiring itself was reliable:

- first four scenarios: 254/258 option branches satisfied their complete
  sequence, 995/999 requested steps were emitted, root restore failures were 0;
- independent next four scenarios: the same root restoration invariant held;
- unavailable continuation actions were safely returned to the production
  FinalActionGate rather than forced.

Gameplay evidence still rejected the owner:

| Batch | Roots | CURRENT exact units | Balanced/Combat option | Primitive-Risk verified option | Trajectory-value option |
|---|---:|---:|---:|---:|---:|
| first four scenarios | 58 | 32 | 24 (`-8`) | 32 (`0`) | 36 (`+4`) |
| independent next four | 56 | 42 | 22 (`-20`) | 40 (`-2`) | 36 (`-6`) |
| combined | 114 | 74 | 46 (`-28`) | 72 (`-2`) | 72 (`-2`) |

`Trajectory-value option` was preregistered after the first batch as: physical
rollout complete, exact root restoration, no committed Hard fatal, and both
`expectedValue` and `robustLower` strictly above CURRENT.  It deliberately did
not reuse primitive `acceptable/dominated`, because the first batch contained
two winning trajectories which primitive Risk had already removed.  The
independent batch nevertheless produced three regressions and no improvements.

The failure is not a missing fixed action.  The same frame-0
`FIRE -> TURN_RIGHT -> GO -> GO` sequence at distance 24 and equal current star
distance won one continuation and lost other seat/map/star-sequence
continuations.  Four nominal frames cannot represent the long-horizon target,
future star stream and opponent response which decide those games.  Conversely,
primitive Risk rejected several independent-batch trajectories that the local
option value preferred and which the exact continuation proved losing.  Risk
cannot simply be bypassed; it eventually has to evaluate an option-level
response set rather than only its first primitive action.

The reusable diagnostic files are:

- `tools/agentank/diagnostics/stateful-option-rollout.js`;
- `tools/agentank/diagnostics/stateful-option-causal-report.js`;
- `test/diagnostics/stateful-option-rollout.test.js`;
- `test/diagnostics/stateful-option-causal-report.test.js`.

This POC remains diagnostic-only and production defaults are unchanged.

## Architecture conclusion

V2 already chooses the same immediate GO/TURN as an objective-first star
selector. Its defect is the value and continuity of a sequence that combines
resource timing, attack setup, zone denial and navigation. Action-local
Strategy, Risk, Minimax and Plan fields cannot infer that value from one root.

The root-local controller was correctly tested as a complete stateful option,
but a fixed four-frame nominal option was still not enough.  The next native V2
controller must move the ownership boundary above both primitive Strategy and
primitive Risk:

```text
long-horizon objective/intent with context epoch and event deadline
-> response-aware option alternatives, not one nominal enemy trajectory
-> V2 Physical Hard and committed rescue on every emitted action
-> strict Proof override
-> option-level Risk/terminal interval
-> Information/Minimax only as bounded evidence inside tactical contact
-> replan on observation/event; preserve the objective, not a fixed action list
```

The V1-style control order remains the only demonstrated 50% behavioral
baseline.  It should be reimplemented as modular native V2 control ports over
V2 FastState (fact/tracking and physical Hard retained), while current soft
Strategy/Risk/Search modules run as evidence services until an individual port
has paired positive proof.  This is not permission to package V3/V1 code into
V2; it is a change in native V2 ownership.  No additional FIRE bonus, distance
cutoff, poison rule, primitive-risk bypass or weighted root selector is
supported by the evidence.
# Strict committed rescue causal result

The ordered-port architecture first narrowed committed ownership at the final
action boundary. `entity exists` remained evidence only. A rescue was emitted
only when complete ReverseViability proved the V1 final action dead and another
Hard-allowed action viable.

Across the fixed 128-match VC0 cohort, the initial unmodified trajectories
produced five strict rescue opportunities. Discovery converted one loss into a
win. Holdout had no W/L/D transitions, but three single-crash losses became
non-crash frame-limit losses. There were no negative outcome transitions and no
`SURVIVE→DIE` cases. The component is accepted into the V3 experimental BEST
as a safety component; it remains disabled in V2 production pending native
integration and performance work.

# Native physical-prefix ownership shadow

在 stateful option POC 被拒绝后，新增了不改变动作的逐帧所有权追踪器与原生 V2
physical-prefix shadow。固定 Discovery 32 局得到 1,804 个根：V1 阶段归属完整，
`UNATTRIBUTED=0`；V2 shadow 为每根运行 Hard 与 committed EO，但不运行搜索，
`root restore failure=0`。

关键反例表明三分 `COMMITTED_ESCAPE / TACTICAL_CONTACT / STRATEGIC_NAVIGATION`
不能作为互斥所有者：25/35 个 BombSafety、4/4 个 ProjectileEscape 以及58/62个
Stability 动作都出现在被三分路由标记为 `TACTICAL_CONTACT` 的根。Navigation 的404帧
则全部落在 `STRATEGIC_NAVIGATION`，说明 contact/navigation 判断可作为端口证据，但不能
抢先封闭更高优先级端口。

原生基线因此改成可重叠端口位集。1,804 根中 1,380 根同时有多个端口有效；最终结构应为
“多提案 + 有序仲裁”，而非“单模式 + 模式内总评分”。另外，1,598 帧的信息支持不完整仍有
可用 PhysicalState；Information 完整度不得作为物理前缀总开关。

当前仅完成影子接线。committed entity evidence 有279帧，而 V1 实际安全接管仅43帧；
下一阶段必须用 deadline、successor viability 与 V1 preferred 是否死亡收窄为真正的
`COMMITTED_RESCUE`，不能把实体存在直接升级为动作所有权。
