# 设计权威、术语与证据边界

状态：DD10同步规范，2026-07-16生效。本文只规定“什么可以定义什么”；不替代各阶段的详细合同。

## 1. 规范词

- **必须**：违反即不满足阶段门或不得进入生产候选。
- **禁止**：不能用参数、性能收益或胜率结果豁免。
- **应当**：默认要求；例外必须登记 decision id 和验证方式。
- **可以**：不改变规范语义的实现选择。

## 2. 权威按问题域划分

不存在一份文档对所有问题拥有最高权威。冲突必须先判断问题域，再按下表处理。

| 问题域 | 规范权威 | 辅助证据 | 不得作为权威 |
|---|---|---|---|
| 平台 API、技能、物理、观察、终局 | 当前官方 Updates；当前官方 Guide；已校准的平台 replay/simulation；[dd4-rule-corpus.json](dd4-rule-corpus.json) | 外部模拟器、v1、用户观察 | 外部模拟器默认值、本地胜率、v1 猜测 |
| 阶段顺序与冻结门 | [detailed-design-roadmap.md](detailed-design-roadmap.md) | 本索引和 benchmark 结果 | 为赶实现跳过前置阶段 |
| 搜索量词、Proof、Bound、Risk | DD6 的 [value-search-contract.md](value-search-contract.md)、[matrix-policy-contract.md](matrix-policy-contract.md)、[proof-search-contract.md](proof-search-contract.md)、[risk-backup-contract.md](risk-backup-contract.md)；DD1 的 [terminal-proof-algebra.md](terminal-proof-algebra.md) | [hybrid-solver-contracts.md](hybrid-solver-contracts.md)、论文与测试 | 历史动作结果或启发式分数 |
| 数值、Action、Result、Event ABI | [action-result-abi.md](action-result-abi.md) + [dd3-frozen-abi.md](dd3-frozen-abi.md) | [kernel-interfaces.md](kernel-interfaces.md)、[memory-layout.md](memory-layout.md) | 旧 `actionCode`/双 Result 草案 |
| 根观察、实体关联与 InformationState | [observation-reconciliation-contract.md](observation-reconciliation-contract.md)、[entity-data-association-contract.md](entity-data-association-contract.md)、[information-state-storage-contract.md](information-state-storage-contract.md) | v1 track、Guide、replay、模拟器 | 单一敌方位置 belief、外部 ID、平台对象引用 |
| 状态布局、容量、apply/undo | DD2 合同 + [dd3-frozen-abi.md](dd3-frozen-abi.md)；生产容量选择遵守 DD8 manifest/benchmark合同 | high-performance/memory 草案、DD3 report | 仅凭 C/Java 经验或局部函数测速 |
| Cache 名称、key、语义、失效 | DD8 的统一 Cache Inventory | [cache-contracts.md](cache-contracts.md) | 各文档各自增加的同名或别名缓存 |
| 验证与发布判定 | [benchmark-contract.md](benchmark-contract.md) 和 [release-gate-report.md](release-gate-report.md) | corpus 报告、外部模拟器、平台前向局 | 单一总体胜率或历史动作一致率 |
| v1 遗产与反事实使用 | [legacy-evidence-contract.md](legacy-evidence-contract.md)、[legacy-corpus-manifest.md](legacy-corpus-manifest.md)、[counterfactual-validation-contract.md](counterfactual-validation-contract.md) | v1 代码、分析文档、冻结回放 | 把 v1 实现复制为 v2 物理/搜索真值，或分叉后消费replay后缀 |
| 动态语料、分组与字段provenance | [rolling-corpus-contract.md](rolling-corpus-contract.md) | 冻结DD9快照、下载目录、历史分析器 | 固定目录计数、未施法=`none`、缺失runtime=0 |
| 平台build/simulate/publish/challenge/download/analyze | [platform-operations-contract.md](platform-operations-contract.md) + [dd10-platform-run.schema.json](dd10-platform-run.schema.json) + [dd10-platform-capability.schema.json](dd10-platform-capability.schema.json) | Agent Guide API、framework脚本思路 | 手工上传、未核对mutation、未绑定candidate的散落结果 |
| tank/key/profile身份、secret引用、branch基线与owner-scope限流 | [platform-operations-contract.md](platform-operations-contract.md) + [dd10-tank-registry.schema.json](dd10-tank-registry.schema.json) | 每次GET context、平台限流响应 | key值、文件名、最近使用tank、相同bundle hash |
| Build/Candidate/Run/Evidence身份与hash血缘 | [artifact-lineage-contract.md](artifact-lineage-contract.md) | BuildManifest、Run artifacts、release reports | 文件名、工作目录current、重复字段中的“较新值” |
| IMP0–IMP10阶段验收状态 | [imp-acceptance-contract.md](imp-acceptance-contract.md) | 各阶段Overview、实现门和测试报告 | Overview自我批准、口头“基本通过”、加权抵消 |

DD3 已冻结 Arena/Delta/Result/Policy/EventBuffer/InformationState 的基本物理 ABI revision。DD8 已冻结唯一cache inventory与容量选择合同；具体entry counts/bytes仍须实现benchmark写入BuildManifest。任何与 [dd3-frozen-abi.md](dd3-frozen-abi.md) 或 [cache-inventory.md](cache-inventory.md) 冲突的早期候选描述均视为历史方案。

## 3. 平台规则证据层级

从高到低：

1. `OFFICIAL_UPDATE_CONFIRMED`：官方 Updates 对具体规则的明确变更；
2. `GUIDE_CONFIRMED`：当前官方 Guide 的明确正文；
3. `PLATFORM_REPLAY_CONFIRMED` / `PLATFORM_SIMULATION_CONFIRMED`：可重复、可定位的平台证据；
4. `EXTERNAL_SIM_MATCH`：固定版本外部模拟器的实现或测试；
5. `USER_CONFIRMED`；
6. `INFERRED`；
7. `UNKNOWN`。

同一规则发生冲突时：

- 高层证据覆盖低层证据；
- 同层证据冲突时不得任选其一，必须建立 RuleVariant 和 open issue；
- 只有前 3 级默认具备严格 Proof 资格；
- 外部模拟器与 v1 只能发现候选、生成 fixture、定位差异；
- 未解决规则不得通过“最可能”写入 HardGateStatus 或 ProofStatus。

规则证据、算法政策和实现选择必须分开记录：平台事实进入 RuleRegistry；算法选择进入 Decision Register；未知和冲突进入 Open Issues Register。

## 4. 唯一规范术语

| 术语 | 唯一定义 | 禁止混用 |
|---|---|---|
| `ObservedRoot` | 一次 `onIdle` 可合法读取的原始观察经校验、整数化后的根输入 | TruthState、完整 PhysicalState |
| `TrackedState` | 跨回调维护的已观察实体、命令、belief 和版本；允许含未知 | 当前帧平台真值 |
| `PhysicalState` | 在一个冻结 RuleVariant 下足以唯一推进物理与事件的完整世界状态 | 观察快照、概率 belief |
| `PhysicalWorld` | InformationState support 中一个具体 PhysicalState 实例 | HiddenWorld 的枚举标签 |
| `InformationState` | 与合法观察历史一致的 PhysicalWorld 集合、相关性、权重/残差和双方信息分区 | 敌方位置热力图的单一边缘分布 |
| `SearchState` | `PhysicalState | InformationState` 的显式 tagged union | 默认假设完全可观察的单一 state |
| `EnemyAction` | 对手在其信息分区内可选择的策略动作 | 隐藏事实或规则随机性 |
| `HiddenWorld` | 与当前观察一致、搜索必须覆盖的物理世界 | chance outcome 或 RuleVariant |
| `ChanceOutcome` | 规则规定的非战略随机结果 | 敌方选择或未知规则 |
| `RuleVariant` | 开发/校准期对未确认规则实现的候选 | 生产搜索的第四种量词 |
| `ActionProgram` | 一次回调提交的有序 Command 序列 | 已执行动作或物理事件 |
| `CommandCode` | 一个 primitive Command 的稳定 uint32 编码 | ActionProgram 地址、stun/chance 结果 |
| `ActionRef` | 当前 ActionArena 内一个 ActionProgram record 的易失引用 | cache key、跨 root 稳定身份 |
| `ActionKey` | ActionProgram command sequence 的稳定双 uint32 canonical signature | arena offset |
| `Command` | 已提交但可能在未来 action slot 执行的队列项 | 即时状态变化 |
| `ExecutedFrameAction` | 一个 seat 在一个 frame action slot 中实际完成的原子或 boost 复合执行 | ActionProgram、CommandQueue |
| `Event` | FrameTimeline 在确定 phase 中产生的有序、不可变结果记录 | Action 本身 |
| `SubmissionLegality` | Command/ActionProgram 是否可提交进入队列 | 执行是否成功、是否会输 |
| `ExecutionStatus` | 命令被执行、延迟、抑制、失败或消耗的结果 | TerminalOutcome |
| `TerminalOutcome` | `WIN | LOSS | DRAW | NON_TERMINAL`；只描述在已知规则下的终局分类 | HardGateStatus、静态分数或规则未知 |
| `TerminalResolutionStatus` | `RESOLVED | UNKNOWN_RULE | INCOMPLETE_STATE`；说明能否可靠给出 TerminalOutcome | DRAW、NON_TERMINAL |
| `HardGateStatus` | `HARD_ALLOW | HARD_REJECT_PROVEN | HARD_REJECT_POLICY | HARD_INCOMPLETE`；在评分前约束 action，但只有 PROVEN 可进入严格失败证明 | 一般高风险、提交非法、执行失败 |
| `ProofStatus` | `FORCED_WIN_PROVEN | FORCED_NONLOSS_PROVEN | FORCED_LOSS_PROVEN | ACTION_REFUTED | UNKNOWN` | depth-limited exact value |
| `BoundKind` | Value 结果是 exact 还是 lower/upper interval，以及不完整原因 | ProofStatus |
| `CoverageCertificate` | 严格结论所覆盖的动作、世界、chance、规则和 horizon 的可核验摘要 | 一个 hash 命中或搜索深度 |
| `RiskProfile` | 0–100 风险参数及冻结的递归 epsilon-contamination 表 | HardGateStatus 或 Proof 资格 |
| `Policy` | 对 ActionRef/ActionKey 的确定性或 0–10000 定点概率分布 | 单一 `bestAction` 字段 |
| `Plan` | 绑定实体 generation、deadline、版本与失效条件的跨帧意图 | 已提交 command 或物理事实 |
| `Cache` | 有完整 semantic key、version、碰撞与失效合同的派生结果存储 | 任意跨帧全局变量 |
| `EntityHandle` | `entityType + slot + generation` 的内部 uint32 身份 | 外部 objectId、裸 slot |
| `AssociationRelation` | observation record 与 tracked entity 之间所有仍可能匹配的有界关系 | 贪心最近匹配、概率最高单匹配 |
| `ExactWorldSupport` | InformationState 中显式枚举且保持联合相关性的全部 possible world 子集 | top-K probability |
| `ResidualSupport` | 能无损恢复其代表的 possibility 与约束的符号 support | 被裁掉的低概率质量、独立边缘近似 |
| `common physical base` | 一个 InformationState 的所有 support world 在物理上相同的字段 | 双方都公开知道的 public state |
| `PhysicalHash` | 完整物理语义的 canonical hash；不含概率、策略或 raw arena identity | entity slot/generation 的简单拼接 |
| `decisionHash` | common physical + 完整 possibility/residual + 双方观察历史/partition + action relation；不含概率 | Value/Risk/Profile 组合 key |
| `informationHash` | decisionHash 加 ProbabilityBelief、residual probability 与 beliefVersion | 严格 Proof 的唯一 key |
| `ValueSearchKey` | informationHash加Risk/Eval/Model/SearchSemanticProfile版本的外部组合key；预算/runtime mode本身不定义值 | 写回PhysicalState的字段、把SearchBudgetProfile混入语义 |
| `platformFrame` | 平台规则使用的绝对帧号；所有 effect/entity deadline 的共同时间轴 | replay 数组下标 |
| `recordIndex` | 原始 replay `records[]` 的零基下标 | platformFrame、decisionPly |
| `decisionPly` | 搜索树中的决策层序号 | 自动帧数量、platformFrame |
| `phaseOrdinal` | 一个 platformFrame 内的规范 phase 顺序号 | event 的全局时间 |

`DRAW` 是合法终局值；`UNKNOWN_RULE` 不是终局结果，而是无法在当前冻结规则下确定终局的 resolution status。DD1 已统一 Terminal/Hard/Proof；DD2 已统一字段语义和候选整数 ABI；DD3 已冻结 TypedArray SoA、immutable delta 和 explicit stack 的基本物理 revision。旧文档中的裸 `ActionCode`、`HardStatus`、`HARD_SAFE` 和 `HARD_INVALID` 均为已废弃草案名，不得实现。

## 5. 源快照与可复现性

本次 DD0 扫描固定以下证据：

| 来源 | 固定标识 | DD0 用途与限制 |
|---|---|---|
| Agent Guide 本地快照 | SHA-256 `47016cf5f96ccbb69a8849dd0f2cbc14bbca49ed664e687d1d0e8b352d323d90` | API/规则文本；仍需 Updates 解决旧描述 |
| v1 当前工作副本 `tiny-tank-minimax.js` | 5,242 行；扫描时 SHA-256 `73e3ac74c0af04b883821bf8b745434cc08ce0b4574d7982dbd9a732e6e1fc14` | 能力、热点、失败机制候选；不是冻结发布源码 |
| v1 分析 `MINIMAX_ANALYSIS.md` | 1,325 行 | LegacyFinding 来源；不是规则合同 |
| 244 局冻结集 | corpus fingerprint `965dcfe90d3605e848485dfc0d1a6926e01d52118f299110f8ef6c1491e04e85` | 244 局、10,996 replay frames、10,752 决策帧、23 code hashes |
| 滚动历史语料 | MatchLedger + CorpusHead + immutable CorpusSnapshot fingerprint | 当前总数动态；每次分析/校准/发布绑定精确snapshot，不覆盖冻结244 |
| 平台能力样本 | `mat_ANGK6T283KC1fRBvV` | `Math.imul` absent 的真实SCRIPT_ERROR；Uint16Array/Uint32Array已运行，其他能力仍按profile校准 |
| v24 动作基线 | baseline code hash `3ab856526a07d23e0dc2a0c6c7ded4521dfdb70610fd4c76e54815bf63caca51` | 行为漂移与重建检查，不能提供分叉后反事实真值 |
| `cyhhao/agentank-simulator` | commit `1ef804eb2c187138c4c8e5229fb37cd0126beddf`；下载包 SHA-256 `b9498c1a7d8a2d5bcc015c05fe838ca5a87b7c211629884d3a830cfb6eae70a4` | 候选 transition、fixture、复合回归；不是官方实现 |
| `mythchen-1024/agentank-framework` | commit `b676a7f3b58a3d462635171c73632c00feeafab6`；下载包 SHA-256 `758eff1a11cd2762bd75c321c9705f136c62c36d14e9526305c9f438a522d232` | 构建/分析闭环参考；技能文件是空插槽，无物理真值 |

扫描时 v1 与设计目录处于未提交工作树；因此 SHA-256 只标识本次扫描内容，不替代发布 codeHash 或 corpus manifest。

### 5.1 v1 扫描摘要

v1 已经包含以下有价值的机制候选：

- 敌方 projectile 跟踪、overload 双弹推断、隐藏 tank/grass/cloak belief；
- 可见 bomb 规范化、blast、forced bomb death、技能 timed effect；
- simultaneous/joint action、敌方技能 action outcome、Minimax、评估器和运行时硬 guard；
- static ray、distance、attack lane、position feature、geometry 和 map identity 等缓存；
- 累计 runtime 计量以及 1,500ms/2,500ms 降级常量。

同时存在 v2 必须拒绝或重新设计的部分：Monte Carlo、深层对象状态复制、规则猜测、多个重复安全层和相互交叉的缓存/评分逻辑。扫描结果证明“行为和失败知识值得提取”，不证明 v1 的搜索核心或数据布局适合复用。

### 5.2 244 局不可变冻结语料摘要

- 244 局：173 胜、71 负；结果失败分布为 crashed 52、star 10、timeout 7、runtime 2；
- 52 个 crash 标签：grass shot 18、进入 immediate muzzle 7、在 immediate muzzle 下转向 7、进入 inflight bullet 6、在 inflight bullet 下转向 4、cloak shot 3、failed inflight dodge 3、停留 immediate muzzle 2、lost immediate trade 2；
- 聚合 replay runtime 为 200,530ms，平均 18.24ms/frame；该字段是历史平台记录，不等于本地 search benchmark；
- v24 离线差分报告的当前单决策中位 3.143ms、P95 9.992ms、P99 14.478ms；其 wall-clock 熔断被关闭，只能做相对性能证据。

这些数据直接支持 DD1 的 projectile/terminal fixture、DD7 的失败标签与对手事件、DD8 的 runtime 门和 DD9 的反事实 split，但不能直接转成 HardGateStatus。

### 5.3 simulator 扫描摘要

固定版本源码实现了 action queue、每帧两次 bullet substep、effect/bomb → A → B → bullet 的候选 phase、独立 projectile 数组、两 hit shield、技能状态机、deterministic seed 和 replay-like events。观察 API 仍只返回第一颗满足可见条件的 bullet。DD1 的平台 replay 校准已确认实际 bomb phase 位于双方 action 和 projectile 之后，因此该模拟器 phase 只能保留为已拒绝的历史候选。

其自带测试在允许创建 Node 子进程的环境中通过。该通过只证明固定 commit 内部实现与其测试一致。README 明确承认官方 runtime、随机星、同帧 kill 和 bullet crossing 等缺口，因此证据等级仍为 `EXTERNAL_SIM_MATCH`。

### 5.4 framework 扫描摘要

framework 提供按技能构建、Terser 发布、command commitment、profile signature 节流、日志契约、对局下载缓存、SQLite 关键事件/死亡窗口和报告工具。其 README 明确说明不是竞赛成品；`enemy-profiler.js` 与八个 `skills/*.js` 均为 TODO/默认空插槽。因此只继承工程闭环和离线 schema 思路，不继承 BT 根优先级为 v2 search 语义。

## 6. 遗产与外部项目的继承边界

### 6.1 v1 可以继承

- API 兼容案例、实体跟踪需求和隐藏威胁候选；
- 已出现的动作族、技能处理、Plan 生命周期需求；
- 性能热点、缓存候选、runtime/fallback 失败模式；
- 死亡窗口、击杀窗口和反事实起点；
- 作为 `LegacyPolicyAdapter` 与 v2 做离线 league。

不得继承为真值：v1 的 Monte Carlo、对象布局、规则猜测、静态分数、搜索 depth、同帧物理与任何未校准 terminal 判定。

### 6.2 244 局不可变快照与滚动语料可以继承

- factual replay 与事件顺序候选；
- 倒数窗口、因果链、事故分类、runtime 分布；
- 行为漂移基线和 immutable regression；
- 双向反事实的 checkpoint 前缀。

动作分叉后必须停止消费真实 replay 后缀。历史死亡只能先生成 `ACTION_REFUTED`/LegacyFinding；严格可避免或必死标签必须等待 Reference/Fast/Proof 覆盖。

新增对局只能append到ledger并生成新的head/snapshot；不得修改冻结244的hash、split或计数。技能和terminal字段必须保留provenance，已查看的post-244对局不能倒填为当前candidate的forward证据。

### 6.3 外部模拟器可以继承

- 可执行的对象模型和最小场景构造；
- 两步 bullet substep、动作队列、技能状态机等候选 RuleVariant；
- 固定 seed、镜像 seat、复合场景、整局压力与差分 harness 思路。

其 README 明确列出官方 runtime、随机星、同帧互杀和 bullet crossing 等缺口。poison 25、默认 300 帧和 per-turn VM timeout 明确不得进入平台规则。

### 6.4 framework 可以继承

- 按我方技能构建专用产物、保留敌方紧凑参数的构建方式；
- 稳定日志/分析 schema、缓存下载、SQLite 关键事件与死亡窗口工具链；
- 多帧 commitment 必须集中管理、profile 更新节流、tree signature 才重建等性能经验；
- source/minified、体积和发布闭环。

framework README 和代码都说明策略叶子、敌方画像和八种技能文件是 `TODO`/空插槽，因此不能证明技能、风险或 Minimax 语义。

## 7. 冲突处理流程

1. 为冲突建立 `OI-*`；
2. 标记它属于 R0–R3 规则问题或 ARCH 详细设计问题；
3. 指定目标 DD 阶段、所需 fixture/benchmark 和生产未解决行为；
4. 证据满足后建立或修改 `DEC-*`；
5. 更新 RuleRegistry/RULESET_VERSION 或对应 ABI 文档；
6. 运行 Reference、Fast、cache-off、source/minified 和 corpus 门；
7. 关闭 issue，但保留历史 decision 记录。

禁止直接在多个设计文档中各改一个版本。被本文件判定为“后续文档权威”的字段，在该后续文档冻结前必须引用 issue id，而不是复制临时定义。
