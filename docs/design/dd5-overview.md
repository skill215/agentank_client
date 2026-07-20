# DD5 Overview 与一致性审计

状态：DD5 COMPLETE（详细设计），2026-07-15。DD6 READY。

## 1. 阶段结论

DD5 已把 DD3 的物理 ABI 与 DD4 的可执行 RuleCorpus 连接为唯一高性能物理路径：

```text
构建期 RuleCorpus
  -> generated integer RuleTable
  -> Fast prepare/commit/undo
  -> committed SourcePlan/HazardTimeline
  -> ReverseViability/Deadline
  -> TerminalResolver
  -> action HardGateStatus
  -> fully undo
  -> Risk/Evaluator（只在 Hard 后）
```

本阶段冻结的核心不是某个深度或缓存大小，而是不可绕过的正确性顺序：每个 action 必须在评分前做候选物理转换；已存在 projectile/bomb 推进到规范失效，不受 Minimax 深度影响；禁入格只是共享 broad phase，严格拒绝仍需要完整死亡链、终局和 coverage。

危险明确拆成 Committed、Possible、Expected 三平面。敌方未来可能开火、草/隐身中的可能位置属于风险，不会被 HazardKernel 升级为“已经必死”。

## 2. 产物

| 产物 | 冻结内容 |
|---|---|
| [fast-kernel-contract.md](fast-kernel-contract.md) | 生成整数表、FastStatus、主 phase、prepare/commit/undo、模块复杂度与失败语义 |
| [hazard-kernel-contract.md](hazard-kernel-contract.md) | committed 生命周期、三危险平面、SourcePlan、禁入投影、ReverseViability、Deadline 与 Hard 聚合 |
| [reference-fast-differential-report.md](reference-fast-differential-report.md) | 21 fixture disposition、逐字段 comparator、hazard oracle、fault/performance matrix |
| 本文 | 阶段退出门、冲突审计与 DD6 准入 |

## 3. 退出门

| DD5 退出条件 | 设计结果 | 证据 |
|---|---|---|
| 热路径近零临时对象 | PASS | TypedArray SoA、整数 table/offset/status、无 Map/Set/array allocation |
| 热函数复杂度有界 | PASS | Scheduler/Entity/Terrain/Terminal/Observation/Hazard/Reverse 表已给出 |
| make/unmake 完整 | PASS | prepare-reserve-write、generated BranchMark、owner 逆序 undo、root signature guard |
| Reference/Fast fixture 一致性可判定 | PASS | 21 fixture 全部 exact/common/unsupported disposition，逐 event/state/observation/terminal 比较 |
| committed hazard 不受 depth 截断 | PASS | source 创建到 canonical stop；closure horizon 与 search depth 分离 |
| action 在评分前验证 | PASS | Fast candidate → hazard/reverse → terminal → aggregate → undo → score |
| 容量不足不截断事实 | PASS | entity/event/delta/observation/hazard/reverse 均 explicit incomplete + undo |
| UNKNOWN 不进入严格结论 | PASS | variant-dependent Fast unsupported；Hard incomplete；cache miss=recompute |

这些是详细设计退出门。尚未实现的 JavaScript Reference/Fast 不能被本文宣称为 execution PASS；实现合并门已在 differential report 明确列为零 divergence、零 partial mutation、零 strict false-positive。该边界与“设计通过后再拿代码”的要求一致。

## 4. Hard 语义一致性

### 4.1 已提交危险

- 已创建 projectile/bomb 在每个 PhysicalWorld 中是 committed fact；
- 可见性消失、搜索缩深或 fallback 不删除它；
- 每颗 overload projectile 独立 handle/plan/失效；
- trajectory/blast 可缓存到撞墙、命中土堆/盾/坦克、边界或爆炸完成；
- terrain/event 变化只使依赖后缀失效。

### 4.2 可能危险

- 对手未 FIRE 但有合法 FIRE，只形成 loss witness/PossibleHazard；
- 草、cloak、未确定 projectile/bomb 位置按 HiddenWorld support 分开；
- 单 world loss、另一个 world 可活时不产生 `HARD_REJECT_PROVEN`；
- risk=0 的最坏风险选择仍由 DD6 目标控制，不污染物理证明。

### 4.3 终局

- tank crash 不是直接 LOSS，必须完成 damage batch 后按 single/mutual、stars、runtime 解析；
- 开火后是否可躲由 phase-accurate ReverseViability 判断，不用距离阈值冒充 Proof；
- `HARD_REJECT_PROVEN` 仍遵守 HiddenWorld、EnemyAction、ChanceOutcome 三独立量词；
- coverage 不完整一律 `HARD_INCOMPLETE`。

因此 DD5 没有扩大或削弱 DD1 的 InevitableLoss 定义，只给它提供可高性能复用的物理证书。

## 5. 跨文档冲突审计

| 主题 | 潜在冲突 | DD5 处置 | 当前权威 |
|---|---|---|---|
| Fast 与 Reference 共享实现 | 共享 helper 会让差分同时出错 | 只共享 schema/id/input/comparator，实现独立 | Reference/Fast contracts |
| Hazard shortcut 与真实 physics | 禁入 bit 可能误当规则 | bit 只 broad phase；实际 Fast+Terminal 核验 | Hazard contract |
| Hard 与 risk | 可能开火被当必死 | 三平面隔离；Possible/Expected 不写 strict Hard | Terminal algebra + Hazard |
| search depth 与 entity lifetime | fallback 缩深可能删 projectile/bomb | committed closure 独立推进到失效 | Hazard contract |
| Physical death 与 terminal loss | 双 crash 被错误短路 | 完整 batch + TerminalResolver | Terminal algebra |
| world loss witness 与信息态必输 | 单个 hidden world 被普遍化 | per-world 证书后按完整量词聚合 | Hazard contract |
| SourcePlan 与 DD7 Plan | 同名“计划”可能混淆 | SourcePlan 是物理派生索引；ShotPlan/BombPlan 是跨帧策略意图 | Hazard contract；DD7 plan owner |
| Hazard cache 与 DD8 cache inventory | DD5 似乎提前冻结 cache | 只冻结 semantic key/lifecycle/miss=recompute；容量/替换/配额仍 DD8 | Cache contract |
| RuleVariant 与 Fast | 节点内展开 variants 会拖慢且混义 | 构建时 common projection；分歧时 unsupported | Fast contract |
| projectile crossing | 用户确认但非最高严格证据 | Fast 物理可按 assumption 构建；strict certificate 要 assumptionMask=0 | RuleCorpus + Hazard |
| 128 frame | 旧 before-action candidate | recordIndex127 全 phase 后 terminal | DD4 RuleCorpus + Fast phase |

未发现需要回退 DD1–DD4 的语义冲突。剩余规则 variants 继续是显式生产能力边界，不由 DD5 猜测关闭。

## 6. 21-fixture coverage 审计

DD4 的 21 个 fixture 均已进入差分矩阵：

- 11 个 exact 或 exact-qualified 主路径；
- 5 个在不触发 variant 时 common、触发时 unsupported；
- 5 个明确 variant-dependent unsupported disposition；
- R2 future star 无 fixture且继续排除在 exact physics/proof。

计数是 disposition 归类，不是尚未运行实现的通过数。所有 unsupported case 都要求 no partial event/state + full undo，避免“性能优化”悄悄选择一个规则。

## 7. 尚未关闭但不阻塞 DD6 的项目

- move/star/shared projectile/bomb contest、runtime exact tie、timeout comparator：Fast 在依赖输入上 unsupported；
- poison/ freeze/boost empty repoll、teleport reveal deadline：common path 以外 incomplete；poison非空队列相对cadence exact；
- stun/teleport probability：Fast 只执行 ChanceCode；DD6 Value 使用 interval，Proof 穷举 support；
- future star：DD7 soft model，不进入 Hard/Proof；
- production capacity、timeline horizon上限、cache size和 engine microbenchmark：DD8；
- JavaScript Reference/Fast implementation differential：实施阶段合并门；不反向改变设计语义。

这些项目都有明确 owner 和失败行为，没有“以后再说”的隐式默认。

## 8. DD6 准入

DD6 可以开始，因为：

1. Physical/InformationState、EnemyAction/HiddenWorld/ChanceOutcome 边界已固定；
2. 每个搜索 branch 有确定 physical apply/undo 或 explicit incomplete；
3. Terminal、Hard 和 Proof 量词已冻结，Hazard 提供严格 committed closure；
4. unknown rule、support overflow 和 capacity failure 都能传播为区间/unknown，不需伪造 value；
5. Result/Policy/Coverage、0–10000 概率和显式栈 ABI 已冻结；
6. Fast/Hazard 不读取 RiskProfile、OpponentModel 或 wall clock，DD6 可在其上独立定义 pure bounds、matrix、Proof 和 risk backup。

DD6 必须先冻结完全可观察 pure lower/upper，再做受限矩阵和 InformationState；之后实现 AND/OR Proof、递归 epsilon-contamination 和根 safe exploitation。不得先用 evaluator 或对手概率填补物理/Proof unknown。
