# DD0–DD9 全局详细设计一致性与冲突审计

状态：历史审计，2026-07-16。本文保留 DD0–DD9 当时结论；活动一致性结论已由 [dd0-dd10-consistency-audit.md](dd0-dd10-consistency-audit.md) 接管。涉及固定总数、post-244 quarantine、技能 null、平台能力和发布/forward 顺序的内容不得再作为现行规范。

## 1. 审计目标

本审计检查：

1. 同一概念是否有多个权威或互斥定义；
2. Hard、Proof、Risk、Eval 是否越层；
3. PhysicalState、InformationState、历史 Truth/Observed 是否泄漏或压扁；
4. 物理实体、Plan、cache、search depth 的生命周期是否混淆；
5. normal/fallback/emergency 是否改变规则语义；
6. v1/replay/simulator 是否越权成为平台真值或生产依赖；
7. 设计完成、实现通过和发布通过是否被错误等同。

## 2. 单一权威链

| 问题域 | 唯一规范 owner | 下游只允许引用 |
|---|---|---|
| 术语、证据层级、阶段 | DD0 Authority/Register/Roadmap | 全部阶段 |
| Action/queue/phase/terminal/proof algebra | DD1 | DD2–DD9 |
| State/observation/entity/action/result ABI | DD2 + DD3 物理冻结 | DD4–DD9 |
| 平台规则与 Reference 资格 | DD4 RuleCorpus/Calibration | Fast/Search/历史工具 |
| Fast transition、Hard hazard、viability | DD5 | DD6–DD9 |
| Value/Matrix/Proof/Risk 量词 | DD6 | Strategy/反事实/发布 |
| Eval/Strategy/Opponent/Skill/Plan | DD7 | Runtime/历史校准 |
| Cache/Runtime/Fallback/Build | DD8 | 发布与生产 |
| Corpus/Counterfactual/Release evidence | DD9 | 实施和发布报告 |

旧总览文档保留解释作用，但出现差异时必须服从上述 owner。没有任何 DD9 文档重新定义 FrameTimeline、Terminal、Proof 或 Risk。

## 3. 全局不变量

### I1 每个动作先物理后评分

所有候选 ActionProgram 必须先 legality/prepare、Fast apply、Terminal/Hard 和 committed closure，再进入 Value/Risk/Eval。最终统一 validator 不是第一道安全门。

### I2 Hard 只处理事实或完整证明

已存在 projectile/bomb、确定非法和 InevitableLoss 可硬拒绝；敌方“可能开火”、草丛/隐身/盲区威胁、OpponentModel 概率只进 HiddenWorld/Risk。风险值 0 也不能把可能性改写成 committed fact。

### I3 ForcedWin 与死亡链使用同一物理规则、不同目标

直接胜利先检查；不能躲闪由 ReverseViability/phase/行动机会证明，不由距离阈值。若胜利未证明，死亡/安全链仍完整运行；ForcedLoss 不自动等于 Hard InevitableLoss。

### I4 InformationState 不等于一个猜测 PhysicalState

完整 support、top-K probability 和 lossless residual 并存；我方与敌方各遵守自身 observation partition。Proof 不能读取 TruthState，也不能在同一 information set 按 world 选择不同动作。

### I5 strict 与 soft 结果不互相冒充

Pure search 返回 sound interval；关键节点 restricted matrix 只在 full best-response 完成后收紧；DFPN 只闭合完整 AND/OR；epsilon-contamination risk 和 expected tie-break 永不生成 Proof。

### I6 实体事实、物理 SourcePlan 与意图 Plan 分离

projectile/bomb 事实持续到撞墙、命中土堆/实体、边界、爆炸或 terminal。SourcePlan 可缓存其轨迹；PlanSketch/PersistentPlan 只保存行动意图。cache miss/淘汰不允许让实体或危险消失。

### I7 cache 只提升速度

11 个 canonical cache 都有 miss/recompute 或 warm-start 语义；关闭任一 cache 不改变 Terminal/Hard/Proof/Value 的定义。事实/support/output 不能因 cache 容量截断。

### I8 fallback 只减少工作量

1.5 秒后永久 fallback，仍使用同一 RulesKernel、Terminal、每动作 Hard 和 committed closure；深度由 benchmark 选择而非固定 2。2.5 秒 Emergency/500ms reserve 是初始保守 profile，须平台 P99 验证。

### I9 历史证据不是行为标签

v1 动作、历史胜负和外部 simulator 只提供 replay/finding/fixture/对手；分叉后不消费历史后缀。只有平台/RuleCorpus 和完整 DD6 coverage 能升级严格结论。

### I10 发布是全硬门 AND

设计完整不等于实现 PASS；零样本不等于零错误；胜率不能抵消 terminal/hard/proof、restore、stale、runtime 或非法 action 错误。

## 4. 已消解冲突

| 冲突 | 错误后果 | 最终决议 |
|---|---|---|
| `SearchState` 只表示物理或信息 | 隐藏状态策略融合 | `PhysicalState | InformationState`，DD2/DD6 |
| deep Minimax point value | heuristic 冒充 exact | sound lower/upper，DD6 |
| 根 regret matching 与关键节点 | 只在根处理 simultaneous 漏洞 | 受限 matrix/Double Oracle，DD6 |
| EnemyAction/HiddenWorld/Chance 混合 | 概率与对手量词错位 | 三类独立 node/backup，DD6 |
| 风险 0/100 与硬失败 | 概率门越权 Hard | epsilon-contamination 仅软层，DD6 |
| 胜利链和死亡链交叉 | 已能必杀却过度规避，或假必杀 | Terminal/Proof 优先 + 同一 ReverseViability，DD1/DD5/DD6 |
| simultaneous ForcedLoss 逐 row 选 column | 假 `STRICT_UNAVOIDABLE` | 单一 observation-consistent enemy policy，DD6/DD9 |
| possible fire 与已有 bullet | 可能威胁被当必死，或已发弹被遗忘 | Possible/Expected 与 Committed hazard 分层，DD5 |
| 子弹/炸弹随搜索深度消失 | 深度截断产生假安全 | 生命周期到物理失效，DD5 |
| 多 projectile ID/overload | 合并弹道/命中错误 | 独立 entity handle/generation，DD2/DD4/DD5 |
| PhysicsTT/value/transition 名称冲突 | cache 读错语义 | 11 canonical inventory，DD8 |
| runtime mode 进入 value key | fallback 复用/失效混乱 | semantic profile 与 budget profile 分离，DD8 |
| fallback 固定 2 层/变贪心 | 极端时间下改变决策定义 | benchmark-selected reduced Minimax，DD8 |
| v1 历史 codeHash 按文件名映射 | 伪装精确 legacy policy | 仅 SHA-256 exact 的 v20，DD9 |
| 244 frozen 被称为 blind | 过度报告泛化 | nonblind locked regression + post-build forward，DD9 |
| replay 分叉继续用真实后缀 | 无效反事实 | divergence 后 suffix=0，DD9 |
| offline 日志/模型进入生产 | 字节、性能和命名过拟合 | production strip deny list，DD8/DD9 |

## 5. Hard、Proof、Risk、Eval 的最终边界

```text
Observed/Tracked facts
  -> Fast physical transition
  -> TerminalResolver
  -> Committed Hazard / HardGate
  -> InformationState Proof and sound Value bounds
  -> recursive robust Risk
  -> Eval / Strategy / Opponent expected tie-break
  -> Plan persistence and emitter
```

上层不得回写下层事实：

- OpponentModel 不改变 enemy action support；
- Risk 不改变 HardGateStatus；
- Eval 不改变 TerminalOutcome/ProofStatus；
- Plan 不跳过 root revalidation；
- Cache 不拥有 canonical state；
- Historical finding 不改变 RuleRegistry status。

该边界覆盖用户最初要求：强制胜利必须执行、必输必须规避，而两者之间的行为由动态风险、策略、对手和技能模型控制。

## 6. 性能架构一致性

高性能不是末端优化，而是所有阶段的物理约束：

- 一次输入整数化，20x20 static terrain 与动态 entity pool 分层；
- TypedArray SoA、immutable world delta、branch-local scratch、BranchMark undo；
- 热路径无临时对象/float semantic array/hot Map/Set；
- action/world/chance/observation 惰性枚举、短路和 bounded support；
- projectile/bomb trajectory 与分数 dependency 分离缓存；
- explicit stack 和预分配 Result/Policy/Coverage；
- cache key 包含所有语义版本，budget 不伪装 semantic；
- low-frequency time check、batch P99 和独立 Emergency arena；
- production 单线程，离线 corpus 可确定性分片并行；
- 所有 R3 数值由函数/复合/全景/终局/完整对局/platform benchmark 选择。

不存在“为了性能删除低概率 world、跳过 Hard、忘记已发实体或把 float 概率当严格值”的许可。

## 7. 可实施性与仍需证据

### 7.1 可以进入实现的原因

- 每个核心状态/结果有 owner、单位、生命周期、hash、undo/overflow；
- 每个 runtime node/action/phase 有有限语义或明确 UNKNOWN；
- Reference、Fast、Search、soft module、cache/runtime/build 接口顺序闭合；
- 规则未知不会迫使实现猜值；
- corpus、counterfactual 和 release 有稳定 schema；
- 实现顺序和失败回退的依赖阶段明确。

### 7.2 不阻塞编码但阻塞发布

- R0/R1 未校准 variant：实现 common/unsupported/interval 路径，平台确认前禁 strict；
- R2 概率：support complete 时 Proof 可用，Value 保留区间；
- Risk/Eval/Opponent weights：先占位为 manifest 参数，Calibration 后冻结；
- depth/cache/capacity/batch：先由 correctness profile 运行，再 benchmark-select；
- platform engine/bytes/runtime：本地不能代替，最终上传/profile 决定；
- true forward：只能在 candidate 冻结后产生。

### 7.3 会要求回退设计的实施发现

只有以下情况要求重开对应 DD：状态无法无损表达、合法 action/support 无法有限生成、Reference 无法唯一执行已确认规则、Fast 无法 fully undo、Proof 量词不能保持信息集一致、生产必需路径无法在平台资源内实现。普通参数不佳或性能尚未调优不等于架构失败。

## 8. 未决问题无隐藏默认

当前未决分四类：

| 类别 | 代表项 | 当前安全行为 |
|---|---|---|
| 平台 phase/state variant | move collision、多 bomb/shared hit、exact runtime tie | finite RuleVariant；触发时 unsupported/UNKNOWN，不做 strict |
| 概率 | stun、teleport、future star | Proof 覆盖 support；Value interval；star 不进 Hard |
| R3 参数 | risk/eval/opponent/depth/cache/batch | manifest 参数，Discovery/Calibration/Benchmark 后锁定 |
| 平台环境 | JS engine、bytes、cold start、3秒 P99 | release BLOCKED，保守 fallback/emergency 先设计 |

因此“无未登记冲突”不等于“所有事实已知”；它表示每个未知都有 owner、传播和发布行为。

## 9. 变更传播规则

实现期间若修改：

- Rule/phase/terminal：递增 Ruleset/RuleCorpus，重跑 Reference/Fast/Proof/历史重建；
- State/ABI：回退 DD2/DD3，重跑全部 kernel/cache/build；
- Hard/Hazard：回退 DD5，重跑安全/正向/反事实；
- Proof/Risk：回退 DD6，重跑 small-state、counterfactual 和策略；
- Feature/weight/opponent：递增软版本，禁止用 Frozen 调参；
- Cache/budget：递增 manifest/profile，验证 cache-off 和 runtime；
- Build/minification：递增 build hash，source/minified 和 forward candidate 失效；
- Corpus/split：新 `LEGACY_CORPUS_VERSION`，旧版本保持可重放。

任何修改都不能只改一个报告数字而保留旧 fingerprint。

## 10. 审计结论

DD0–DD9 的详细设计在语义、量词、数据 owner、生命周期、性能、历史证据和发布治理上闭合。当前没有发现需要立即推翻或重开前序阶段的冲突。

全局状态必须同时保留两句话：

```text
DETAILED DESIGN COMPLETE AND IMPLEMENTABLE
IMPLEMENTATION/PLATFORM RELEASE EVIDENCE NOT YET AVAILABLE
```

这使下一阶段可以直接按依赖实现，同时保证任何未确认规则、性能阈值或历史结论都不会被误写成生产真值。
