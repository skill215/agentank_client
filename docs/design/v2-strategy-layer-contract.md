# V2 战略层重构合同（STRAT2）

状态：**ACCEPTED / STRAT2-D0–D3 IMPLEMENTED / D4 NOT QUALIFIED**，
2026-07-23。`DEC-0095` 已接受本文对 `DEC-0060` 的修订；当前实现仍需
Discovery、独立 Holdout、全量 arena、相对性能和代码体积门，不能据此授权发布。

关联：

- [strategy-selector-contract.md](strategy-selector-contract.md)
- [evaluation-contract.md](evaluation-contract.md)
- [risk-backup-contract.md](risk-backup-contract.md)
- [matrix-policy-contract.md](matrix-policy-contract.md)
- [plan-contract.md](plan-contract.md)
- [design-authority.md](design-authority.md)

## 1. 结论

V2 应使用战略分层，但不能为每种战略分别运行一套 Minimax，也不能把
“击杀、抢星、位置、风险”先加权成一个总分再选动作。

目标结构固定为：

```text
同一个 Fast/Information/Minimax 内核
  + 一个根级 StrategySelector
  + 一组静态 StrategyDescriptor
  + 每动作一个离散 StrategyBand
  + 已有 Risk / EO / Pareto / robust floor / StageMatrix
```

战略负责：

- 当前优先追求哪类可验证目的；
- 哪些动作是 `PRIMARY / SUPPORT / FALLBACK`；
- 动作展开顺序、Plan 目的和有限的搜索工作优先级；
- 跨 root 的策略持续、事件驱动切换和稳定性。

战略不负责：

- 平台物理、Hard、Terminal 或严格 Proof；
- 把 possible projectile、隐藏敌人或 future FIRE 升级成 committed；
- 绕过 RiskAcceptanceController 或 EscapeObligation；
- 修改 Minimax 的最终胜负语义；
- 为每种战略重新复制地图、路径、弹道或搜索树；
- 局内在线修改我方参数表。

初始默认战略从 `STAR_CONTROL` 改为 `KILL_PRESSURE`。抢星不再是所有
strategy 都能获得的全局动作奖励；它只在 `STAR_CONTROL`、终局必须抢星，
或其他战略没有合格主/辅动作时进入相应 band。

## 2. 为什么现有 DD7 不够

DD7 的原则“StrategySelector 每个真实 root 运行一次、节点只读 profile”是
正确的，应保留。问题在于当前合同和实现把战略主要实现为：

```text
选择一个 EvalProfile / RiskProfile
→ 多个 feature 相加
→ 再与路径、攻击、风险和搜索分相加
→ 选最大总分
```

这会产生四个结构问题：

1. **目标没有动作所有权。** 当前 strategy 变化后，通用 GO/TURN 仍可获得
   抢星路径加分，`KILL_PRESSURE` 不能真正禁止“用抢星替代可验证攻击”。
2. **评价和战略混义。** 不同 EvalProfile 会改变 horizon value，战略切换
   同时改变“我们认为局面值多少”和“我们希望先做什么”。
3. **风险与战略循环。** strategy 选择 RiskProfile，而 Risk 又改变动作集合；
   很难区分动作被排除是安全要求还是目标偏好。
4. **局部补分会污染全局。** FIRE bonus、STAR bonus、GO bonus 都能绕过
   原本的目的边界，修一个失败样本时容易破坏另一类场景。

STRAT2 将“目标资格”从连续分数中拆出来，先形成离散 band，再在 band 内用
现有 Minimax 和多维风险结果选动作。

## 3. 外部项目和理论依据

### 3.1 可借鉴项目

| 来源 | 可借鉴结构 | 不可直接复制 |
|---|---|---|
| [MicroRTS](https://github.com/Farama-Foundation/MicroRTS) `PuppetSearchAB` / `ConfigurableScript` | 脚本暴露少量 choice point；搜索决定高层选择；standing Plan 跨帧保存；迭代加深、TT、transition cache | Java 对象、`GameState.clone()`、float、`Stack`/`ArrayList`、每个联合动作构造对象；其 simultaneous serialization 不能作为 AgentTank 平台规则 |
| [UAlbertaBot](https://github.com/davechurchill/ualbertabot) `HLSearch` | 高层 `HLMove`、双方联合高层动作、时间跨度搜索、TT 和 transition cache | StarCraft 高层状态可跳过数千帧；AgentTank 的 committed bullet/bomb 不能被时间抽象跳过 |
| [Puppet Search](https://skatgame.net/mburo/ps/aiide15-puppet.pdf) | 用脚本 choice points 压缩动作空间，并让 look-ahead 决定，而不是用静态规则猜最终效果 | 论文示例不是不完全信息、严格 Hard、整数 risk 和关键节点矩阵的现成实现 |
| [Hierarchical Adversarial Search](https://ojs.aaai.org/index.php/AIIDE/article/view/12714) | 战略、计划执行和战术搜索分层；不同层使用不同抽象 | 不能把层级理解成多套相互矛盾的胜负函数 |
| [Combining Strategic Learning and Tactical Search](https://arxiv.org/abs/1709.03480) | 高层先选择有限 abstract action，剩余预算用于低层战术搜索 | 本项目不引入 CNN/训练推理，也不使用学习结果替代 Hard/Proof |

### 3.2 采用的理论边界

- Puppet Search 支持“战略暴露动作选择点，look-ahead 在缩小后的空间中
  决定动作”。
- 分层对抗搜索支持“战略与战术使用不同抽象，但共享最终游戏目标”。
- lexicographic reachability/safety game 支持“先满足高优先级安全/可达目标，
  再在剩余动作中优化次要目标”的顺序，而不是把所有维度提前相加。
- Options 的 initiation / policy / termination 可用于描述跨 root 的战略与 Plan，
  但 Options 是单智能体时间抽象，不能替代本项目的同时行动和 InformationState
  量词。

本文没有发现同时满足以下条件的可直接移植实现：

```text
JavaScript
+ simultaneous action
+ partial information
+ committed Hard / strict Proof
+ multi-dimensional robust risk
+ root StageMatrix
+ fixed TypedArray / zero hot allocation
+ 单线程平台预算
```

因此只继承架构思想，不复制算法代码或数据布局。

## 4. 权威和修订范围

本文只修订 DD7 的以下部分：

- StrategySelector 的输出含义；
- primary strategy 的动作所有权；
- strategy 与 Evaluation/Risk/SearchProfile 的边界；
- strategy 的切换与 PersistentPlan 关系；
- strategy 性能和缓存合同。

以下权威保持不变：

```text
DD1  Action / Frame / Terminal
DD2  State / Observation / ABI
DD5  Fast / Hazard / ReverseViability
DD6  InformationState / Proof / robust Risk / StageMatrix
DD8  Runtime / fallback / production build
DD10 corpus / platform operations / artifact lineage
```

`DEC-0060` 中“root 选择、node 不重选、动态切换、表整局固定”的原则保留。
评审接受 STRAT2 时，应新增决策并明确修订 `DEC-0060` 的“profile bundle”
含义；不能静默覆盖旧合同。

## 5. 四层目标顺序

战略层不是最高层。正式动作选择顺序为：

```text
L0  规则与证明
    Hard → strict ForcedWin/Nonloss/Loss → Terminal

L1  风险与已提交生存
    Risk acceptable set → committed EscapeObligation intersection

L2  对抗安全下界
    Pareto → 最大 robustLower safe floor

L3  战略目的
    StrategyBand(PRIMARY → SUPPORT → FALLBACK)

L4  同时行动与战术选择
    StageMatrix → expected/tactical → stable row
```

约束：

- L3 永远不能恢复被 L0 删除的动作。
- L3 永远不能放宽 L1 的 Risk 阈值。
- L3 永远不能降低 L2 已形成的 robust safe floor。
- L3 只在 L2 的结果上选择最低编号的非空 band。
- L1 因 incomplete 返回未知时，L3 不能把未知改写为安全。
- `NO_ACCEPTABLE_ACTION` 仍由 Risk/Hard 的最小风险 fallback 处理，战略只能
  在相同风险键内作最后 tie-break。

STRAT2 v1 固定 `allowedStrategicRobustLoss = 0`。如果攻击动作进不了 safe
floor，应修正 canonical evaluator、搜索区间、攻击 purpose 或事实覆盖，不能
让战略层牺牲已计算出的我方 robust lower 来强行提高 FIRE。

## 6. 战略集合和稳定 ABI

保留五个整数 ID，避免立即扩大 production ABI：

| ID | STRAT2 名称 | 旧名称兼容 | 核心目的 |
|---:|---|---|---|
| 0 | `STAR_CONTROL` | 不变 | 收集、拒绝、终局星数逆转 |
| 1 | `KILL_PRESSURE` | 不变；新默认 | 直接击杀、优势开火、盾破和限制逃生 |
| 2 | `ATTACK_SETUP` | 旧 `POSITION_CONTROL` 的 ID | 建立射线、截击、压缩逃生、接近攻击 |
| 3 | `PRESERVE_LEAD` | 不变 | 保持已可锁定的非输结果，同时允许安全反击 |
| 4 | `COMEBACK` | 不变 | 比较击杀逆转和星数逆转的最早 deadline |

不能只改 ID 2 的显示名称。构建 manifest 必须增加：

```text
STRATEGY_TABLE_VERSION = 2
STRATEGY_ABI_VERSION
strategyDescriptorFingerprint
defaultStrategyId = KILL_PRESSURE
```

旧 Candidate 继续绑定 version 1，不得被重新解释。

## 7. StrategyDescriptor

每个战略是构建期生成的静态整数描述符，不是 class 或闭包：

```text
StrategyDescriptorTable (TypedArray SoA)
  primaryPurposeMask[strategy]
  supportPurposeMask[strategy]
  fallbackPurposeMask[strategy]
  requiredCapabilityMask[strategy]
  forbiddenRootModeMask[strategy]
  minimumDwellRoots[strategy]
  switchMargin[strategy][strategy]
  orderingProfileId[strategy]
  searchHintId[strategy]
  fallbackStrategyId[strategy]
  reasonMask[strategy]
```

动作目的使用 bitset：

```text
DIRECT_KILL
ADVANTAGEOUS_FIRE
AIM_SETUP
INTERCEPT
ESCAPE_DENIAL
SHIELD_BREAK
ZONE_DENIAL
BELIEF_SWEEP
ATTACK_APPROACH
STAR_COLLECT
STAR_DENY
PRESERVE_NONLOSS
TERMINAL_REVERSAL
PLAN_CONTINUATION
NEUTRAL_POSITION
```

表中不保存函数、对象、字符串或浮点数。production 名称在构建时剥离。

## 8. StrategyEvidenceFrame

Selector 和 band 分类只消费一次性根证据：

```text
StrategyEvidenceFrame
  root:
    phase
    starDelta
    remainingOutcomeChangeCapacity
    terminalStarDeadline
    terminalKillDeadline
    currentStrategyId / generation / dwell
    ownCapabilityMask / enemyCapabilityMask
    informationCompleteness
    activePlanPurpose / deadline / continuationStatus
    opponentModelConfidence

  per action row:
    hardStatus
    riskStatus
    committedEscapeMember
    purposeMask
    purposeCompleteness
    hitDeadline
    enemySafeSuccessors
    ownCounterExposure
    postFireEscape
    blockadeValue
    starCollectDeadline
    starDenyDeadline
    planContinuation
```

数据来源必须复用：

- `CombatVectorSlab`；
- `SafetyOutcomeSlab` / `ActionOutcomeSlab`；
- `EscapeObligation` / `DeadlineKernel`；
- Path/Star deadline；
- `PlanSketch` / `PersistentPlan`；
- `OpponentModel` 的整数 nominal/confidence。

禁止为 Strategy 再计算一遍 ray、path、projectile、bomb、hidden world 或
Minimax transition。

## 9. StrategyBand

每动作只增加一个 `Uint8Array` band：

```text
INELIGIBLE = 0
PRIMARY    = 1
SUPPORT    = 2
FALLBACK   = 3
```

`MANDATORY` 不属于战略。ForcedWin 和 committed 唯一逃生继续由上层直接
约束，不能伪装成某个战略的 primary。

band 是集合资格，不是分数：

```text
eligibleRows =
  RiskAcceptable
  ∩ EscapeMembers
  ∩ NonDominated
  ∩ (robustLower >= globalSafeFloor)

for band in PRIMARY, SUPPORT, FALLBACK:
  selectedRows = eligibleRows ∩ rowsOf(activeStrategy, band)
  if selectedRows 非空:
    停止；后续只处理 selectedRows

若三个 band 均空:
  不放宽 Risk/Hard
  使用 activeStrategy.fallbackStrategy 重新分类一次
  仍空则对全部 eligibleRows 执行 neutral tie-break
```

不得把 `PRIMARY=+5000`、`SUPPORT=+2000` 写回 expected/tactical 分数。
不得为了得到非空攻击 band 把 safe floor 下调。

## 10. 五个战略的动作合同

### 10.1 KILL_PRESSURE（默认）

`PRIMARY`：

- 通过 Risk 的 strict ForcedWin action；
- `DIRECT_KILL`；
- 有完整射线/deadline 证据且开火后仍可逃的 `ADVANTAGEOUS_FIRE`；
- 能在对手最早反击前命中或显著减少安全后继的 `INTERCEPT`；
- 敌人当前不在枪线、但存在合法移动路径可在弹丸到达某个射线格前进入该格的
  **possible intercept**。它只能写软 `INTERCEPT/expected tactical`，最坏
  `robustPressure` 固定为 0，不得冒充 `DIRECT_KILL`、Hard 或 strict Proof；
- 对现有盾有明确资源交换目的的 `SHIELD_BREAK`。

`SUPPORT`：

- `AIM_SETUP`；
- `ESCAPE_DENIAL`；
- 有 deadline 的攻击接近或封锁；
- 能建立下一次攻击的技能动作；
- 同一攻击 PersistentPlan 的合法 continuation。

`FALLBACK`：

- 安全中性位置；
- 星星作为接近、诱导或拒绝对手资源的辅助目标；
- 没有攻击证据时的普通抢星。

禁止：

- 仅因为 action 是 FIRE 就进入 primary；
- 可见且当前射空，并且敌人在完整物理射线失效前也无法到达任何射线格的 FIRE；
- 无目的乱射；
- 用未来可能命中冒充 strict kill；possible intercept 只能让 FIRE 获得攻击
  资格，敌人是否会进入射线仍由 EnemyAction/Minimax 决定；
- 为提高开火率绕过 post-fire escape 和 Risk。

### 10.2 ATTACK_SETUP

`PRIMARY`：

- 建立可验证 firing lane；
- 使敌方安全后继减少；
- 进入截击点但不降低当前 Risk acceptable status；
- 建立 skill + FIRE/BOMB 的下一步窗口；
- 攻击 Plan continuation。

`SUPPORT`：

- `BELIEF_SWEEP`、草/隐身路径预射、zone denial；
- 星星位置同时改善攻击几何；
- 中性但高 mobility 的接近。

`FALLBACK`：

- STAR_CONTROL 候选；
- 普通安全位置。

`ATTACK_SETUP` 不等于“占中心”，也不允许把贴敌、朝向或 corridor 单个几何
特征升级为门禁。

### 10.3 STAR_CONTROL

`PRIMARY`：

- 收集能改变或锁定终局关系的星；
- 拒绝对手明确可收集的星；
- 星目标 deadline 早于可行击杀 deadline；
- terminal outcome capacity 证明星是当前最短可逆转路径。

`SUPPORT`：

- 安全取星；
- 以星诱导进入攻击线；
- 与攻击目的重合的移动或转向。

`FALLBACK`：

- ATTACK_SETUP；
- 安全中性位置。

抢星路径分、朝向分只能在本战略的 band 内使用，不能成为所有 strategy 的
全局 GO/TURN bonus。

### 10.4 PRESERVE_LEAD

`PRIMARY`：

- 保持 strict nonloss / outcome lock；
- committed 安全链；
- 不破坏锁定关系的直接反击；
- 拒绝对手唯一逆转资源。

`SUPPORT`：

- 保持 mobility 和逃生余量；
- 低反击暴露的攻击准备；
- 不改变 nonloss lower 的星控制。

`FALLBACK`：

- 中性安全动作。

禁止把 `PRESERVE_LEAD` 简化为永远不 FIRE；安全击杀和反击仍可 primary。

### 10.5 COMEBACK

COMEBACK 不预设“激进就是开火”或“落后就是抢星”。Selector 比较：

```text
earliest feasible kill reversal deadline
earliest feasible star reversal deadline
evidence completeness
remaining outcome-change capacity
```

较早且有完整支持的一类进入 `PRIMARY`，另一类进入 `SUPPORT`。两类都不完整时：

- 保留两类 support；
- 用 robust search 决定；
- 不把未知升级为 ForcedWin。

## 11. 根级选择和动态切换

### 11.1 Selector 不再用一个总和分决定战略

每个候选战略产生离散 `StrategyDecisionVector`：

```text
eligible
rootModeFit
terminalNecessity
verifiedOpportunity
objectiveDeadline
purposeCompleteness
planContinuity
reversibility
switchCost
stableStrategyId
```

按固定字典序比较，不能先加权成一个整数：

```text
eligible
→ terminalNecessity
→ verifiedOpportunity
→ earlier objectiveDeadline
→ purposeCompleteness
→ planContinuity
→ reversibility
→ lower switchCost
→ stableStrategyId
```

初始没有充分证据时：

```text
KILL_PRESSURE
→ 若没有攻击 primary/support，则 ATTACK_SETUP
→ 若只有星存在明确价值，则 STAR_CONTROL
```

### 11.2 立即切换事件

以下事件可以打断 dwell：

- strict ForcedWin/Nonloss/Loss 关系变化；
- committed hazard 或 EscapeObligation 创建/结束；
- 终局星数关系变成必须收集/拒绝；
- 新的完整 direct-kill / attack-deadline 证据；
- active Plan 被物理事实失效；
- 技能进入/离开唯一战术窗口；
- observation split 使旧战略资格不再对所有 indistinguishable worlds 成立。

普通 opponent propensity 浮动、一个 possible projectile 或一次未确认动作不能
立即切换。

### 11.3 InformationState 一致性

- 同一 observation partition 内所有 possible worlds 必须共享同一个 root
  strategy 和同一个第一动作 policy。
- strategy 不能读取我方当前不可观察的真实敌方 cell。
- world-dependent purpose 先按 hidden-world 量词聚合为
  `purposeCompleteness / robust evidence`，再进入 Selector。
- 只有 observation split 后才允许选择不同 strategy。

## 12. 与 Minimax 的关系

### 12.1 只运行一次搜索

```text
错误：
  Search(KILL) + Search(STAR) + Search(POSITION)

正确：
  Strategy 只提供 action order / band / plan purpose
  → 所有合法 root action 进入同一套 Fast/Information search
  → Risk/EO 后以 band 限定最终 rows
```

原因：

- V2 根动作通常只有有界小集合，为每个 strategy 重搜只会重复 transition；
- strict Hard、Information support 和 enemy columns 必须共享；
- 单搜索便于 root restore、cache-off 和 source/minified 一致性；
- 战略改变“先追求什么”，不改变 terminal win/loss 值。

### 12.2 统一搜索评价

目标态必须把现有五个 `EvalProfile` 拆成：

```text
CanonicalOutcomeEvaluator
  估计共同的 terminal / horizon game value
  不随 activeStrategy 改变

StrategyOrderingProfile
  只影响 action ordering、representative 优先级和完整搜索前的次序
  不收紧 sound bounds，不改变 terminal value

StrategyTacticalProfile
  只在同一 Risk、band、Pareto、robust floor 内作 expected/tactical tie-break
```

这样战略切换不会使同一状态的搜索值改变，也不会无谓失效 Value cache。

### 12.3 StageMatrix

StageMatrix 只接收：

```text
Risk acceptable
∩ committed escape
∩ non-dominated
∩ robust safe floor
∩ active StrategyBand
```

的 row。cell 继续使用完整 search + tactical value；Matrix 不解释 strategy
vector，也不再次做 Risk backup。

mixed policy 只能混合当前 band 中的动作。不同 strategy 之间不混合，因为
root strategy 是 observation-consistent 的公开承诺状态。

## 13. Risk 所有权

STRAT2 将“玩家风险喜好”和“战略目标”分离：

```text
RiskProfileController
  输入：用户/构建期 baseRisk 0–100 + stateRiskClass
  输出：多维 acceptable set 和 robust backup

StrategySelector
  输入：Risk 结果之外的战略证据
  输出：active strategy 和 bands
```

战略不能直接改变 Hard，也不能在 selection 后临时提高 Risk。COMEBACK 的
高风险需求由已有 `stateRiskClass`、终局可逆性和构建期风险合同表达，而不是
因为 strategy 名称而偷偷扩大死亡质量阈值。

如果未来确需 strategy-specific risk，必须作为独立实验：

- 同一个 root 只能有一个已冻结 RiskProfile；
- 必须在任何 action gating 前选定；
- profile ID 进入 ValueSearchKey；
- 不能在看到某个 action 的得分后再选择更有利的 RiskProfile。

STRAT2 v1 不启用该扩展。

## 14. PersistentPlan

战略的跨帧持续借鉴 Options 的 initiation / policy / termination，但执行合同为：

```text
StrategyState
  strategyId / generation / selectedAtRoot / minimumDwell

PersistentPlan
  strategyGeneration / purpose / target / deadline
  entity handles / dependency versions / continuation action set
```

每个 callback：

1. 重新运行 committed Hard 和 Risk；
2. 重新验证 Plan entity/deadline/terrain/observation；
3. continuation 只能作为 active strategy 的 primary/support 候选；
4. continuation 不再可活时立即失效；
5. 不能因为 strategy dwell 强制执行已失效 Plan；
6. strategy 改变时，不自动删除仍有物理意义的 SourcePlan 或 projectile/bomb。

Plan 是目的连续性，不是多帧动作队列。

## 15. 对手与技能

### 15.1 对手模型

对手风险喜好只能影响：

- enemy nominal action probability；
- StageMatrix 的 nominal expected tie-break；
- `verifiedOpportunity` 的置信区间；
- attack/star deadline 的软预测。

它不能：

- 删除 enemy support；
- 产生 strict Proof；
- 改写 committed danger；
- 局内改变我方 StrategyDescriptor/weights；
- 按对手名字加载特例。

### 15.2 技能

技能 descriptor 提供 capability 和 purpose：

```text
damage / disable / movement / concealment / defense
setup deadline / active window / cooldown
valid purpose mask
```

技能动作是否属于 primary 由“技能是否完成当前战略目的”决定，不能按技能名
固定加分。例：

- poison 能建立攻击窗口时属于 KILL/ATTACK_SETUP；
- shield 在反击链中可属于 KILL，也可属于 PRESERVE；
- teleport 到星旁只有在 STAR/COMEBACK 的星路径有效时属于 primary；
- cloak/grass 的射击、炸弹和 belief sweep 仍是软 Information 策略，不产生
  strict Proof。

## 16. 性能合同

### 16.1 复杂度

设根动作数 `A <= MAX_OUR_ACTIONS`，战略数 `S=5`：

```text
共享证据构建：O(A)
Selector：O(S)
band 分类：O(A)；若表驱动允许 O(S*A) 但 S 固定
最终 row 压缩：O(A)
```

禁止：

- 每 strategy 运行 path、ray、Information closure 或 search；
- node 内重跑 Selector；
- strategy 切换时清空 physics/hazard/source-plan cache；
- 热路径构造对象、数组、Map、Set、字符串或闭包；
- float 概率、`Math.random`、JSON/log；
- production 运行时加载配置文件。

### 16.2 内存布局

新增热数据上限：

```text
strategyBand       Uint8Array[MAX_OUR_ACTIONS]
strategyPurpose    Uint16Array[MAX_OUR_ACTIONS]
strategyReason     Uint16Array[MAX_OUR_ACTIONS]  // debug build可保留
decisionVector     固定 Int16/Uint16 SoA[5]
descriptor tables  构建期静态 TypedArray
```

production 可 strip `strategyReason` 或合并 bitset，但 source/minified 必须动作
指纹一致。

### 16.3 缓存

不因 strategy 改变而失效：

- Physical/Information state；
- terrain/path/ray；
- projectile/bomb SourcePlan；
- ReverseViability；
- raw feature；
- 完整语义的 search result。

需要版本或 key：

```text
strategyTableVersion
strategyGeneration          // Plan/ordering，不进 physical hash
orderingProfileId           // 仅不完整 anytime 结果需要
canonicalEvaluatorVersion   // 进入 ValueSearchKey
```

如果 strategy 只改变次序而不删除 search action，完整 ValueSearch cache 不含
strategyId。若未来 strategy 改变深层 representative action set，则该集合版本
必须进入 `SearchSemanticProfile`，不能复用旧值。

### 16.4 runtime/fallback

- NORMAL/FALLBACK 均使用同一 strategy 语义；
- fallback 只减少 search 工作量，不把战略退化成固定抢星或固定 FIRE；
- 中断使用最后一个完整 Risk + band + policy；
- 没有完整 policy 时按 Hard-safe、最小风险、当前 band、稳定行号回退；
- Emergency 中 strategy 只作最后 tie-break。

## 17. 可调参数

允许离线调整：

- 默认 strategy；
- 每战略 purpose mask；
- entry/exit threshold；
- deadline margin；
- minimum dwell / switch margin；
- band fallback 顺序；
- ordering profile；
- strategy-neutral tactical tie-break。

禁止直接调：

- Hard/Proof/Terminal；
- Risk 质量定义；
- committed/possible 事实等级；
- Matrix 量词；
- search terminal scale；
- 按地图、对手名字或 match ID 的特例。

所有参数：

- 只使用整数；
- 由 generated table 提供；
- 绑定 manifest/fingerprint；
- 一局内不可变；
- 必须经过 Discovery → Holdout → full arena；
- 不允许在全量对战结果上反复调参再把同一分母称为验证。

## 18. 设计级 UT 与性质测试

### 18.1 不变量

- 所有 strategy 下 Hard/Proof/Terminal 结果逐位一致。
- Risk acceptable set 在 strategy band 前后只会收缩，不会扩大。
- possible/future/UNKNOWN 不因 strategy 变成 EO 或 Hard。
- 同一 observation partition 的第一 strategy/action policy 一致。
- strategy 切换不删除 tracked projectile/bomb。
- root restore、cache-off/on、source/minified 动作指纹一致。

### 18.2 战略行为 fixture

- 安全直接击杀与普通取星并存：KILL 选攻击 band。
- 开火会立即死亡：KILL 也不能保留 FIRE。
- 需要先转向后开火：`AIM_SETUP` 为 support/primary，不被普通星路径替代。
- 无攻击证据但星可取：KILL fallback 可进入 STAR。
- 终局只有取星能逆转：COMEBACK/STAR primary。
- 终局击杀 deadline 更早：COMEBACK/KILL primary。
- 领先时存在安全反击：PRESERVE 不得强制龟缩。
- hidden world 的攻击目的不完整：不得升级 direct kill。
- active attack Plan 可活：continuation 获得 plan continuity。
- active Plan 已失效：dwell 不能继续强制。

### 18.3 Minimax 小型 oracle

为战略层建立不依赖 AgentTank 地图的微型 simultaneous game：

- `attack / setup / star / evade` 四类 row；
- enemy `fire / dodge / star / hold` 四类 column；
- 可配置 terminal、risk 和 information partition；
- exhaustive 枚举验证：
  - band 只缩 row，不改变 cell；
  - StageMatrix 只处理选中 band；
  - mixed policy 不跨 strategy；
  - 完整搜索结果与手工矩阵解一致；
  - 中断不把未访问 row 当 complete。

这组测试是结构约束，不以某次 V1/V2 胜率期望替换。

## 19. 实验指标和验收门

### 19.1 不能只看 FIRE 数

必须同时报告：

```text
FIRE action rate
qualified attack opportunity rate
attack opportunity → selected action
aim setup → later FIRE conversion
FIRE → hit / shield break / kill
post-fire survival
kill win / kill loss
star win / star loss
analysis W/L/D score
```

目标是更多**有目的并可转化为击毁的开火**，不是无目的提高 FIRE 百分比。

### 19.2 正确性门

- avoidable Hard reject = 0；
- strict Proof false positive = 0；
- risk dominated selection = 0；
- root restore failure = 0；
- V2 local timeout/error = 0；
- source/minified/缓存语义一致；
- 所有 strategy fixture 和 minimax oracle 通过。

### 19.3 战斗门

按当前用户目标：

- 相对冻结基线，V2 单方击毁胜局至少提升 10%；
- runtime-independent `V2_WIN + 0.5*DRAW` 严格超过 60%；
- 每种主要 variant 单独报告，不允许总量掩盖某一技能/seat 的大幅退化；
- WIN→LOSS、LOSS→WIN、星差、击毁差和动作转移矩阵全部对账。

以上是 production enable 门，不是设计文档通过门。

### 19.4 性能门

- Selector/band 微基准热分配为 0；
- 相对启用前固定输入，Selector + band P95 不高于 102%；
- 完整同输入总耗时不得增加；若测量噪音内持平，选择字节更小版本；
- 每 root 只运行一次 Combat evidence、一次 path 准备和一次搜索；
- completed depth、nodes/等价预算不能因 strategy 分层下降；
- production minified 继续满足平台上传字节门。

## 20. 分阶段迁移

### STRAT2-D0：合同和 oracle

- 本文评审；
- 注册新 decision 修订 DD7；
- 建立 minimax strategy oracle 和静态表 schema；
- production hash 不变。

验收：合同无冲突，所有旧 UT 不变，oracle 能暴露“全局 star bonus 泄漏”。

### STRAT2-D1：证据与 band shadow

- 增加 `StrategyEvidenceFrame` 和 band slab；
- 只计算、不参与选择；
- 输出离线 compact counter；
- production 默认动作必须逐帧完全一致。

验收：零热分配、复用证据、CURRENT 动作指纹一致。

### STRAT2-D2：统一评价边界

- 将 strategy-specific Eval 拆为 canonical outcome、ordering、tactical；
- 完整 cache key 和 source/minified 差分；
- 仍不启用 band 门禁。

验收：terminal/Hard/Proof不变；完整搜索跨 strategy 同值；性能不退化。

### STRAT2-D3：启用 KILL / ATTACK_SETUP

- 默认 `KILL_PRESSURE`；
- 删除全局 star GO/TURN bonus；
- Risk/EO 后启用 band；
- STAR/PRESERVE/COMEBACK 保持可切换。

验收：使用快速 Discovery/独立 Holdout；不直接反复运行全量调参。

### STRAT2-D4：完整资格

- 运行冻结 full arena 和新增历史 snapshot；
- 检查击毁 +10%、总得分 >60%、所有硬门和性能门；
- 生成新的 Candidate 前置验收。

任一阶段失败必须回到对应层修复，禁止追加 FIRE/STAR 固定分补丁。

## 21. 明确不做

- 不引入 MCTS、Monte Carlo playout、CNN 或在线强化学习；
- 不建立五套 Minimax；
- 不用“把 FIRE 加 5000 分”替代战略；
- 不把星完全删除；它是 STAR/COMEBACK/终局的重要目标；
- 不改变领先保护、stun、平台规则或 V1；
- 不用 opponent identity、地图名称或历史 match ID 写策略特例；
- 不为局部死亡窗口修改全局战略语义；
- 不在本设计阶段运行对战或修改 production。

## 22. 评审结论条件

本文的设计接受条件为：

1. 同意默认 strategy 为 `KILL_PRESSURE`。
2. 同意 strategy 使用离散 band，而不是全局加分。
3. 同意 RiskProfile 与 strategy 解耦，STRAT2 v1 不启用 strategy-specific risk。
4. 同意 Minimax 使用统一 canonical outcome evaluator。
5. 同意先 shadow、再 Discovery/Holdout、最后 full arena。
6. 同意“击毁 +10% 且总得分 >60%”是 enable 门，不是用来改 Hard/Proof 的理由。

上述六项已由 `DEC-0095` 接受。D0–D3 的本地实现与验证见
[STRAT2 strategy layer implementation](../implementation/strat2-strategy-layer.md)。
这不关闭 `OI-ARCH-019`：D4 战斗门、相对性能门和 production 上传体积门仍未完成。
