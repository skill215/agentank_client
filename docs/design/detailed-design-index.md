# 详细设计索引与阶段状态

状态：DD0–DD10详细设计全部完成，2026-07-17；IMP0–IMP8均已 ACCEPTED。IMP8 通过预注册 V6 在完整 Calibration 分母选择路径控制 D3 Candidate，完成可重复冻结、63 图/252 场 G10A 和 40 场 Discovery-only 技能回归。IMP9 已执行真实 context GET 与 cold-smoke simulate；精确 Candidate 在平台 3012ms timeout，故 Exact Simulation FAIL、无 attestation、无 publish、无 challenge。10 个未解决 RuleVariant 继续显式 UNKNOWN，平台脚本字节上限和 runtime 校准仍是 release blocker，发布状态 `NOT_RELEASE_ELIGIBLE`。阶段顺序以 [detailed-design-roadmap.md](detailed-design-roadmap.md) 为准。

## 1. 当前状态

| 阶段 | 状态 | 当前结论 |
|---|---|---|
| DD0 规范收口 | **COMPLETE** | 权威、术语、decision、open issue 和文档模板已建立 |
| DD1 调度/时间线/终局 | **COMPLETE** | action/queue、主 phase、terminal/proof algebra 和 UNKNOWN 行为已冻结 |
| DD2 状态/观察/ABI | **COMPLETE** | 根协调、实体身份、联合 world support、统一整数 ABI 和容量 schema 已冻结 |
| DD3 真实负载原型 | **COMPLETE** | immutable delta、TypedArray SoA、explicit stack、lossless residual 与 BranchMark 已冻结 |
| DD4 Reference/校准 | **COMPLETE** | Reference 合同、可执行 RuleCorpus、平台/external 差异和 UNKNOWN 行为已冻结 |
| DD5 Fast/硬物理 | **COMPLETE** | generated RuleTable、Fast apply/undo、三危险平面、ReverseViability 与差分矩阵已冻结 |
| DD6 Proof/Value/Risk | **COMPLETE** | pure interval、restricted matrix、InformationState Proof、三维risk与mixed policy已冻结 |
| DD7 策略/评分/技能/Plan | **COMPLETE** | Evaluation、Strategy、Opponent、Skill descriptor与Plan已冻结 |
| DD8 Cache/时间/构建 | **COMPLETE** | 11-cache inventory、Runtime/fallback、Emergency和build合同已冻结 |
| DD9 历史/平台/发布门 | **COMPLETE** | corpus/split/counterfactual/release matrix与全局审计已冻结；实施阻塞如实保留 |
| DD10 滚动语料/平台运行 | **COMPLETE** | 动态ledger/snapshot、技能provenance、capability、simulate/publish/challenge/download/analyze状态机与两级发布门已冻结 |

## 2. DD0 产物

| 文档 | 作用 |
|---|---|
| [design-authority.md](design-authority.md) | 按问题域定义权威、术语、证据层级和遗产边界 |
| [decision-register.md](decision-register.md) | 保存已接受决策、provisional 方向和待关闭冲突 |
| [open-issues-register.md](open-issues-register.md) | R0–R3/ARCH 问题、证据、阶段 owner 和未解决行为 |
| 本文 | 阶段状态、文档 owner、模板和下一阶段准入 |

## 3. 现有架构文档的职责

| 文档 | 当前职责 | 冻结状态 |
|---|---|---|
| [README.md](README.md) | 设计目标、范围、阅读入口 | 目标已确认；不是 ABI 权威 |
| [high-performance-architecture.md](high-performance-architecture.md) | 性能原则、运行模式、模块边界 | 原则有效；DD3 基本物理 ABI 已冻结 |
| [kernel-interfaces.md](kernel-interfaces.md) | Kernel API 与数值调用边界 | DD3 已冻结 offset/handle + TypedArray SoA + explicit stack 形状 |
| [memory-layout.md](memory-layout.md) | Arena/TypedArray 物理合同 | DD3 revision 1 已冻结；生产数值容量待实现benchmark |
| [search-semantics.md](search-semantics.md) | 行为流水线、HardGate/风险/Plan 语义总览 | DD6/DD7规范已同步 |
| [hybrid-solver-contracts.md](hybrid-solver-contracts.md) | 搜索量词、混合 solver、Proof/Risk 的算法权威 | 算法语义权威；物理 Result/Policy 边界已由 DD3 冻结 |
| [cache-contracts.md](cache-contracts.md) | cache 正确性通用原则 | 唯一清单已转DD8 Cache Inventory |
| [rules-registry.md](rules-registry.md) | 规则来源、可信度、RuleVariant | DD4 已同步 executable corpus；持续接收更高等级证据 |
| [simulator-integration-contract.md](simulator-integration-contract.md) | 外部模拟器边界和差分方式 | 有效 |
| [legacy-evidence-contract.md](legacy-evidence-contract.md) | v1/244不可变快照、死亡窗口和反事实原则边界 | 有效；动态新增内容由DD10 rolling corpus接管 |
| [benchmark-contract.md](benchmark-contract.md) | micro/composite/full-game/terminal/发布验证 | 原则有效；具体参数门限待实现预注册 |
| [detailed-design-roadmap.md](detailed-design-roadmap.md) | DD0–DD10 顺序和阶段门 | 过程权威 |

## 4. DD1 产物

| 文档 | 作用 |
|---|---|
| [action-scheduler-contract.md](action-scheduler-contract.md) | program/queue/executed action、boost 复合执行和四阶段动作流水线 |
| [frame-timeline-contract.md](frame-timeline-contract.md) | 规范 phase、ordered Event、时间坐标和有限 RuleVariant |
| [terminal-proof-algebra.md](terminal-proof-algebra.md) | terminal 优先级、HardGate、ForcedWin/Nonloss/Loss 量词和证书 |
| [rule-corpus-schema.md](rule-corpus-schema.md) | Rule/Fixture schema、UNKNOWN 消费者矩阵和 R0 variant inventory |

## 5. DD2 产物

| 文档 | 作用 |
|---|---|
| [observation-reconciliation-contract.md](observation-reconciliation-contract.md) | 平台输入一次性整数化、null 语义、TrackedState 与根协调 |
| [entity-data-association-contract.md](entity-data-association-contract.md) | type/slot/generation handle、外部 ID 边界、歧义关联和实体生命周期 |
| [information-state-storage-contract.md](information-state-storage-contract.md) | PhysicalWorld 字段、immutable worlds、联合 support、residual 和 enemy partition |
| [action-result-abi.md](action-result-abi.md) | Command/Action/Event/Result/Policy/Coverage/PRNG 候选整数 ABI |
| [memory-capacity-manifest-schema.md](memory-capacity-manifest-schema.md) | arena/array/formula/overflow/构建字节清单 schema |

## 5.1 DD3 产物

| 文档/原型 | 作用 |
|---|---|
| [architecture-prototype-plan.md](architecture-prototype-plan.md) | workload、A/B、oracle、故障注入与决策规则 |
| [architecture-prototype-report.md](architecture-prototype-report.md) | 两档正确性、性能、bytes/high-water 和选型证据 |
| [dd3-frozen-abi.md](dd3-frozen-abi.md) | world、support、TypedArray、stack、BranchMark 与 cache 接口的规范 revision |
| [dd3-overview.md](dd3-overview.md) | 阶段退出门、跨文档冲突审计与 DD4 准入 |
| [dd3-capacity-profiles.json](dd3-capacity-profiles.json) | corpus lower-bound 与 conservative build 配置 |
| [architecture-prototype.js](../../prototypes/dd3/architecture-prototype.js) | 独立可执行纵向原型；不进入 production bundle |

## 5.2 DD4 产物

| 文档/数据 | 作用 |
|---|---|
| [reference-kernel-contract.md](reference-kernel-contract.md) | 独立 ReferenceState、phase 算法、canonical trace、observation 与 terminal |
| [dd4-rule-corpus.json](dd4-rule-corpus.json) | 规则、variant、fixture、handler/adapter binding 与 build gate |
| [rule-calibration-report.md](rule-calibration-report.md) | 官方/平台/external 差分、R0/R1/R2 处置和生产行为 |
| [dd4-overview.md](dd4-overview.md) | 阶段一致性、冲突审计与 DD5 准入 |

## 5.3 DD5 产物

| 文档 | 作用 |
|---|---|
| [fast-kernel-contract.md](fast-kernel-contract.md) | generated integer RuleTable、FastStatus、phase execution 与 prepare/commit/undo |
| [hazard-kernel-contract.md](hazard-kernel-contract.md) | committed/Possible/Expected 隔离、SourcePlan、禁入、ReverseViability 与 Deadline |
| [reference-fast-differential-report.md](reference-fast-differential-report.md) | 21 fixture disposition、逐字段 comparator、hazard oracle 与 fault/performance matrix |
| [dd5-overview.md](dd5-overview.md) | DD5 退出门、跨文档冲突审计与 DD6 准入 |

## 5.4 DD6 产物

| 文档 | 作用 |
|---|---|
| [value-search-contract.md](value-search-contract.md) | terminal/horizon interval、leaf、serialized pure bounds与anytime |
| [matrix-policy-contract.md](matrix-policy-contract.md) | critical-node restricted matrix、Double Oracle、integer regret与Policy |
| [proof-search-contract.md](proof-search-contract.md) | InformationState AND/OR/DFPN、双方strategy consistency与Coverage |
| [risk-backup-contract.md](risk-backup-contract.md) | chance/hidden/enemy递归ε-contamination、dynamic risk与safe floor |
| [dd6-overview.md](dd6-overview.md) | DD6退出门、风险冲突关闭与DD7准入 |

## 5.5 DD7 产物

| 文档 | 作用 |
|---|---|
| [evaluation-contract.md](evaluation-contract.md) | feature registry、cost/dependency、raw/weight与Evaluator A/B |
| [strategy-selector-contract.md](strategy-selector-contract.md) | primary/modifier、阶段、profile选择和hysteresis |
| [opponent-model-contract.md](opponent-model-contract.md) | opportunity/choice、fast/slow、risk preference与nominal action policy |
| [skill-state-machine-contract.md](skill-state-machine-contract.md) | 八技能generated descriptor、own specialization与enemy lookup |
| [plan-contract.md](plan-contract.md) | PlanSketch/PersistentPlan、Shot/Bomb/Skill、dirty/cache/Hard revalidation |
| [dd7-overview.md](dd7-overview.md) | DD7退出门、软/硬冲突审计与DD8准入 |

## 5.6 DD8 产物

| 文档/数据 | 作用 |
|---|---|
| [cache-inventory.md](cache-inventory.md) | 11 canonical cache、key/cutoff/collision/lifecycle/off语义 |
| [dd8-cache-inventory.json](dd8-cache-inventory.json) | 机器可检查inventory和旧名alias |
| [runtime-fallback-contract.md](runtime-fallback-contract.md) | Capability选择wall-clock/校准work counter、1500/2500等价门、callback watchdog、fallback Minimax与EmergencyReserve |
| [production-build-contract.md](production-build-contract.md) |生成函数/CLI、专门化、strip、source-minified与manifest |
| [dd8-overview.md](dd8-overview.md) | DD8退出门、性能冲突审计与DD9准入 |

## 5.7 DD9 产物

| 文档/数据 | 作用 |
|---|---|
| [legacy-corpus-manifest.md](legacy-corpus-manifest.md) | immutable corpus、相关组、角色、防泄漏与源码支持合同 |
| [dd9-legacy-corpus-manifest.json](dd9-legacy-corpus-manifest.json) | 244局/732文件hash、split、quarantine和23 codeHash机器清单 |
| [counterfactual-validation-contract.md](counterfactual-validation-contract.md) | DualTrack、Window、Checkpoint、分叉、双向标签和Result schema |
| [release-gate-report.md](release-gate-report.md) | 七层evidence matrix、G0–G11、canary/final两级门与当前NOT_RELEASE_ELIGIBLE判定 |
| [dd9-overview.md](dd9-overview.md) | DD9退出门、corpus/反事实/发布冲突审计 |
| [dd0-dd9-consistency-audit.md](dd0-dd9-consistency-audit.md) | DD9时点历史审计；活动结论已由DD10审计接管 |

## 5.8 DD10 产物

| 文档/数据 | 作用 |
|---|---|
| [rolling-corpus-contract.md](rolling-corpus-contract.md) | append-only MatchLedger、动态Head、不可变Snapshot、稳定追加分组与skill/terminal provenance |
| [platform-operations-contract.md](platform-operations-contract.md) | build/simulate/publish/challenge/download/analyze函数、CLI、状态机、错误与artifact目录 |
| [dd10-platform-run.schema.json](dd10-platform-run.schema.json) | Candidate/Simulation/Publish/Challenge/Ingest/Analysis RunManifest机器合同 |
| [dd10-platform-capability.schema.json](dd10-platform-capability.schema.json) | JavaScript/API/字节/运行限制事实、证据与fingerprint机器合同 |
| [dd10-tank-registry.schema.json](dd10-tank-registry.schema.json) | v1/v2/未来tank的非密钥profile、secretRef、skill与branch baseline机器合同 |
| [dd10-corpus.schema.json](dd10-corpus.schema.json) | Ledger/Policy/Head/Snapshot/Cohort/Forward六类artifact机器合同 |
| [artifact-lineage-contract.md](artifact-lineage-contract.md) | Build→Candidate→Run→Evidence血缘、canonical hash和精确发布字节同一性 |
| [dd10-overview.md](dd10-overview.md) | DD10退出门、修订范围和实施阻塞 |
| [dd0-dd10-consistency-audit.md](dd0-dd10-consistency-audit.md) | 活动owner、不变量、冲突与发布循环审计 |

## 5.9 实施交接产物

| 文档 | 作用 |
|---|---|
| [final-implementation-readiness-audit.md](final-implementation-readiness-audit.md) | 最终遗漏/冲突/可实施性审计与`IMPLEMENTATION_READY`判定 |
| [implementation-plan.md](implementation-plan.md) | IMP0–IMP10代码、工具、benchmark、平台与发布实施顺序和阶段门 |
| [imp-acceptance-contract.md](imp-acceptance-contract.md) | IMP0–IMP10逐阶段独立验收标准、状态和证据规则 |

## 6. 阶段产物对照

| 阶段 | 必须产物 | 主要关闭项 |
|---|---|---|
| DD1 | `action-scheduler-contract.md`、`frame-timeline-contract.md`、`terminal-proof-algebra.md`、`rule-corpus-schema.md` | OI-R0-*、OI-ARCH-003/004/005 |
| DD2 | 五份 DD2 规范合同 | OI-R0-010 设计部分、OI-ARCH-006/010/011；ARCH-001/002 待 DD3 验证关闭 |
| DD3 | `architecture-prototype-plan.md`、`architecture-prototype-report.md`、冻结后的 ABI revision | DEC-0101/0102/0106，OI-R3-005 |
| DD4 | `reference-kernel-contract.md`、`rule-calibration-report.md`、可执行 RuleCorpus | OI-R0/R1/R2 的平台证据与 RuleVariant |
| DD5 | `fast-kernel-contract.md`、`hazard-kernel-contract.md`、Reference/Fast differential report | committed entity、make/undo、Hard 物理正确性 |
| DD6 | `proof-search-contract.md`、`value-search-contract.md`、`risk-backup-contract.md`、`matrix-policy-contract.md` | OI-ARCH-009、OI-R3-001/003；实现 DD1 proof algebra 和 DD2 Policy ABI |
| DD7 | `evaluation-contract.md`、`strategy-selector-contract.md`、`opponent-model-contract.md`、`skill-state-machine-contract.md`、`plan-contract.md` | OI-R3-002/006、OI-ARCH-008/014 |
| DD8 | `cache-inventory.md`、`runtime-fallback-contract.md`、`production-build-contract.md` | OI-ARCH-007、OI-R3-004/005/007 |
| DD9 | `legacy-corpus-manifest.md`、`counterfactual-validation-contract.md`、`release-gate-report.md`、两个overview/audit | OI-ARCH-012/013；ARCH-014 schema部分、平台前向发布门 |
| DD10 | rolling corpus/platform ops、TankRegistry/Capability/Run/Corpus schemas、artifact lineage、overview/audit | OI-PLAT-*、OI-ARCH-015/016/017/018；动态证据、多tank隔离与平台操作门 |

## 7. 所有详细设计文档的统一模板

每份文档至少包含：

1. `Status / phase / normative owner`；
2. scope 与明确 non-goals；
3. 引用的 DEC/OI/rule ids；
4. 输入、输出、错误和 incomplete 行为；
5. 状态字段表：owner、类型/单位、生命周期、hash、undo、observation；
6. ordered algorithm 或 state machine；
7. legality、Hard、Terminal、Proof 和 UNKNOWN 边界；
8. 最坏循环、容量、事件/delta 上限、堆分配和时钟访问；
9. cache semantic/version inputs 与失效；
10. fixture、性质测试、差分、benchmark 和验收门；
11. 未解决项及其生产行为；
12. 变更影响：RULESET_VERSION、ABI version、cache invalidation 和 bundle。

只有参数表而没有状态机/phase，或只有伪代码而没有错误、容量和 UNKNOWN 行为，均不算详细设计完成。

## 8. DD1 完成摘要

1. RuleCorpus schema、最小 Action/Event 词典和 R0 variant inventory 已建立；
2. command queue、NodeKind 与 boost 复合执行已定义；
3. 平台 replay 已把主 FrameTimeline 冻结为 action-before-projectile-before-bomb，并否定外部模拟器的 bomb-before-action；
4. SubmissionLegality、ExecutionStatus、HardGateStatus 和 TerminalResolution 已分离；
5. ForcedWin/Nonloss/Loss/InevitableLoss/ActionRefuted 已有对称量词与 CoverageCertificate；
6. 所有剩余 R0 未知均为有限 variant，且 Reference/Fast/Proof/Value/emitter 行为明确；
7. OI-ARCH-003/004/005 已关闭，DD2 可以开始。

## 9. DD2 完成摘要

1. 平台对象只在根 Adapter 使用，ObservedRoot/TrackedState 不持有可变外部引用；
2. null、字段缺失、invalid 和物理不存在已分离；
3. entity handle 与外部 objectId 分离，多 projectile/bomb 的歧义关联保留为关系；
4. InformationState 保存联合 immutable world support，top-K 不能删除 Possibility；
5. CommandCode、ActionRef、ActionKey 与 ExecutedFrameAction 已分层；
6. ResultArena 统一支持 HardGate、Proof、上下界、Expected/Robust 和 mixed policy；
7. 容量 overflow 按事实、support、搜索质量、cache 和输出分级，无静默截断；
8. OI-ARCH-006/010/011 已关闭，ARCH-001/002 进入 DD3 真实负载验证。

## 9.1 DD3 完成摘要

1. 真实复合 workload 覆盖多实体、隐藏关联、partition、matrix、terminal 和 mixed policy；
2. snapshot/delta、typed/packed、recursive/stack、explicit/residual、cache off/on 均有语义 oracle；
3. multi-world 冻结为 immutable delta，singleton 保留同核 fast path；
4. 热池冻结 TypedArray SoA，搜索冻结显式预分配栈；
5. exact prefix 与 lossless residual 分工明确，Possibility 不被 top-K 裁剪；
6. Event/Delta/Result/Policy/BranchMark 失败和撤销合同已形成端到端实现证据；
7. OI-ARCH-001/002 已关闭，OI-R3-005 等待 DD8 平台复核；
8. DD4 READY，synthetic prototype 不具平台规则权威。

## 9.2 DD4 完成摘要

1. ReferenceKernel 与 FastKernel 实现独立，共享 canonical semantics 而不共享 helper；
2. replay fixture 可以固定 replayHash 通过 prefix-to-state 重建，未知字段不会被后缀补值；
3. overload 两弹固定正轴垂直偏移与独立生命周期已获平台证据；
4. 128 records 的最后 record 完整执行后才按 star/runtime 结算；
5. R1 skill event family 已闭合，未确认 probability/deadline 全部显式；
6. 外部 simulator 的 bomb phase、poison25、frame300 等默认值明确拒绝；
7. 规则/variant/fixture/handler/adapter 引用闭合；
8. DD5 只能实现 confirmed/common path；该约束已由 DD5 generated table/unsupported 合同落实。

## 9.3 DD5 完成摘要

1. FastKernel 只消费构建期整数 RuleTable，开发期 RuleVariant 不进入节点热循环；
2. apply 前预留 event/delta，所有 incomplete/异常 fully undo 并核验 root signature；
3. Committed/Possible/Expected hazard 三平面完全隔离；
4. projectile/bomb 从创建到 canonical stop 保持在 state/SourcePlan，不受 search depth 影响；
5. 禁入格只做 broad phase，严格结论经 ReverseViability 与 TerminalResolver；
6. 开火后可闪避、shield、多 projectile、bomb、mutual crash 与 multi-world aggregation 均有性质门；
7. DD4 21 fixtures 已逐项分为 exact/common/unsupported，unknown 不产生部分 state或严格结论；
8. DD6 READY，可在确定 Fast/Hard/incomplete 边界上定义 pure bounds、matrix、Proof 和 risk。

## 9.4 DD6 完成摘要

1. 深层pure search只提供sound lower/upper，普通evaluator point不冒充terminal bound；
2. 根/关键节点matrix用完整双方best-response scan收紧Double Oracle gap；
3. fixed integer regret输出average mixed policy，初始top-K不会永久裁support；
4. InformationState Proof保持我方/敌方各自observation strategy consistency；
5. DFPN只补全AND/OR图，unknown/heuristic/probability pruning不产生strict结果；
6. risk拆为chance/hidden/enemy三维递归rho并由stateRiskClass动态查表；
7. root expected只在同一certified robust safeFloor内零损失tie-break，OI-ARCH-009关闭；
8. DD7 READY，软模块已有明确value/risk入口和Hard/Proof禁区。

## 9.5 DD7 完成摘要

1. raw features与weights分离，成本层/依赖/unknown/envelope资格明确；
2. Strategy在root动态选择profile，以margin/dwell防抖，强制层优先；
3. 对手risk/fire/skill概率由confirmed opportunity/choice和fast/slow/confidence产生；
4. 局中只更新OpponentModel，不在线训练我方weights/risk table；
5. 双方skill公开，我方专门化、敌方整数descriptor不扩大节点身份分支；
6. hidden threat进入soft risk/信息控制，不生成committed Hard；
7. PlanSketch避免高频攻击候选复制数据，PersistentPlan/SourcePlan owner分离；
8. DD8 READY，可按已知访问模式冻结cache、runtime/fallback和build。

## 9.6 DD8 完成摘要

1. Cache inventory只有11个canonical id，旧Physics/Information/Value/Transition别名不再冲突；
2. 每cache有完整key/value/cutoff/collision/lifecycle，off/full均重算；
3. Search semantic与budget profile分离，normal/fallback可安全共享complete结果；
4. 当前以校准work counter实现1500/2500ms等价门，fallback永久latched；500ms reserve与单callback 1500ms watchdog独立；
5. fallback仍是benchmark-selected Minimax，depth不固定2且Hard/Terminal不可缩减；
6. build由函数/CLI生成one-own-skill普通单文件JS，八enemy descriptor直接查；
7. Reference/replay/simulator/v1/log/命名数据剥离，source/minified全语义差分；
8. DD9现已完成；实现/平台byte/runtime/forward证据仍如实作为release blocker。

## 9.7 DD9 完成摘要

1. `LEGACY-244-20260715.1`、732 artifact roots和机器manifest冻结；
2. 162个相关组稳定分为125 Discovery、56 Calibration、63 Frozen，Forward保留post-build；
3. 252快照新增8局不污染244版本；DD10活动ledger将其登记为`DISCOVERY_APPEND`，不作forward；
4. 23个历史codeHash支持矩阵确认只有v20具备hash-exact源码；
5. 双方Truth/Observed、Failure/Positive、BidirectionalCheckpoint和Result schema冻结；
6. 分叉后replay suffix严格失效，双方avoidability直接使用DD6量词；
7. 函数/复合/全景/终局/完整对局/source-minified/platform forward在DD9定义为G0–G10；DD10增加G11并修复首次发布循环；
8. DD9快照设计完成；活动一致性结论以DD10审计为准。

## 9.8 DD10 完成摘要

1. 历史总量不再固定：append-only ledger生成可变Head，所有实验绑定不可变Snapshot；
2. post-244已查看对局统一为`DISCOVERY_APPEND`，forward必须在candidate和采集计划预注册后生成；
3. skill字段有明确provenance，未施法/缺失不能折成none；missing runtime不填0；
4. Poison相对`ACT-HOLD-ACT-HOLD` cadence已确认，仅empty-repoll边界未知；
5. 平台CapabilityProfile确认`Math.imul` absent，生产改用经差分的shift/add整数实现；
6. build、服务器simulate、publish、challenge、download和analyze由统一函数/薄CLI及RunManifest编排；
7. 下载原子化并带hash，429/401/网络/未知mutation结果有明确恢复和reconcile流程；
8. `CANARY_PUBLISH_ELIGIBLE`与`RELEASE_ACCEPTED`分离；IMP9 runner与离线reconcile已实现并按零容忍策略fail-closed。当前冻结Candidate因官方cold-smoke在3012ms超时而不具备发布资格，且未执行publish/challenge。

## 10. DD0 完成检查

- 核心术语有唯一含义；
- 已确认政策与未知平台规则分开；
- 当前 Terminal、Hard、Result、Cache、InformationState 冲突全部有 ID；
- R0–R3 问题都有目标阶段、证据和未解决行为；
- v1、244 局、模拟器、framework 的可继承与禁止继承边界明确；
- DD1 有明确产物、顺序和退出门。
