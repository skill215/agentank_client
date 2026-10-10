# V2 组件因果验证与原生回迁计划（CTR0–CTR8）

状态：`EXECUTED / CTR0–CTR6 ACCEPTED / CTR7–CTR8 BLOCKED`

执行结果见
[V2组件因果验证 CTR0–CTR8](../implementation/v2-component-transplant-ctr0-ctr8.md)。
当前没有组件达到行为或性能正向门，因此没有生成 `V2_REPAIRED`；新盲测池还差21个场景，
Final Holdout未读取。

## 1. 基准定义

V3 是冻结 V1 的模块化实验宿主，不是新的 Tank，也不是 V2：

```text
V3_BASE = 冻结 V1 行为 + 可替换接口
V3_X    = V3_BASE + 仅一个 ACTIVE 的 V2 组件 X
V2_BASE = 当前真实 V2 ProductionRoot
V2_X    = 把已通过验证的 X 原生回迁到 V2_BASE
```

因此：

- `V3_BASE vs V1 = 50%` 只证明模块化没有改变 V1；
- `Native V3 vs V1 = 50%` 只证明去 VM 后仍等价；
- 两者都不能被解释为 V2 恢复；
- V3 不能进入 V2 production bundle、Candidate、simulate 或 publish；
- V2 的改善只能由 `V3_X vs V3_BASE` 的组件因果证据，以及
  `V2_X vs V3_BASE` 的原生回迁证据共同证明。

上一轮 Final Recovery 中 `NATIVE_REPAIRED` 实际是 V3/V1-compatible controller，
不是 repaired V2。其 50% 结论撤销为“基准等价通过”。

## 2. 目标

本计划回答两个不同问题：

1. V2 的某个组件是否比 V1 对应模块更强或更快？
2. 该组件回迁到真实 V2 后，是否仍然提升 V2，而没有被其他所有权层抵消？

组件只有两种可以进入候选集的正面结论：

```text
BEHAVIOR_POSITIVE:
  动作发生变化，并在独立配对对战中显著优于 V3_BASE

PERFORMANCE_POSITIVE:
  动作逐帧等价，但函数、root 或整局 P95 明显更低
```

规则正确但没有改变动作或性能的组件标记为 `CORRECT_NEUTRAL`；不能因为“理论更完整”
就回迁 V2。负向组件保留诊断代码，默认关闭。

## 3. 正确的三段因果链

### 3.1 组件隔离

```text
V3_BASE ───────┐
               ├─ 同地图、同星序列、双换位 → 组件独立效果
V3_BASE + X ───┘
```

除 X 以外的所有决策都执行原版 V3/V1。X 必须替换一个明确端口，禁止同时改变 Risk、
搜索深度、战略参数、fallback 或其他组件。

### 3.2 接口等价

把 X 回迁到真实 V2 前，使用相同 `DecisionRootSuite` 输入验证：

```text
V3_X 的 X 输出 == V2_X 原生实现的 X 输出
```

比较内容不只是最终 action，还包括：

- support status；
- Hard/Proof/Risk 维度；
- proposal class；
- candidate membership；
- selected row 与 argument；
- work units、cache key 和 incomplete reason。

接口不等价时禁止进入整局 V2 对战。

### 3.3 原生 V2 收益

```text
V2_PREVIOUS vs V3_BASE
V2_PLUS_X   vs V3_BASE
```

两组必须使用同一冻结场景、同一技能、同一星序列和双换位。以逐场景转换判断 X 是否真正缩小
V2 与 V1 的差距。不能用 V3_X 的成绩代替 V2_X 的成绩。

## 4. 数据隔离

### 已暴露集合

以下数据只用于开发、bug fixture 和回归，不再作为盲测：

- 原 VC0 64 场景；
- V3R Discovery、Tactical/EO/Combat/Strategy/Plan Holdout；
- 已读取的 256 场景 Final Recovery；
- 所有已有逐帧分歧根。

### 新盲测

执行前重新扫描动态历史池，只选择从未进入上述集合的场景。先生成 inventory，再根据可用分母
冻结：

- `COMPONENT_DISCOVERY`：使用已暴露集合，不消耗新盲测；
- `SAFETY_HOLDOUT`：至少 48 场景；
- `TACTICAL_HOLDOUT`：至少 64 场景；
- `COMBAT_HOLDOUT`：至少 64 场景；
- `STRATEGY_HOLDOUT`：至少 64 场景；
- `V2_FINAL_HOLDOUT`：至少 128 场景。

如果新场景不足，阶段标记 `BLOCKED`，不得复用别的组件 Holdout 或缩小 Final Holdout。
每个 Holdout 只允许对应冻结候选读取一次。

## 5. 统一实验合同

每个组件支持：

```text
PASS_THROUGH  执行原 V3/V1 模块
SHADOW        运行 V2 组件，只记录输出
ACTIVE        V2 组件拥有该明确端口；INCOMPLETE 回退原 V3
```

所有 ACTIVE 组件必须记录：

- invocation / complete / incomplete；
- proposed / accepted / selected；
- 第一动作分歧；
- `LOSS→WIN`、`WIN→LOSS`、DRAW 转换；
- 星、击毁、FIRE、命中、反杀；
- function/root/match work units 和 P50/P95；
- Hard、Proof、restore、invalid action、timeout/error。

`ACTION.NONE` 仍默认等于 `NO_PROPOSAL`。ProposalBus 只是实验仲裁基础设施，不自动算作
V2 的正面组件。

## 6. 串行阶段

### CTR0：撤销错误基准并冻结真实三方身份

冻结：

- `V3_BASE`：模块化冻结 V1；
- `V2_BASE`：真实 V2 ProductionRoot 精确源码；
- `V1_ORACLE`：仅用于验证 V3_BASE 等价；
- 已暴露场景集合和新盲测 inventory。

验收：

- V3_BASE 与 V1_ORACLE 逐帧等价；
- 报告不得把 V3_BASE、Native V3 或 V1-compatible controller 标为 V2；
- runner 的 implementation id、seat label、报告字段和代码 hash 均能区分 V3 与 V2；
- 旧 `NATIVE_REPAIRED 50%` 改记为 `V3_NATIVE_BASELINE_EQUIVALENCE`。

CTR0 失败则停止。

### CTR1：事实层与性能组件

测试 V2：

- ProductionObservationAdapter；
- ProjectileTrackPool；
- PossibleProjectileTracker；
- pending FIRE/BOMB；
- 地图、路径和hazard cache。

先 SHADOW 验证规则事实，再测试性能。事实组件不得拥有 action。

进入回迁候选的条件：

- simulator ground truth 零丢弹、零幽灵、零假 exact；
- V3 动作差异为 0；
- 热分配为 0；
- function P95 或整 root P95 至少改善 5%，否则为 `CORRECT_NEUTRAL`；
- 内存和代码体积必须同时报告。

### CTR2：Physical Hard 与 committed rescue

分开测试：

1. `HardGate + FinalActionGate`；
2. `DeadlineKernel`；
3. final-only `EscapeObligation`。

正确结构：

```text
先让 V3_BASE 得到 preferred action
→ V2 Hard/EO 只检查这个最终动作
→ 仅在“preferred 已证明死亡、替代动作已证明可活”时覆盖
```

安全组件验收：

- exhaustive fixture false positive=0；
- `SURVIVE→DIE=0`；
- `DIE→SURVIVE>0` 才可取得 rescue 所有权；
- 若只有规则正确但整局无转换，则作为 safety guard 回迁需另做 V2 非退化证明；
- possible/future/UNKNOWN 不得触发 committed rescue。

### CTR3：Tactical/Search 子组件

禁止再次把整个 TacticalCore 一次性 ACTIVE。依次测试：

1. Physical DepthSearch；
2. InformationSearch；
3. InformationSafety/MultiFrame；
4. RiskAcceptanceController；
5. StageMatrix；
6. ForcedWin。

每个 X 都形成：

```text
V3_BASE + X
```

其余 V3 战术逻辑不变。搜索组件只有在完整支持并产生以下证据之一时才能覆盖：

- strict ForcedWin；
- exact value dominance；
- V3 action 被完整搜索证明失败且替代动作被证明非失败。

普通 robustLower、expected value、Information complete 或搜索深度完成都不能直接拥有动作。

行为组件进入 Holdout 的门：

- Discovery 至少 +3pp；
- 星差不下降；
- `LOSS→WIN > WIN→LOSS`；
- 任一换位 variant 下降不超过 2pp；
- 所有硬不变量为 0。

Holdout 仍要求 +3pp 且场景级配对随机化 `p<0.05`。

### CTR4：Combat/PAC

分别测试：

- direct kill；
- aim setup；
- intercept；
- escape denial；
- projectile attack closure；
- survivor frontier。

不允许把整个 CombatPressure 作为一个不可分包。每个攻击模块只替换 V3 的对应攻击提案端口，
导航、逃生和最终门仍由 V3_BASE 执行。

核心漏斗：

```text
evaluated → qualified → proposed → selected → emitted
→ hit → kill → counter-killed
```

进入回迁候选必须同时满足：

- Holdout +3pp、`p<0.05`；
- 单方击毁净增加；
- 每100次FIRE击毁转换不下降；
- counter-killed 不增加；
- 无目的 FIRE 不增加。

上一轮完整 Combat 为负向，不能直接复用；必须从最小攻击目的重新开始。

### CTR5：Strategy 与 Plan

顺序固定：

1. 目标生成；
2. 战略仲裁；
3. PlanSketch；
4. PersistentPlan；
5. PVA。

首先只替换 V3 非接触导航中的一个明确选择点。没有非空 purpose、target、deadline 和正 progress
时必须回退 V3_BASE，不能输出 NONE。

Plan/PVA 只有在目标生成器先通过后才能测试。PVA 只能接受或拒绝已有 proposal，不能创建目标。

行为门与 CTR3 相同，并额外要求：

- 非接触 Minimax/StageMatrix 调用为 0；
- FIRE 和击毁转换不下降；
- 无目标等待为 0；
- Plan 启动、延续、完成、失效对账。

### CTR6：V3_COMPONENT_BEST

只累积独立通过的组件：

```text
V3_BASE
→ + FACT/PERFORMANCE positive
→ + SAFETY positive
→ + TACTICAL positive
→ + COMBAT positive
→ + STRATEGY/PLAN positive
```

每加入一个组件，都运行：

```text
V3_BEST_PREVIOUS vs V3_BEST_PLUS_X
```

组合净转换为负或出现所有权冲突就撤回 X；不能通过调阈值强行保留。

CTR6 的结果只说明“哪些 V2 组件在 V1 控制结构中有效”，仍不是 V2 最终成绩。

### CTR7：逐组件回迁真实 V2

从冻结 `V2_BASE` 开始，不加载 V1/V3 代码：

```text
V2_0 = V2_BASE
V2_1 = V2_0 + 第一个已通过组件
V2_2 = V2_1 + 第二个已通过组件
...
```

每步必须完成：

1. DecisionRootSuite 上与对应 V3 组件输出一致；
2. V2_PREVIOUS 与 V2_PLUS_X 的动作差异可解释；
3. 两者分别对战 V3_BASE；
4. V2_PLUS_X 的配对净转换为正；
5. 同输入 function/root/match P95 不退化超过 5%；
6. source/minified、内存、缓存和热分配重新测量。

组件在 V3 中正向、回迁 V2 后负向，标记 `INTEGRATION_CONFLICT` 并撤回，不修改 V3 结论。

### CTR8：真实 V2 最终恢复

冻结原生 V2 代码、配置和组件清单后，才读取 `V2_FINAL_HOLDOUT`。同时运行：

```text
V2_BASE     vs V3_BASE
V2_REPAIRED vs V3_BASE
```

最终验收：

- V2_REPAIRED 分析得分至少 50%；
- 相对 V2_BASE 提升至少 10pp；
- `LOSS→WIN > WIN→LOSS`；
- 单方击毁净结果改善；
- runtime 结果不计胜；
- avoidable Hard、Proof false positive、restore failure、invalid action、timeout/error 全为 0；
- 匹配输入 P95 不超过 V1/V3_BASE 的 110%；
- 非接触搜索节点为 0；
- V2 bundle 不包含 V1/V3 源码、VM、factory 或 pass-through controller。

未达到 50% 就保留组件证据并标记 `REJECTED`，不把 V3_BASE 当作 V2 候选，不追加阈值补丁，
不重复读取 Final Holdout。

## 7. 当前证据的正确解释

| 已有证据 | 正确结论 | 下一步 |
|---|---|---|
| V3_BASE vs V1 = 50% | V3 是合格实验宿主 | 保留 |
| Native V3 vs V1 = 50% | 去 VM 后仍等价 | 仅作工具/性能参考 |
| VC1 Observation Shadow | 事实层未改变 V1 动作 | 进入 CTR1 性能验证 |
| VC2 Physical Hard | 小样本行为中性 | 进入 CTR2 安全非退化验证 |
| VC3 EO = 38.67% | 早期 EO 所有权错误 | 禁止直接回迁 |
| VC5 Combat = 51.04%, p=.877 | 没有显著收益 | 拆分攻击目的重测 |
| VC6 TacticalCore = 6.25% | 整体 TacticalCore 所有权严重错误 | 必须逐子组件测试 |
| VC7 Strategy = 35.94% | 目标/NONE 合同错误 | 从目标生成开始重建 |
| V3R8 “repaired 50%” | 不是 V2 恢复证据 | 结论撤销 |

## 8. 停止边界

本计划通过评审前：

- 不继续修改 production 行为；
- 不运行新的组件 Holdout 或 Final Holdout；
- 不把 Native V3 打包成 V2；
- 不执行官方 simulate、publish 或 challenge；
- 不删除旧数据，只修正其语义标签。
