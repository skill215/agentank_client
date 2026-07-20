# 详细设计路线与阶段门

状态：DD0–DD10详细设计阶段已全部完成，2026-07-16。最终实施审计通过，后续执行[implementation-plan.md](implementation-plan.md)的IMP0–IMP10；具体参数仍由RuleCorpus、ReferenceKernel和Benchmark决定。

## 0. 当前阶段

- DD0：**COMPLETE**。产物见 [detailed-design-index.md](detailed-design-index.md)。
- DD1：**COMPLETE**。动作调度、主时间线、终局/证明代数和 RuleCorpus schema 已冻结。
- DD2：**COMPLETE**。状态、观察、实体关联、数值 ABI 与容量 schema 已冻结。
- DD3：**COMPLETE**。真实负载原型已冻结 multi-world、热池、栈、support 和 BranchMark 基本 ABI。
- DD4：**COMPLETE**。ReferenceKernel、RuleCorpus revision 2 与规则校准边界已冻结。
- DD5：**COMPLETE**。generated FastKernel、Hazard、ReverseViability 与差分设计已冻结。
- DD6：**COMPLETE**。Value/Matrix/Proof/Risk搜索语义已冻结。
- DD7：**COMPLETE**。Evaluation、Strategy、Opponent、Skill descriptor与Plan已冻结。
- DD8：**COMPLETE**。唯一cache inventory、Runtime/fallback与production build合同已冻结。
- DD9：**COMPLETE**。历史语料、反事实、Benchmark/release evidence matrix与全局审计已冻结。
- DD10：**COMPLETE**。滚动语料、平台能力与simulate/publish/challenge/download/analyze运行状态机已冻结。

## 1. 目标

本路线解决三个问题：

1. 详细设计先做什么、后做什么；
2. 哪些平台规则会阻塞某个阶段，哪些可以参数化后继续；
3. 每个阶段必须产出什么、满足什么条件后才能进入下一阶段。

总体依赖：

```text
DD0 规范收口
  -> DD1 动作/调度/时间线/终局语义
  -> DD2 状态/观察/实体/数值 ABI
  -> DD3 真实负载架构验证原型
  -> DD4 ReferenceKernel 与规则校准
  -> DD5 FastKernel 与硬物理层
  -> DD6 Proof / Value / Risk 搜索
  -> DD7 策略/评分/对手/技能/Plan
  -> DD8 缓存/时间/fallback/构建
  -> DD9 历史回归/反事实/平台验证/发布门
  -> DD10 滚动语料/平台运行/两级发布门
```

历史语料和 Benchmark 是贯穿各阶段的验证轨道，不等到 DD9 才开始。DD1 后可以进行 factual replay；严格 `ROBUST_AVOIDABLE/STRICT_UNAVOIDABLE` 必须等待 DD4–DD6 对应语义和内核完成。

## 2. 全局阶段规则

- 不允许用后续模块的假设掩盖前置语义缺口。
- 每个状态字段必须有唯一 owner、单位、生命周期、hash 归属和撤销方式。
- 每个 UNKNOWN 必须映射到 RuleVariant、概率区间、保守 fallback 或明确的生产阻塞；禁止隐式采用猜测值。
- 每个严格 ProofStatus 必须有完整量词定义和 CoverageCertificate。
- 每个热函数必须声明最坏循环次数、delta/event 上限、缓存访问、时钟访问和堆分配。
- Cache 只在语义、key、版本、碰撞核验和失效条件全部明确后进入生产候选。
- DD3 真实负载垂直原型通过前，禁止冻结 InformationState、Arena、Delta、Result、Policy 和 Cache 基本 ABI。
- ReferenceKernel 未校准前，FastKernel 结果不能成为规则 Oracle。
- 任何阶段出现状态不可表达、规则不可执行或真实性能不成立，必须退回依赖阶段修改，不用后续补丁绕过。

## 3. 规则分级与进入详细设计的条件

### 3.1 R0：结构规则

R0 决定状态转换的拓扑，阻塞 DD1–DD5：

- onIdle、行动机会和命令队列；
- 双方动作、自动帧和 chance 的调度方式；
- FrameTimeline phase 顺序；
- projectile speed、substep、创建帧移动和碰撞；
- tank 移动、同格、交换位置和阻挡；
- bomb、effect、地图破坏和 star phase；
- observation 生成时点；
- 128 帧、同时击毁、同星/runtime 和 terminal phase；
- `enemy.bullet`、`game.bombs` 等运行时数据形状。

R0 必须在 DD1 结束前满足以下之一：

1. 平台确认唯一规则；
2. ReferenceKernel 可运行有限 RuleVariant，且该规则被明确标记为 FastKernel/生产阻塞。

### 3.2 R1：状态机规则

R1 决定实体和技能状态机，必须在 DD4 结束前冻结 support：

- 八种技能的施放、持续、失效和冷却；
- shield hit count；
- overload 多 projectile；
- fire/bomb/teleport lock；
- freeze、stun、poison 与队列；
- cloak、grass 和 teleport reveal。

具体整数参数可以表驱动，但 action support、事件种类和状态字段不能保持隐式未知。

### 3.3 R2：概率规则

R2 在 support 已知时不阻塞状态和 Proof 设计：

- stun 正常/反向概率；
- teleport 合法落点概率；
- 未来 star 生成概率。

处理合同：

- Proof 覆盖全部非空 support；
- Value 使用已确认概率或概率区间；
- 概率未确认时不得生成 exact ExpectedValue；
- support 也未知时升级为 R0/R1 阻塞，而不是用虚构 chance outcome。

### 3.4 R3：策略和性能参数

R3 不阻塞语义详细设计，由 Benchmark 和平台校准决定：

-风险曲线和 feature weights；
-搜索深度与候选额度；
- TT/Arena 容量；
- regret 迭代数与 tolerance；
- fallback 深度；
- TypedArray/packed Array、递归/显式栈等 A/B。

### 3.5 RuleCorpus 条目要求

每条规则进入可执行 RuleCorpus 前至少包含：

```text
ruleId
category
source/status
preconditions
phase
state reads/writes
emitted events
chance support/probability
observation for each side
terminal impact
unknown-rule behavior
fixture ids
hash/cache dependencies
proofEligibility
```

## 4. DD0：规范收口

状态：**COMPLETE（2026-07-15）**。

### 内容

- 冻结文档权威层级和术语表；
- 建立 decision/open-issue register；
- 为现有冲突分配 decision id、影响阶段和解决证据；
- 统一 Terminal、Hard、Proof、Bound、Action、World、Chance、Policy、Cache 名称；
- 为所有后续详细设计文档建立模板。

### 产物

- [design-authority.md](design-authority.md)
- [decision-register.md](decision-register.md)
- [open-issues-register.md](open-issues-register.md)
- [detailed-design-index.md](detailed-design-index.md)

### 退出门

- 一个核心名词只有一个规范定义；
- Cache、Result、Terminal 等现有字段冲突全部登记；
- 每个 UNKNOWN 明确分类为 R0–R3；
- 每个问题都有目标阶段，不存在“以后再说”但无人负责的阻塞项。

DD0 扫描范围包含 v1 当前工作副本与分析文档、244 局冻结 corpus、固定 commit 的外部 simulator 和 framework。扫描结论只进入证据边界、decision 和 issue，不直接修改平台规则或冻结底层 ABI。

## 5. DD1：动作、调度、时间线和终局

状态：**COMPLETE（2026-07-15）**。

### 内容

1. Action/command grammar：单动作、复合动作、`go(2)`、boost 免费 turn、skill 和 teleport family。
2. Pending command：我方已提交队列、敌方命令 belief、freeze/stun/poison 后的执行。
3. NodeKind：

```text
OUR_DECISION
ENEMY_DECISION
SIMULTANEOUS_DECISION
AUTOMATIC_FRAME
CHANCE_RESOLUTION
OBSERVATION_SPLIT
TERMINAL
```

4. FrameTimeline：effect、bomb、双方动作、projectile substep、collision、terrain、star、observation、terminal。
5. 终局/证明代数：WIN、LOSS、DRAW、NON_TERMINAL、UNKNOWN，以及 ForcedWin/Nonloss/Loss 的量词。
6. 状态分类：

```text
SubmissionLegality
ExecutionStatus
HardGateStatus
TerminalOutcome
TerminalResolutionStatus
ProofStatus
BoundKind
```

### 产物

- [action-scheduler-contract.md](action-scheduler-contract.md)
- [frame-timeline-contract.md](frame-timeline-contract.md)
- [terminal-proof-algebra.md](terminal-proof-algebra.md)
- [rule-corpus-schema.md](rule-corpus-schema.md)

### 退出门

给定 `PhysicalState + 双方命令/队列 + chanceCode + ruleVariantId`，必须能够唯一得到 ordered events、后继 PhysicalState、双方有限 observation relation 和 terminal resolution。所有 R0 规则已确认或明确阻塞 FastKernel。

退出门已满足：R0 主规则均已确认或收敛为有限 RuleVariant；UNKNOWN 的 Reference/Value/Proof/Fast/emitter 行为已定义；OI-ARCH-003/004/005 已关闭。`VARIANT_DEFINED` 项仍由 DD4 校准，不阻塞 DD2 的可表达性设计。

## 6. DD2：状态、观察、实体和数值 ABI

状态：**COMPLETE（2026-07-15）**。

### 内容

- ObservedRoot 字段、nullability、输入校验和坐标转换；
- TrackedState 与多实体 observation reconciliation；
- runtime objectId 与内部 handle/generation 的关联；
- PhysicalState 唯一字段表，时间统一为绝对 frame/deadline；
- InformationState 的联合隐藏世界、相关性、双方 observation history 和 enemy information partition；
- 多 projectile、hidden bomb、hidden tank、command belief 的联合表示；
- exact Possibility 与 top-K Probability/residual 的关系；
- CommandCode bit layout、ActionRef/ActionKey、ActionProgram 和 compound execution；
- ResultArena、mixed-policy handle、概率数组和 PRNG 状态；
- canonical hash/signature、候选位宽和容量公式；Arena stride 只登记候选，不在 DD2 冻结。

InformationState 的候选基线是：

```text
common physical base       // support 共享，但未必向双方公开
  + compact hidden-world deltas
  + exact possibility representation
  + top-K probability worlds
  + symbolic/factored residual
```

最终实现必须由 DD3 A/B 决定，不能只用 enemy cell/direction stateId 代表全部隐藏事实。

### 产物

- [observation-reconciliation-contract.md](observation-reconciliation-contract.md)
- [entity-data-association-contract.md](entity-data-association-contract.md)
- [information-state-storage-contract.md](information-state-storage-contract.md)
- [action-result-abi.md](action-result-abi.md)
- [memory-capacity-manifest-schema.md](memory-capacity-manifest-schema.md)

### 退出门

- 任意 RuleCorpus fixture 可无损编码；
- 同一 InformationState 的多个 PhysicalWorld 可同时存在；
- make/unmake 不覆盖其他 world；
- 双方 observation 不泄漏 TruthState；
- mixed policy 可通过统一 Result ABI 返回；
- 所有状态字段具备 owner、单位、生命周期、hash 和撤销定义。

退出门已满足于逻辑/候选 ABI 层：所有 DD1 fixture 字段均有无损表示；多个 world 使用 immutable record 并存；双方 observation/partition 不读取 TruthState；统一 Result/Policy 可返回 mixed policy；owner/hash/undo/overflow 已登记。具体 TypedArray/packed Array、stride、容量参数和 copy/delta 赢家必须由 DD3 验证，不能因 DD2 COMPLETE 提前冻结。

## 7. DD3：真实负载架构验证原型

状态：**COMPLETE（2026-07-15）**。

### 必须覆盖的垂直切片

```text
最大规格地图
  + 双方技能
  + 多 projectile
  + 多 bomb
  + hidden tank/projectile/bomb
  + 多个 PhysicalWorld
  + observation partition
  + restricted stage matrix
  + apply/undo
  + mixed-policy output
```

### 必须 A/B

- Compact WorldSnapshot vs Immutable WorldDelta；两者都只在 branch-local scratch 上 apply/undo，不修改并存 WorldRecord；
- 显式世界列表 vs 因子化 residual；
- 递归 DFS vs 显式栈；
- TypedArray vs packed Array 的候选小结构；
- 直接重算 vs 候选缓存。

### 退出门

- 真实复合 workload 而非假 joint action 证明布局可行；
- 确定 InformationState/PhysicalWorld 并存方式；
- 冻结 Arena、Delta、Result、Policy、EventBuffer 基本 ABI；
- 得到内存清单和节点/事件最坏上限；
- 未通过时返回 DD2，禁止带着临时表示进入 Reference/Fast 全量实现。

退出门已满足：两档真实复合 workload 的 20 个 oracle 零失败；source/minified 语义 fingerprint 一致；全部容量故障按合同返回 incomplete/emergency 并 fully undo；multi-world 选择 immutable delta，热池选择 TypedArray SoA，driver 选择显式栈，support 选择 exact prefix + lossless residual。产物见 [architecture-prototype-report.md](architecture-prototype-report.md)、[dd3-frozen-abi.md](dd3-frozen-abi.md) 和 [dd3-overview.md](dd3-overview.md)。平台容量/引擎复核保留到 DD8，不阻塞 DD4。

## 8. DD4：ReferenceKernel 与规则校准

状态：**COMPLETE（2026-07-15）**。

### 内容

- 对象友好的完整 PhysicalState 和 FrameTimeline；
- canonical event trace；
- `observeForSide` 与双方信息分区；
- RuleVariant 和概率区间；
- TerminalResolver；
- 小型穷举 Proof Oracle；
- RuleCorpus、外部模拟器和历史 checkpoint adapter。

### 退出门

- R0 fixture 全部可执行；
- 已确认规则与平台 replay/simulation 一致；
- 外部模拟器差异全部分类；
- R1 的 action/event support 已冻结；
- 每个 UNKNOWN 有 interval、禁用范围或生产阻塞标志；
- factual replay 无法重建的字段保持 UNKNOWN，不猜测。

退出门已满足于详细设计层：20 条规则、12 个 variant group、21 个 fixture 和 handler/adapter binding 已形成 design-executable corpus；overload geometry、poison relative cadence 与 last-record terminal boundary 被平台 replay 收敛；R1 action/event family 已 confirmed、variant 化或明确生产阻塞；所有 external simulator 差异已分类。产物见 [reference-kernel-contract.md](reference-kernel-contract.md)、[dd4-rule-corpus.json](dd4-rule-corpus.json)、[rule-calibration-report.md](rule-calibration-report.md) 和 [dd4-overview.md](dd4-overview.md)。

## 9. DD5：FastKernel 与硬物理层

状态：**COMPLETE（详细设计，2026-07-15）**。

### 内容

- 构建期整数规则表；
-实体池、事件缓冲、FrameTimeline 快速执行；
- make/unmake 与统一 BranchMark；
- committed trajectory、bomb blast 和 HazardKernel；
- ReverseViability、DeadlineKernel 和 ObservationPartition；
- Reference/Fast 全量差分。

### 退出门

-热路径近零临时对象；
-每个热函数有明确复杂度上限；
-root hash、Arena、Delta 和 entity mask 完整恢复；
-Reference/Fast 对规则 fixture 一致；
-已提交危险完整生命周期不受搜索深度影响；
-容量不足返回 INCOMPLETE，不截断真实事实。

退出门已满足于详细设计层：Fast 生成表、prepare/commit/undo、三危险平面、committed closure、ReverseViability、Deadline、每 action 前置 HardGate 和 21-fixture 差分/fault 矩阵已冻结。产物见 [fast-kernel-contract.md](fast-kernel-contract.md)、[hazard-kernel-contract.md](hazard-kernel-contract.md)、[reference-fast-differential-report.md](reference-fast-differential-report.md) 与 [dd5-overview.md](dd5-overview.md)。JavaScript 实现仍须按报告运行零差异门，不能由设计状态冒充执行通过。

## 10. DD6：Proof、Value、Risk 搜索

状态：**COMPLETE（详细设计，2026-07-15）**。

按以下子阶段推进：

1. 完全可观察 pure lower/upper；
2. Double Oracle 与整数矩阵；
3. InformationState/public-belief 受限 solver；
4. AND/OR Proof、DFPN completion；
5. 递归 epsilon-contamination 风险；
6. root safe exploitation 与 mixed-policy 输出；
7. anytime、中断和显式区间。

本阶段必须统一 RiskMatrix 与 safe-exploitation constrained objective 的关系，不能在根节点重复施加两套不一致风险准则。

### 退出门

- RPS、Matching Pennies、dominated-support、strategy-fusion、chance、terminal、risk recursion 全部通过；
- ForcedWin/Nonloss/Loss 都有对称定义和完整证书；
-任意合法中断保持 `lower <= trueValue <= upper`；
-root policy、概率量化和 PRNG 可复现；
-Proof 不依赖启发式、概率剪枝或 UNKNOWN rule。

退出门已满足于详细设计层：pure interval、restricted Double Oracle、InformationState AND/OR/DFPN、三维递归risk、safe-floor和mixed policy合同已冻结；算法实现测试矩阵明确但不伪报运行通过。产物见 [value-search-contract.md](value-search-contract.md)、[matrix-policy-contract.md](matrix-policy-contract.md)、[proof-search-contract.md](proof-search-contract.md)、[risk-backup-contract.md](risk-backup-contract.md) 与 [dd6-overview.md](dd6-overview.md)。

## 11. DD7：策略、评分、对手、技能和 Plan

状态：**COMPLETE（详细设计，2026-07-16）**。

### 详细设计拆分

```text
evaluation-contract.md
strategy-selector-contract.md
opponent-model-contract.md
skill-state-machine-contract.md
plan-contract.md
```

必须定义：

- feature、整数尺度、上下界和 FeatureDependencyMask；
- baseRisk、stateRiskClass、effectiveRisk 和风险查表；
- StrategySelector 分数、切换 margin、驻留和 hysteresis；
- 对手模型中的 opportunity、choice、fast/slow estimate、confidence 和动作概率；
- 八种技能 descriptor 字段和状态机；
- ShotPlan/BombPlan 的 pending、active、completed、invalidated 生命周期。

### 退出门

-所有软特征都有有界成本和数值范围；
-局中只更新敌方参数，不改变我方固定权重；
-技能不能绕过 Hard、Terminal 或 Proof；
-Plan 的实体、版本、deadline 和失效条件明确；
-软模块只能影响 Expected、Risk、排序和 Plan，不污染物理事实。

退出门已满足于详细设计层：FeatureRegistry/成本/依赖、root策略切换、对手事件概率、八技能descriptor、PlanSketch/PersistentPlan和hidden threat风控已冻结；参数校准与实现A/B由DD8/DD9负责。产物见 [evaluation-contract.md](evaluation-contract.md)、[strategy-selector-contract.md](strategy-selector-contract.md)、[opponent-model-contract.md](opponent-model-contract.md)、[skill-state-machine-contract.md](skill-state-machine-contract.md)、[plan-contract.md](plan-contract.md) 与 [dd7-overview.md](dd7-overview.md)。

## 12. DD8：缓存、时间、fallback 和构建

状态：**COMPLETE（详细设计，2026-07-16）**。

### 缓存统一清单

```text
PHYSICAL_VALUE_TT
INFORMATION_VALUE_TT
PROOF_CACHE
STAGE_MATRIX_CACHE
CHANCE_CACHE
PATH_CACHE
FEATURE_CACHE
BELIEF_CACHE
ENTITY_PLAN_CACHE
REGRET_WARM_CACHE       // optional, default off
TRANSITION_CACHE        // optional, default off
```

每个缓存必须提供：semantic inputs、version inputs、value、允许的 cutoff、碰撞核验、生命周期、失效、容量和生产准入。

### 时间控制

-累计耗时来源和平台校准；
-每 callback/profile 预算；
-固定节点/iteration 检查批次；
-NORMAL、DEGRADED、FALLBACK、EMERGENCY 的准确入口；
-最坏批次耗时和最终 emitter 预留；
-fallback 保留的硬安全、终局和缩减 Minimax；
-一致性失败与 EmergencyReserve 路径。

### 构建

-规则表和技能专门化生成；
-离线 Adapter、Reference、日志和 replay 代码剥离；
-source/minified 差分；
-bundle bytes、初始化和内存清单；
-build manifest 与可重复构建。

### 退出门

- Cache inventory 和 key matrix 唯一；
-关闭任一缓存不改变语义结果；
-fallback 与正常模式共享 RulesKernel/Terminal/Hard 语义；
-任一检查批次不会耗尽 emergency 时间储备；
-正式 bundle 不包含离线证据、模拟器或命名对手数据。

退出门已满足于详细设计层：11个canonical cache/key matrix、cache-off语义、累计runtime模式、缩减Minimax fallback、EmergencyReserve、生成/strip/source-minified/build manifest均已冻结。数值容量/depth与平台byte/engine仍须实现benchmark，不能由设计状态冒充release通过。产物见 [cache-inventory.md](cache-inventory.md)、[dd8-cache-inventory.json](dd8-cache-inventory.json)、[runtime-fallback-contract.md](runtime-fallback-contract.md)、[production-build-contract.md](production-build-contract.md) 与 [dd8-overview.md](dd8-overview.md)。

## 13. DD9：历史证据、Benchmark 与发布门

状态：**COMPLETE（详细设计，2026-07-16）**。

### 历史语料

- 冻结 `LEGACY_CORPUS_VERSION` 和 immutable manifest；
- 按 match/opponent/map/skill/codeHash/time 建立 discovery、calibration、frozen、forward split；
- 建立 codeHash -> 可执行 v1 source 的支持矩阵；
-冻结 DualTrack、Window 和 CounterfactualResult schema。

### 反事实准入

- DD1 后：FactualReplay/event reconstruction；
- DD4 后：TRACE/MODEL_AVOIDABLE；
- DD5–DD6 后：ROBUST/STRICT 与敌方反向逃生；
-完整搜索后：v1/v2 league 和平台前向验证。

### 发布门

1. 零 terminal/hard/proof false positive；
2. 零 root restore、stale cache 和真实实体截断；
3. 平台累计 runtime 安全；
4. 正向 Kill/Escape/Skill/TerminalTrade 机制不回退；
5. DD9锁定后的 frozen corpus 未用于调参；
6. forward platform matches 通过；
7. source/minified/production bundle 行为一致。

退出门已满足于详细设计层：`LEGACY-244-20260715.1`、artifact/split fingerprints、23-codeHash源码支持矩阵、DualTrack/Window/Checkpoint/CounterfactualResult、分叉门、双方avoidability量词和G0–G10发布证据矩阵已冻结。当前无v2实现和post-build forward局，因此发布判定如实为`NOT_RELEASE_ELIGIBLE`。产物见 [legacy-corpus-manifest.md](legacy-corpus-manifest.md)、[dd9-legacy-corpus-manifest.json](dd9-legacy-corpus-manifest.json)、[counterfactual-validation-contract.md](counterfactual-validation-contract.md)、[release-gate-report.md](release-gate-report.md)、[dd9-overview.md](dd9-overview.md) 与 [dd0-dd9-consistency-audit.md](dd0-dd9-consistency-audit.md)。

## 14. DD10：滚动证据与平台运行

状态：**COMPLETE（详细设计，2026-07-16）**。

### 滚动语料

- 冻结244仍是不可变快照，不再代表当前总局数；
- 平台下载按append-only MatchLedger去重，CorpusHead可变、CorpusSnapshot不可变；
- assignment以append-stable session算法生成，旧组不因新下载静默迁移；
- 已看过的post-244对局只作`DISCOVERY_APPEND`；forward必须预注册candidate、时间和计划；
- skill与terminal字段携带provenance，未观察技能不等于none，缺失runtime不等于0。

### 平台运行

1. BuildManifest和CapabilityProfile先通过本地校验；
2. 每个新candidate hash必须完成服务器simulation suite，任何error/timeout/下载不完整都阻塞；
3. publish是受锁保护的mutation，成功后必须GET读取并核对code hash；
4. challenge触发与结果下载分开，未知响应不得盲目重试，必须reconcile；
5. summary/events/raw原子落盘并记录hash，再提交ledger；
6. 分析按基础设施、终局、事实战术、反事实、聚合五层运行并保存版本化报告；
7. canary首次上传和最终release验收分开，避免forward证据的循环依赖。

退出门已满足于详细设计层：[rolling-corpus-contract.md](rolling-corpus-contract.md)、[platform-operations-contract.md](platform-operations-contract.md)、[dd10-platform-run.schema.json](dd10-platform-run.schema.json)、[dd10-overview.md](dd10-overview.md) 与 [dd0-dd10-consistency-audit.md](dd0-dd10-consistency-audit.md) 已冻结。runner、ledger迁移、analyzer迁移及平台端到端校准仍未实现，因此只能进入实现，不能发布。

## 15. 允许并行与禁止抢跑

DD0–DD3 期间可以并行：

- R0/R1 平台 fixture 收集；
- factual replay 和 LegacyFinding 结构化；
- Benchmark harness；
- 外部模拟器差分；
- 构建 manifest/schema 草案。

在对应阶段门前禁止：

- 冻结 InformationState/world storage；
- 把未知 phase 写死进 FastKernel；
- 用 v1 行为或外部模拟器替代规则 Oracle；
- 开始完整 Minimax/CFR/DFPN 优化；
- 把 TRACE/MODEL_AVOIDABLE 升级为 Hard/Proof；
- 根据局部 microbenchmark 冻结生产布局。

## 16. DD10完成记录与后续实施顺序

DD9 的不可变快照/反事实语义与 DD10 的滚动ledger/平台运行语义均已完成。后续按依赖实现：

1. ReferenceKernel + Rule fixtures；
2. FastKernel/Terminal/Hard + exhaustive differential；
3. Value/Matrix/Proof/Risk + small-state Oracle；
4. Eval/Strategy/Opponent/Skill/Plan；
5. 11 caches、RuntimeController、production generator；
6. MatchLedger/CorpusSnapshot、skill/terminal provenance迁移；
7. 非密钥TankProfile Registry、secret adapter、owner-scope调度，以及平台runner的build/simulate/publish/challenge/download/reconcile与fault injection；
8. DualTrack/window/counterfactual/analyze harness；
9. Discovery/Calibration 后冻结 candidate；
10. 函数/复合/全景/终局/完整对局与故障注入；
11. source/minified/strip/bytes并取得强制simulation attestation；
12. G0–G9、G10A Frozen、profile-bound精确字节simulation和rollback/首次无基线例外门通过后，只允许向目标TankProfile canary publish，随后采集预注册G10B Forward；
13. 仅G0–G11全部PASS后标记`RELEASE_ACCEPTED`。
