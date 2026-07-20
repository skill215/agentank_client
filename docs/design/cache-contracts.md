# 缓存合同

DD8 同步状态：缓存正确性原则继续有效；唯一名称、owner和完整key matrix现以 [cache-inventory.md](cache-inventory.md) 与 [dd8-cache-inventory.json](dd8-cache-inventory.json) 为权威，`OI-ARCH-007`已关闭。本文保留hash、生命周期和通用实现原则，不得另增cache id。

## 1. 原则

- 模块归模块，缓存归缓存。
- CacheManager 统一容量、generation 和内存报告。
- 每类缓存拥有专用 TypedArray、key、value、失效和替换函数。
- 缓存不是事实来源；ObservedRoot 与 RulesKernel 优先。
- 缓存必须通过 Benchmark 证明净收益。

准入条件：

    expectedReuse * recomputeCost
      > lookupCost + writeCost + invalidationCost

## 2. Hash

### 2.1 PhysicsHash

包含会影响合法动作、物理转换和终局的状态：

- platformFrame、phaseOrdinal 和绝对 terminal/deadline 字段；
- ourSeatId/phaseOrderId；
- terrain/topology；
- tank states、ownSkillId/enemySkillId；
- active entities；
- queue/effects/cooldown、shieldHitsRemaining 和绝对 ready/lock/until deadline；
- rule version。

不包含策略、risk、对手参数和内部实体 slot/generation。实体使用 canonical semantic identity 与 multiplicity；任何返回 raw handle 的 cache 另行核验 generation。

### 2.2 DecisionHash

在 common physical signature 基础上加入：

- PossibilityMask canonical signature；
- lossless residual constraints 与 HiddenWorld equivalence partition；
- our observation history signature；
- enemy information partition signature；
- common command action relation；
- rule/capability/assumption mask。

DecisionHash 不含 ProbabilityBelief、RiskProfile、OpponentModel、Evaluator 或 runtime SearchProfile。它供 Proof/Hard 使用；开发期 RuleVariant key 独立，正式 FastKernel 只接受单一 RULESET_VERSION。

只要 possibility support、residual、observation history 或 enemy partition 不同，DecisionHash/严格 Proof 就不能复用。低概率不能从 possibility support 删除。

### 2.3 InformationHash 与 ValueSearchKey

InformationHash=`DecisionHash + ProbabilityBelief + residual probability interval + beliefVersion`。Value/Expected/Robust cache 还必须建立外部组合 key：

- opponent model epoch；
- EvalProfileId；
- RiskProfileId / risk table version；
- stateRiskClass；
- SearchSemanticProfileId，以及单独的query depth/horizon。

这些外部参数不写回InformationState；一次搜索内冻结。`SearchBudgetProfileId/runtimeMode`只控制算多少，不自动进入值语义key；若fallback切换Eval/horizon/continuation basis，则对应semantic id自然变化。本文将完整组合称为`ValueSearchKey`，禁止再把它叫DecisionHash。

### 2.4 实体 multiset hash

地图和唯一占位字段使用 XOR Zobrist。可重复实体不能只 XOR，否则相同 token 会抵消。

实体使用两个独立 uint32 可增减 hash：

    entityHashLow  += mixLow(canonicalEntitySignature)
    entityHashHigh += mixHigh(canonicalEntitySignature)

移动或删除时先减旧签名、再加新签名。canonicalEntitySignature 包含 type、owner/source、cell、direction、绝对 created/deadline、phase、effect 和同源 member identity，不包含 slot/generation；双 hash 命中仍核验规范实体 multiset 摘要。

## 3. 固定置换表

- 容量为 2 的幂。
- 双 uint32 key。
- 2 路或 4 路组相联，由 Benchmark 决定。
- SoA 字段：
  - keyLow
  - keyHigh
  - depth
  - value
  - boundType
  - bestActionKey / policyKey
  - generation
  - flags

定位：

    bucket = keyLow & (bucketCount - 1)

替换优先级：

1. 空 slot。
2. 旧 generation。
3. 浅层软价值。
4. 与真实分支无关的条目。
5. 较深软条目。

严格证明不能被普通软价值随意覆盖。

## 4. 专用缓存

### 4.1 ProofCache

- Key：DecisionHash、proof goal、proof horizon、terminal policy version、coverage signature、rule/capability/assumption mask。
- Value：FORCED_WIN_PROVEN、FORCED_NONLOSS_PROVEN、FORCED_LOSS_PROVEN、ACTION_REFUTED、可跨 search 的 compact coverage fields；不得保存易失 CoverageHandle。
- 只接受严格完整搜索写入。
- UNKNOWN 不作为跨帧负结论复用；可保存为同一 search generation 的 frontier hint。
- ACTION_REFUTED 必须携带 ActionKey，不能作为整个 state 的负证明读取。
- hash 命中后必须核对紧凑 canonical InformationState signature，未核对命中不能生成严格 Proof。

### 4.2 INFORMATION_VALUE_TT（旧名 ValueTT/InformationTT）

- Key：ValueSearchKey。
- Value：depth、WinUtility、lower/upper、bound kind、bestActionKey/PolicyKey、solver kind、exploitability gap、coverage/complete flags；不得保存 ActionRef/PolicyHandle。
- heuristic-pruned/incomplete 节点必须带明确标志。
- 只有 EXACT_COMPLETE、LOWER_COMPLETE、UPPER_COMPLETE 能触发严格 cutoff；pure gap、受限矩阵未收敛和 hidden abstraction 结果只能排序或传播显式区间。

### 4.3 StageMatrixCache

- Key：ValueSearchKey、our/enemy action-set signature、joint chance version、solver profile。
- Value：已 materialize matrix cells、pure lower/upper、受限动作集、双方平均策略、best-response frontier、exploitability gap。
- 完全相同 key 可 warm start 关键节点矩阵求解。
- 固定迭代次数结果仍保持原 bound kind，不能因缓存命中升级为 complete。

### 4.4 PathCache

- Key：topology version、goal set、movement capability、status mode。
- Value：CellDistance field 或 ActionETA。
- 静态邻接/射线整局保留。
- 真实土堆变化局部失效；搜索分支使用 base + mound delta key。

### 4.5 FeatureCache

- Key：PhysicsHash、ActionKey、feature version。
- Value：未加权整数特征向量。
- 策略/risk 变化只重做点积。
- 最终总分默认不跨 profile 缓存。

### 4.6 EntityPlanCache

- Key：entity physical signature/handle generation、terrain version、time base。
- Value：trajectory、blast、escape tree、contribution list、raw features。
- 已确认前缀保留，只失效受影响后缀。

### 4.7 BeliefCache

- Key：observation version、visibility mask、skill/effect state、command belief version。
- Value：PossibilityMask、top-K states、residual。

### 4.8 TransitionCache

首版不默认启用。完整状态转换的可变差量可能比重新 applyJoint 更贵。只在复合/全景 Benchmark 证明真实命中收益后进入正式构建。

### 4.8.1 PHYSICAL_VALUE_TT 与 REGRET_WARM_CACHE

- `PHYSICAL_VALUE_TT`保存完整PhysicalState stage的complete/interval value，与`TRANSITION_CACHE`的物理patch严格分开；
- `REGRET_WARM_CACHE`只保存完全相同public-belief subgame的warm start，默认关闭且永不直接cutoff；
-两者的完整key/value/失效只引用DD8 canonical inventory，不在本文复制第二套字段。

### 4.9 离线遗产先验

历史 replay、死亡窗口和 v1 动作不属于运行时缓存。正式坦克不得按相似状态查询历史帧，也不得加载 match id 或命名对手表。

若离线语料被蒸馏为小型整数 LUT 或通用 OpponentModel 先验：

- 使用独立 `legacyPriorVersion`、corpus fingerprint 和 feature version；
- 只能影响 ExpectedValue、Risk 或 action ordering；
- 不能进入 PhysicsHash、InformationHash、HardGateStatus 或 Proof coverage；
- 当前局事件更新 opponentModelEpoch 后必须能覆盖通用先验；
- A/B 未证明净收益时不进入生产构建。

## 5. 时间和版本

版本至少包括：

- RULESET_VERSION
- phaseOrderId
- skillRuleTableVersion
- terrainGeneration
- objectiveGeneration
- observationGeneration
- opponentModelEpoch
- legacyPriorVersion（仅在启用离线蒸馏先验时）
- evalProfileId
- SearchSemanticProfileId；SearchBudgetProfileId/runtimeMode只控制cache访问和工作量，不作为内容语义版本
- cacheGeneration

不同生命周期只携带必要版本，避免所有变化让全部缓存失效。

## 6. 地形依赖

- 墙与边界永久静态。
- 每个土堆有固定 bit index。
- ray/path 记录 mound dependency mask。
- 土堆被破坏时只失效依赖它的射线与局部路径。
- 真实 400 格 CellDistance 可在地形变化时重算。
- 假设分支不能修改全局地形缓存。

## 7. 跨帧复用与 reroot

不保存完整 JavaScript Node 树。

搜索只保留：

- 当前 DFS 路径；
-固定 TT/ProofCache；
- principal variation；
- RootCache 的收益矩阵和混合分布；
- Active Plan。

下一帧根据真实 PhysicsHash/DecisionHash/InformationHash 和外部 ValueSearchKey 查询对应缓存。精确匹配并通过结构核验时自然复用；不匹配条目按 generation 淘汰。

物理转换结论只对完整精确 PhysicalState 复用；Proof 结论只对完整精确 InformationState 与 coverage certificate 复用。近似状态只能复用软启发式，且必须带版本和边界。

## 8. 淘汰等级

不可因容量淘汰：

- 当前活跃实体事实；
- 当前硬危险图；
- 当前 HardViableSet；
- 尚在使用的 root 一致性数据。

优先保留：

- 当前真实分支；
- PV；
-严格证明；
-高频路径与射线；
- Active Plan 物理缓存。

优先淘汰：

- 偏离真实状态的假设分支；
- 旧策略/risk/opponent epoch 的软值；
-浅层、低访问和低概率 belief 分支。

## 9. 重置

- 大缓存不每帧清零，增加 generation。
- current generation 精确匹配后读取。
- 跨规则版本禁止读取。
- RULESET_VERSION、phaseOrderId 或技能规则表变化时，转换、危险、TT、Proof、Plan 和 chance 依赖项必须整体或按明确 dependency mask 失效；不能只更新显示常量。
- 搜索一致性失败时丢弃当前搜索 generation，不污染长期事实缓存。

## 10. 缓存指标

诊断版记录：

- probes；
- hits；
- writes；
- replacements；
- invalidations；
- estimated work saved；
- peak bytes；
- hit latency；
- miss latency。

正式版删除统计代码，仅保留查找、版本和必要一致性字段。
