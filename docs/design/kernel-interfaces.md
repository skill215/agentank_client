# Kernel 数值接口与所有权

状态：DD7同步接口。DD3 physical revision 1仍有效；Terminal/Hard、Value/Proof/Risk、Evaluation/Opponent/Skill/Plan分别由对应DD1–DD7合同覆盖。调用形状为整数offset/handle + 预分配TypedArray SoA，搜索驱动为显式栈。

## 1. 数值约定

### 1.1 基础编号

- cellId：地图格整数编号。
- commandCode：primitive command 的稳定 uint32 编码。
- actionRef：当前 ActionArena 的 ActionProgram 引用。
- actionKeyLo/Hi：ActionProgram 稳定语义 key。
- entityHandle：slot 与 generation 的逻辑组合。
- planHandle：Plan slot 与 generation。
- frame：绝对游戏帧。
- decisionDepth：联合决策深度。
- offset：Arena 内固定记录起点。
- physicalStateOffset：单一完整物理世界记录起点。
- informationStateOffset：不可区分世界集合、belief 和双方信息分区记录起点。
- SearchState：`PhysicalState | InformationState` tagged union，接口边界以整数 stateKind + 对应 offset 传递，不创建对象包装。

具体 bit 分配由构建脚本根据最大地图和技能参数生成，不能在业务模块内复制常量。

### 1.2 定点数

- 概率、belief、置信度：0–10000。
- 风险：0–100。
- 归一化特征：默认 -10000–10000。
- WinUtility：-10000–10000。
- 中间乘加使用 JavaScript 安全整数范围，写入缓存前钳制。

概率分布必须严格归一化到 10000。舍入余量按最大余数、固定 action/state ID 顺序补齐。

### 1.3 两类整数运算

- FixedMath：普通整数加减乘除，禁止误送入 32 位位运算。
- BoundFixedMath：概率乘加和除法的外扩区间版本，lower 向负无穷取整、upper 向正无穷取整，并显式携带归一化残差。
- BitMath：bitset、动作编码和哈希，使用位运算、无符号规范化与已验证的 shift/add 32 位乘法。目标平台校准已确认 `Math.imul` 不存在，因此生产热路径和初始化均不得依赖它；离线 Node 工具可以把 `Math.imul` 仅作为差分 oracle。

## 2. 模块所有权

| 模块 | 唯一写入范围 | 其他模块权限 |
|---|---|---|
| ObservationAdapter | ObservedRoot | 只读运行时输入 |
| TerrainKernel | 搜索地形、地形 bitset | 通过查询函数只读 |
| EntityKernel | 实体池、active mask、free-list | 通过 handle 访问 |
| HazardKernel | 时间危险、贡献、dirty list | 通过 cell-time 查询 |
| InformationKernel | InformationState、world set、ObservationPartition | 通过 informationStateOffset 访问 |
| FrameTimeline | phase 与事件缓冲 | 调度，不直接绕过 owner |
| SearchDriver | 深度、动作索引、ResultArena | 不直接改物理数组 |
| StageSolver | pure bounds、受限矩阵、平均策略和 gap | 只读状态，写 solver scratch |
| Evaluator | feature/value scratch | 只读物理查询 |
| CacheManager | 容量、generation、替换元数据 | 内容由专用缓存函数管理 |
| ActionEmitter | PendingOwnCommandRegistry | 只解码最终根动作 |

跨模块写入必须通过静态数值函数，并同步更新差量、哈希和版本。

## 3. 核心接口

以下是语义签名，不是最终 JavaScript 代码。

### 3.1 输入协调

    buildObservedRoot(me, enemy, game, rootOffset) -> statusCode
    classifyRootRuleContext(rootOffset, outRuleContextOffset) -> statusCode
    advanceAndReconcileTrackedRoot(rootOffset, committedTrackedOffset,
                                   shadowTrackedOffset, associationOffset) -> rootStatus
    buildRootSearchState(rootOffset, shadowTrackedOffset, associationOffset,
                         outStateKindOffset, outStateOffset) -> rootStatus
    commitTrackedRoot(shadowTrackedOffset, committedTrackedOffset) -> statusCode

复杂度合同：

- 地图固定扫描 O(cellCount)，每次真实回调一次。
- 技能字符串、seat/initiative 输入和 runtime 字段只在 `classifyRootRuleContext` 转成整数 id；搜索期间禁止字符串分派。
- 实体协调 O(observedEntities * activeEntities)，实体上限固定；若 Benchmark 失败再引入签名索引。
- 搜索期间禁止访问 me、enemy、game。
- advance/reconcile 只写 shadow；只有根 SearchState 完整构建且一致性校验通过后才 commit，任一 incomplete/异常不得留下半更新 PersistentState。

### 3.2 动作生成

    generateScalarActions(stateKind, stateOffset, actor, mode, outOffset) -> actionCount
    generateActionFamily(stateKind, stateOffset, actor, actionType,
                         outFamilyOffset) -> targetCount
    classifySubmissionLegality(stateKind, stateOffset, actionRef) -> submissionLegality
    classifyHardGateStatus(stateKind, stateOffset, actionRef) -> hardGateStatus

普通动作写入固定 ActionRecord/CommandArena。高基数技能使用 legalTargetMask 和 candidateTargetMask，展开时才建立 ActionRef/ActionKey。

### 3.3 联合转换

    applyJointPhysical(parentPhysicalOffset, ourActionRef, enemyActionRef,
                       chanceCode, childPhysicalOffset) -> transitionCode
    partitionByObservation(parentInformationOffset, physicalChildrenOffset,
                           outInformationChildrenOffset) -> childCount
    undoTo(branchMarkOffset) -> statusCode

transitionCode 只描述物理转换是否完成：

- TRANSITION_APPLIED
- TRANSITION_UNKNOWN_RULE
- TRANSITION_INCOMPLETE_STATE
- TRANSITION_EXECUTION_ERROR

终局由 `TerminalResolutionStatus + TerminalOutcome` 单独返回；HardGate 在 action 评分前单独分类，禁止塞进 transitionCode。

`applyJointPhysical` 不调用策略、belief、对手模型、日志或最终动作 API。隐藏世界的合并只能由 `partitionByObservation` 根据我方真实 observation signature 执行。

`applyJointPhysical` 只接受构建期冻结的 RULESET_VERSION、`phaseOrderId` 和整数技能描述。开发期多个 RuleVariant 由 Reference harness 对同一输入分别调用，不允许在 FastKernel 内为每个搜索节点再展开规则变体。

### 3.3.1 Chance

    enumerateChance(parentPhysicalOffset, ourActionRef, enemyActionRef,
                    outChanceCodeOffset, outProbabilityOffset) -> outcomeCount

chance 概率以 `(PhysicalState, ourActionKey, enemyActionKey)` 为条件，每组严格归一化到 10000。不得提供一个跨全部我方动作行共享的根 Scenario 概率数组。

### 3.4 时间推进

    advanceOneFrame(physicalStateOffset) -> transitionCode
    advanceUntilNextDecision(physicalStateOffset, childPhysicalOffset) -> advancedFrames
    resolveTerminal(physicalStateOffset, outTerminalOffset) -> terminalResolutionStatus

只有双方都没有新决策机会的帧才允许压缩。

### 3.5 Deadline 与路径

    computeCellDistance(goalMaskOffset, topologyMode, outDistanceOffset) -> statusCode
    computeActionETA(startStateOffset, goalMaskOffset, capabilityMode) -> eta
    solveDeadline(startStateOffset, targetMaskOffset, forbiddenTimelineOffset,
                  deadlineFrame, capabilityMode, outOffset) -> proofStatus

Deadline 输出：

- earliestArrival
- latestSafeDeparture
- slack
- firstAction
- proofStatus

### 3.6 搜索

    solveInformationState(informationStateOffset, decisionDepth,
                          searchProfileId) -> resultCode
    solvePhysicalStage(physicalStateOffset, decisionDepth,
                       searchProfileId) -> resultCode
    computeSerializedPureBounds(informationStateOffset, actionRef,
                                outResultOffset) -> resultCode
    solveRestrictedStageMatrix(informationStateOffset, matrixOffset,
                               solverProfileId, outResultOffset) -> resultCode
    solveProofInformationState(informationStateOffset, decisionDepth,
                               proofGoalId) -> proofStatus
    tacticalClosure(informationStateOffset, closureBudget) -> resultCode

多字段结果写入 [action-result-abi.md](action-result-abi.md) 的唯一 ResultArena/PolicyArena/CoverageArena。禁止返回 Result 对象、tuple 或新数组。

### 3.7 同时行动阶段矩阵

    buildEnemyActionSet(informationStateOffset, outActionOffset) -> actionCount
    buildEnemyInformationPartition(informationStateOffset,
                                   outPartitionOffset) -> informationSetCount
    enumerateEnemyResponsePolicyPrefix(informationStateOffset, prefixOffset,
                                       outPolicyOffset) -> responseCount
    initHiddenWorldSupportIterator(informationStateOffset, iteratorOffset) -> supportStatus
    nextHiddenWorld(iteratorOffset, physicalScratchOffset) -> iteratorStatus
    buildChanceSet(physicalStateOffset, ourActionRef, enemyActionRef,
                   outChanceOffset, outProbabilityOffset) -> chanceCount
    computeStagePureBounds(matrixOffset, rows, columns, outResultOffset) -> resultCode
    expandStageBestResponses(matrixOffset, actionSetOffset,
                             outExpansionOffset) -> expansionCount
    solveStageRegret(matrixOffset, rows, columns, iterationBudget,
                     outDistributionOffset, outResultOffset) -> resultCode

只有 `HARD_ALLOW` 动作进入阶段矩阵。ForcedWin 或唯一安全动作跳过矩阵求解。深层首先计算 pure lower/upper；相等且依赖 cell 具有 cutoff-eligible 完整界时才返回精确纯鞍点。根节点或战术关键节点在二者不等时运行受限矩阵求解。

EnemyAction、HiddenWorld 和 ChanceOutcome 分别生成、分别计数、分别写入 coverage certificate。HiddenWorld 通过 exact records + lossless residual iterator 访问，禁止为了接口先 materialize 完整集合。`solveStageRegret` 必须返回双方平均策略与 exploitability gap；迭代次数本身不代表 complete。

`buildEnemyActionSet` 只直接服务 singleton 或单敌方 information set 阶段。多个敌方 information set 共存时，隐藏博弈和 Proof 使用 `enemyInformationPartition`；Proof 通过响应策略前缀惰性枚举、反例短路和前缀缓存覆盖所有一致策略，禁止建立完整策略笛卡尔积数组。

### 3.8 Plan

    createCandidatePlan(actionRef, actionKeyLo, actionKeyHi, purpose, outPlanSlot) -> planHandle
    validateActivePlan(planHandle, rootOffset) -> planStatus
    activatePlan(candidateHandle) -> activeHandle
    invalidatePlan(planHandle, reasonCode) -> statusCode

大轨迹和路径数据位于专用缓存，Plan 只保存 handle、版本、deadline 和原始特征引用。

### 3.9 SkillPlugin 构建接口

技能源码提供以下开发期钩子：

    augmentActions
    applyTransition
    contributeHazards
    modifyCapabilities
    extractFeatures
    observeEvents
    hashState

构建脚本把技能源码拆成两类生成物：

- `OwnSkillEmitter`：发布坦克的技能在构建时已知，只保留一个专用 action family/emitter 与对应转换代码；
- `EnemySkillDescriptor[8]`：随机对手技能只能进场后得知，正式包必须保留八种紧凑 capability、transition、hazard、observation 和 feature descriptor。

每次真实根读取公开 `enemy.skill.type`，只转换一次为 `enemySkillId`。后续热路径用整数 id、flag 和直接表访问；不传 SkillPlugin 对象、不复制 matchup 对象、不进行字符串技能分派，也不运行动态模块钩子。

仅对实际 `enemySkillId` 生成敌方动作；保留八种 descriptor 不等于每节点遍历八种技能，因此不会把技能身份加入 HiddenWorld 或扩大 Minimax 分支。

技能模块不能：

- 自行选择最终动作；
- 绕过 HardGateStatus；
- 修改 TerminalPolicy；
- 将 UNKNOWN 规则升级为证明；
- 私自创建缓存或无界容器。

技能规则来源和候选差异由 RuleRegistry/ReferenceKernel 管理。外部模拟器中的技能实现不能直接生成正式 `EnemySkillDescriptor`；只有冻结规则生成器可以写入该表。

### 3.10 开发期 Oracle 接口

    runExternalSimulatorFixture(fixtureId, simulatorVersion,
                                outCanonicalTraceOffset) -> oracleStatus
    runReferenceFixture(fixtureId, ruleVariantId,
                        outCanonicalTraceOffset) -> oracleStatus
    compareCanonicalTrace(expectedOffset, actualOffset,
                          outMismatchOffset) -> mismatchCount
    buildHistoricalCheckpoint(matchId, frame, side, ruleVariantId,
                              outCheckpointOffset) -> reconstructionStatus
    runCounterfactualCheckpoint(checkpointOffset, controlledSide,
                                policyPairId, horizon,
                                outResultOffset) -> counterfactualStatus

上述接口只属于测试工具，不进入正式 bundle。`ruleVariantId` 是开发期规则假设，不得复用 action、world 或 chance 编码空间。外部模拟器匹配只能写 `EXTERNAL_SIM_MATCH`，不能升级规则可信度。历史检查点必须携带双方各自 ObservedTrack 和独立 TruthTrack；动作分叉后禁止继续消费原 replay 后缀。详细证据边界见 [legacy-evidence-contract.md](legacy-evidence-contract.md)。

### 3.11 动作输出

    validateSelectedRootAction(actionRef, actionKeyLo, actionKeyHi, rootGeneration) -> statusCode
    emitActionProgram(actionRef, me) -> statusCode

Emitter 只做常数时间来源检查与动作解码，不重复运行完整硬安全搜索。

## 4. BranchMark 与撤销

统一 BranchMark 保存：

- terrainDeltaUsed
- entityDeltaUsed
- hazardDeltaUsed
- eventCount
- world/information/partition/action/result/policy/coverage 等所有可回退线性池的 usedCount（由 manifest 生成固定字段表）
- hashLow
- hashHigh
- entityHashLow
- entityHashHigh

专用撤销：

- TerrainKernel 恢复地形和 bitset word。
- EntityKernel 恢复 slot、active mask 与 free-list。
- HazardKernel按实体 contribution list 反向减计数。
- 小型 child state 通过对应 usedCount rewind 丢弃；不可覆盖仍存活的 parent/world slot。
- 哈希从 mark 恢复或执行严格逆运算。

## 5. 搜索控制器

Architecture Validation Prototype 同时提供：

- RecursiveSearchDriver
- StackSearchDriver

两者必须共享：

- action generator；
- applyJoint；
- undo；
- evaluator；
- cache；
- ResultArena；
- action ordering；
- 测试输入。

逐节点 trace hash 必须一致。正式构建只保留平台 Benchmark 的胜者，不运行时切换。

## 6. 函数复杂度合同模板

每个热函数必须声明：

    Inputs
    Outputs
    Owned arrays written
    Worst-case time
    Maximum loop iterations
    Maximum delta writes
    Maximum entity/event creation
    Cache access
    Clock access
    Heap allocations

热函数默认 Heap allocations = 0。任何地图全扫描、实体全扫描或嵌套循环都必须显式写出上限。

## 7. 异常边界

- 热函数内部不使用异常作为控制流。
- 顶层 onIdle 可保留单一异常边界。
- 复杂搜索前先计算 lastKnownEmergencyAction。
- 异常时丢弃当前 generation 的搜索结果，提交紧急动作并永久降级。
- 动作 API 只在最终 emitter 调用，避免部分命令已经入队。
