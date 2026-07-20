# 内存布局与 Arena 合同

状态：DD8同步layout。DD3 physical revision 1仍有效；Arena/cache canonical names、Runtime/Emergency和build manifest边界已冻结，具体生产容量值等待实现benchmark。

## 1. 总体原则

- 开局预分配，搜索期间只使用索引和 usedCount。
- 所有搜索热池默认预分配 TypedArray SoA；packed Array 只保留为历史 A/B 结果，不进入当前 production candidate。
- 实体与缓存使用 SoA；每个决策深度使用预分配 SearchFrame SoA 显式栈。
- 不为每个节点创建视图、subarray、对象或动态数组。
- 所有容量由规则参数和搜索配置公式生成。

## 2. Arena

### 2.1 MatchArena

整局只读：

- terrain base；
- wall/mound/grass/open bitset；
- row/column block mask；
- cellX、cellY；
- neighbor；
- geometric rays；
- 规则常量和查表。
- `OwnSkillEmitter` 常量与 `EnemySkillDescriptor[8]` 紧凑整数表；
- 冻结的 FrameTimeline phase table、`phaseOrderId` 和 RULESET_VERSION。

### 2.2 PersistentArena

跨帧：

- Confirmed entity pools；
- joint tracked entity constraints 与 association relation；
- PendingOwnCommandRegistry；
- ActivePlanArena；
- opponent model；
-跨帧缓存元数据。

### 2.3 FrameArena

每个真实回调重置：

- ObservedRoot；
- 根候选动作；
- ActionFamily masks；
- EnemyActionSet；
- ExactWorldSupport/ResidualSupport scratch；
- ChanceOutcomeSet 与联合动作条件概率；
- 根收益矩阵；
-临时路径与 feature scratch；
- lastKnownEmergencyAction。

`EnemyActionSet` 在 singleton/单敌方 information set 时保存 ActionRef/ActionKey；存在多个敌方 information set 时，受限隐藏博弈保存紧凑响应策略列，Proof 只保存当前 `beta` 前缀和迭代游标，不 materialize 完整策略笛卡尔积。

### 2.4 SearchArena

每次搜索重置：

- branch-local physicalScratchByDepth；
- informationStateByDepth；
- observationPartition scratch；
- ResultArena；
- actionsByDepth；
- restricted stage matrix、双方平均策略和 best-response scratch；
- BranchMark；
-专用 Delta；
- branch entities；
- branch trajectories；
- TacticalClosure scratch；
-递归或显式栈控制字段。

### 2.5 CacheArena

固定容量：

- PHYSICAL_VALUE_TT；
- INFORMATION_VALUE_TT；
- PROOF_CACHE；
- STAGE_MATRIX_CACHE；
- CHANCE_CACHE；
- PATH_CACHE；
- FEATURE_CACHE；
- BELIEF_CACHE；
- ENTITY_PLAN_CACHE；
-可选且默认关闭的 REGRET_WARM_CACHE；
-可选且默认关闭的 TRANSITION_CACHE。

名称和key只以 [cache-inventory.md](cache-inventory.md) 为准；当前root HazardTimeline/HardViableSet是working set，不是可淘汰cache。

### 2.6 EmergencyReserve

- 不计入正常 usedCount。
- 真实事实超过正常上限时使用。
- 使用后永久进入 fallback。
- 仍不足时走直接扫描的慢速安全路径，禁止截断危险实体。

## 3. 地图表示

对 20x20：

- cellCount = 400。
- wordCount = ceil(400 / 32) = 13。
- terrain：Uint8Array[cellCount]。
- 全图 bitset：Uint32Array[wordCount]。
- row/column mask：每条线低 width/height 位。
- neighbor：每格四方向固定表。

基础 cellId 公式由构建配置固定；所有模块只能调用生成的编码/查表，不自行假设二维布局。

真实地形每个 onIdle 完整核对。搜索地形使用 root 副本与差量；ObservedRoot 从不被搜索修改。

## 4. 搜索状态布局

`SearchState = PhysicalState | InformationState`。每个深度槽只保存 `stateKind` 和对应 Arena offset；不建立 union wrapper、继承对象或复制两种布局的最大结构。

### 4.1 PhysicalState

branch-local 小型 PhysicalScratch 可以使用固定 stride；并存 WorldRecord 禁止用唯一 `decisionDepth * stride` 相互覆盖。WorldSnapshot 与 immutable WorldDelta 的最终选择见 [information-state-storage-contract.md](information-state-storage-contract.md)。

字段类别：

- platformFrame、phaseOrdinal 和绝对 terminal deadline；
- tank cell/direction/status、ourSeatId/phaseOrderId；
- stars；
- ownSkillId/enemySkillId；
- cooldown/effect 的绝对 ready/until deadline、shieldHitsRemaining；
- fireLockedUntil、starPickupLockedUntil 与 skillReadyFrame；
- queue summary、nextExecutableFrame 与 action capability；
- entity active mask summary；
- topology/rule/profile version；
- physics hash。

最终采用“小状态按深度复制 + 大状态差量撤销”还是更激进的 make/unmake，必须由 Architecture Validation Prototype 比较后冻结。

### 4.2 InformationState

InformationState 不复制全部可能世界。每层固定记录：

- commonPhysicalSignature（support 共享但未必公开）；
- exactWorld/residual support offset/count/kind；
- beliefProbability offset、top-K count 与 residual bounds；
- ourObservationHistorySignature；
- enemyInformationPartition offset/count；
- commonCommandActionRelation offset；
- rule/capability/assumption mask；
- informationHash/decisionHash；
- singletonPhysicalOffset，非 singleton 时为 INVALID_OFFSET。

可能世界记录引用 SearchArena 中的 PhysicalState slot 或共享 physical signature。相同 observation signature 的后继通过直接寻址 accumulator 与 touched list 合并，不创建对象、Map 或动态数组。

InformationState 的我方 action list 每节点只生成一次，应用于所有可能世界；不能在 world loop 内重新选择动作。命令在部分世界执行失败时作为 outcome 保留，不以世界特有合法性提前泄露信息。

规则实现不确定不写入 possibility support。开发期 `RuleVariantMask` 位于 RuleCorpus/Reference harness；正式构建冻结单一规则后，只在状态中保存 RULESET_VERSION 和 phaseOrderId。

### 4.3 同时行动阶段 scratch

每个活跃阶段只 materialize Double Oracle 当前受限行列：

- ourRestrictedActionRef/Key；
- enemyRestrictedActionRef/Key；
- matrixLower、matrixUpper、matrixValue；
- ourRegret、enemyRegret；
- ourStrategySum、enemyStrategySum；
- ourAverageStrategy、enemyAverageStrategy；
- bestResponse scratch；
- stageLower、stageUpper、exploitabilityGap；
- completedIteration、solverFlags。

pure lower/upper 相等时不得初始化或清理完整 regret scratch。

## 5. 实体池

每颗实际子弹拥有独立 handle。overload 两颗子弹共享 `shotGroupHandle`，但 projectile handle 不同。

Projectile SoA：

- active
- generation
- ownerTankHandle
- ownerTeamId
- shotGroupHandle
- cell
- direction
- effectType
- startFrame
- endFrame
- flags
- trajectoryOffset
- trajectoryLength
- trajectoryCursor
- contributionOffset
- contributionCount

Bomb SoA：

- active
- generation
- ownerTankHandle
- cell
- placedFrame
- explodeFrame
- effectType
- flags
- blastOffset
- blastCount
- contributionOffset
- contributionCount

slot 通过整数 free-list 分配。任何跨帧引用必须同时验证 generation。

## 6. 轨迹与贡献

### 6.1 Projectile

- GeometricRay：长期静态。
- CommittedTrajectory：当前物理条件下缓存至失效。
- BranchTrajectory：搜索分支专用。

静态最大轨迹到墙、土堆或边界；具体分支可因坦克或护盾提前结束。子弹互相穿过，不产生抵消。

### 6.2 Bomb

- 保存爆炸 frame、blast cells、地形依赖和逃生 deadline。
- 爆炸贡献只在对应时间槽展开。
- 草中敌方可能炸弹只进入 belief/risk，已确认炸弹进入 committed。

### 6.3 Aggregate

- 已提交实体的危险必须保存到实体真实失效，不受 Minimax depth 限制。
- 近期未来使用稠密时间环形数组。
- 超出近期窗口但尚未失效的已提交实体保存为稀疏事件，接近窗口时增量展开。
- committed、robust、expected 三套平面严格分离。
- committed 使用 bitset + overlap count。
- expected risk 使用 Uint16 0–10000。
- 精确伤害、owner、护盾和同帧事件由实体事件解析。
- shield 保存独立 `hitsRemaining`；两颗 overload projectile 分别产生 hit event；bomb hit 使用独立 damage kind，可一次消耗整个 shield。

实体观察协调：

- 预测实体当前应当可见但运行时缺失：确认删除。
- 预测实体当前不可见：继续保留。
- 观察位置与预测不一致：保留已确认前缀，从最早不一致点重算后缀。
- own bullet/bomb 根据已知命令和执行 phase 优先精确协调。
- 敌方草中可能 bomb 进入 PossibleBombBelief；已确认 bomb 进入 ConfirmedBombRegistry。

## 7. Hidden belief scratch

旧 `cell + direction + statusMode` stateId 只允许作为单一 factor 的 direct-address scratch，禁止代表完整 InformationState。规范状态必须联合 tank、projectile、bomb、queue、association 和未观察 counter，见 [information-state-storage-contract.md](information-state-storage-contract.md)。

候选 scratch 仍可使用 probabilityAccumulator、visitedGeneration、touched ids、top-K probability 和 possibility bitset，但 residual 必须无损保存联合约束；不能把独立 factor 的边缘积当成 exact world support。

## 8. ResultArena

唯一字段和 Policy/Coverage handle 以 [action-result-abi.md](action-result-abi.md) 为准。本文件只比较固定 stride AoS 与字段 SoA；不得恢复只有 bestAction 的旧 Result。搜索函数返回单个 status，其他结果写入 ResultArena offset。

## 9. 重置策略

- 小数组：直接清零。
- 线性池：只重置 usedCount。
- 大型稀疏数组：dirty index 清理。
- generation stamp 是否替代 dirty clear，由 Benchmark 决定。
- 开发测试使用随机脏数据初始化未使用区，检测错误的隐式清零依赖。

## 10. 容量公式

构建脚本至少计算：

    MAX_SEARCH_PROJECTILES =
      ROOT_MAX_PROJECTILES
      + MAX_DECISION_DEPTH * MAX_PROJECTILES_PER_JOINT_ACTION

    MAX_SEARCH_BOMBS =
      ROOT_MAX_BOMBS
      + MAX_DECISION_DEPTH * MAX_BOMBS_PER_JOINT_ACTION

    MAX_TRAJECTORY_STEPS =
      MAX_SEARCH_PROJECTILES * MAX_PROJECTILE_LIFETIME

    MAX_DELTAS =
      MAX_DECISION_DEPTH * MAX_DELTAS_PER_JOINT_ACTION

    MAX_INFORMATION_WORLDS =
      MAX_BELIEF_STATES_PER_INFO_NODE * MAX_ACTIVE_INFO_DEPTH

    MAX_RESTRICTED_MATRIX_CELLS =
      MAX_RESTRICTED_OUR_ACTIONS * MAX_RESTRICTED_ENEMY_ACTIONS

同时生成：

- MAX_CELLS；
- MAX_TANKS；
- MAX_ACTIONS；
- MAX_HIDDEN_WORLDS_PER_INFO_NODE；
- MAX_ENEMY_ACTIONS_PER_INFO_NODE；
- MAX_CHANCE_OUTCOMES_PER_JOINT_ACTION；
- MAX_OBSERVATION_PARTITIONS；
- MAX_RESTRICTED_OUR_ACTIONS / MAX_RESTRICTED_ENEMY_ACTIONS；
- MAX_INFOSET_REGRET_SLOTS；
- MAX_EVENTS_PER_PHASE；
- MAX_BELIEF_STATES；
- MAX_PLAN_SLOTS；
-各缓存容量。

## 11. 构建内存清单

每次构建输出：

    MatchArena bytes
    PersistentArena bytes
    FrameArena bytes
    SearchArena bytes
    CacheArena bytes
    EmergencyReserve bytes
    Total bytes

位宽、offset 或总容量超出合同必须构建失败，不允许运行时静默截断。
