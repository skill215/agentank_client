# DD2 PhysicalState 与 InformationState 存储合同

状态：DD2 逻辑 ABI + DD3 physical revision 1。多 world 已冻结为 immutable delta，singleton 保留 direct fast path；具体规范见 [dd3-frozen-abi.md](dd3-frozen-abi.md)。

关联：`DEC-0001`、`DEC-0002`、`DEC-0010`、`DEC-0012`、`DEC-0013`、`DEC-0035`、`DEC-0038`、`DEC-0101`、`DEC-0102`、`DEC-0106`；`OI-ARCH-001`、`OI-ARCH-002`、`OI-ARCH-011`。

## 1. 目标

同时表达：

- 一个可唯一推进的完整 PhysicalWorld；
- 我方观察一致的多个 PhysicalWorld；
- hidden tank × projectile × bomb × queue 的联合相关性；
- 精确 possibility support 与 top-K 概率加速；
- 对手自己的 observation partition；
- 多 world 并存时安全的 apply/undo。

禁止把 InformationState 压缩为单独的 enemy cell/direction 边缘分布；那会丢失“某位置与某颗弹/某个 queue head 同时成立”的相关性。

## 2. 逻辑层次

```text
MatchStaticState
  terrain vocabulary / geometry / rule tables

TrackedRootState
  cross-callback facts and association constraints

InformationState
  common physical base
  + exact WorldSupport
  + optional lossless ResidualSupport
  + probability belief
  + our observation history
  + enemy information partition

PhysicalWorld
  one complete materialization that RulesKernel can advance uniquely
```

`common physical base` 表示所有 support world 物理相同的字段，不等于双方都公开知道。公开性只由 observation signature/partition 表达，禁止用 `publicState` 这个名字混淆二者。

## 3. PhysicalWorld 字段

### 3.1 Header

| 字段 | Owner | 单位 | PhysicsHash | Undo |
|---|---|---|---|---|
| `platformFrame/phaseOrdinal` | FrameTimeline | FrameT/uint8 | 是 | child copy/mark |
| `rulesetVersion/phaseOrderId/terminalPolicyId` | RuleContext | uint | 是 | match constant |
| `width/height` | MatchConfig | CountT | match hash | 不变 |
| `terrainStateOffset/topologyVersion` | TerrainKernel | offset/version | 是 | TerrainDelta |
| `ourSeatId` | RuleContext | uint8 | perspective hash | 不变 |
| `runtimeOrder` | TerminalKernel | enum | 是 | child copy |
| `terminalFlags` | TerminalKernel | flags | 是 | child copy |
| `physicsHashLo/Hi` | StateKernel | uint32×2 | 自身 | BranchMark |

RuntimeController 的真实 wall-clock accumulator 不属于 PhysicalWorld；只有会改变平台终局的 `runtimeOrder`/assumption 进入物理状态。

### 3.2 TankState（固定两 seat）

```text
handle
cell/direction/crashed
stars
skillId
skillReadyFrame
selfEffectType/selfEffectUntilFrame
debuffType/debuffUntilFrame
shieldHitsRemaining
statusFlags
fireLockUntilFrame
pickupLockUntilFrame
bombCooldownReadyFrame
teleportRevealUntilFrame
canActThisFrame/actionSpeedClass
queueOffset/queueCount/queueHead
queueTailMarker             // KNOWN_END | NEEDS_INFORMATION_EXPANSION
headEligibleAtFrame
boostFreeTurnFrame
```

一个 PhysicalWorld 的 queue 必须足以唯一推进到下一战略 decision/hidden expansion boundary。未知敌方 suffix 不得塞进 PhysicalWorld；它位于 InformationState 的 QueueSupport factor。materialize 时选择一个具体 prefix/head，并把 tail 标为 `NEEDS_INFORMATION_EXPANSION`；到达该边界必须返回 InformationState expansion，禁止当作 queue end 或新的可观察 EnemyAction。

TankState 字段组合同：

| 字段组 | Owner | 单位 | PhysicalHash | 生命周期/undo |
|---|---|---|---|---|
| seat identity、cell、direction、crashed、stars | Tank/Objective Kernel | handle/cell/enum/count | canonical semantic fields 全部进入 | branch-local small-state child/rewind |
| skill/status/effect/debuff | Skill/Effect Kernel | enum/flags | 全部进入 | child/EffectDelta |
| `*ReadyFrame/*UntilFrame/*LockUntilFrame` | 对应规则 owner | 绝对 FrameT | 全部进入 | child/delta；禁止存 remaining |
| shield/cooldown/action capability | Skill/Scheduler | count/deadline/flags | 全部进入 | child/delta |
| queue offset/count/head/tail/eligibility | Scheduler | offset/count/FrameT | 语义 prefix/tail/deadline 进入，raw offset 不进入 | QueueArena usedCount + child cursor |

未在表中单列的 TankState 新字段必须先归入一个 owner/单位/hash/undo 组并递增 STATE_ABI_VERSION，不能只往数组追加。

### 3.3 Objective/terrain

```text
starPresence/starCell/starSpawnAtFrame
dynamicTerrainOffset
terrainVersion/topologyVersion
```

未来随机 star 尚未 resolve 时产生 CHANCE_RESOLUTION，不允许 PhysicalWorld 同时保存多个位置。

### 3.4 Active entities

PhysicalWorld 引用精确 active entity set：

```text
tankEntityOffsets
projectileSetOffset/count
bombSetOffset/count
shotGroupSetOffset/count
```

每个实体字段遵循 [entity-data-association-contract.md](entity-data-association-contract.md)。实体不存在、存在但隐藏、存在且可见是物理与观察的不同维度；PhysicalWorld 只记录是否存在和物理属性。

Objective/terrain 由 Terrain/Objective Kernel 拥有，使用绝对 FrameT/cell/version，全部语义字段进入 PhysicalHash，并分别通过 TerrainDelta 或 small-state child 撤销。active entity set 由 EntityKernel 拥有；集合 offset 不进入 hash，canonical entity multiset 进入 hash，修改经 EntityDelta/arena mark 撤销。

## 4. InformationStateRecord

```text
informationStateId
commonBaseOffset
exactWorldStart/exactWorldCount
residualSupportOffset/residualKind
possibilitySupportVersion
topProbabilityStart/topProbabilityCount
residualProbabilityLower/residualProbabilityUpper
ourObservationHistoryLo/Hi
ourCurrentObservationRelationOffset
enemyPartitionOffset/enemyInformationSetCount
commonCommandActionRelationOffset
informationHashLo/Hi
decisionHashLo/Hi
assumptionMaskLo/Hi
capacityStatus
singletonPhysicalOffset
```

`singletonPhysicalOffset` 只有 exactWorldCount=1、无 residual 且 observation/queue 关系不影响 horizon 时有效。

## 5. WorldSupport

### 5.1 ExactWorldRecord

每条 exact world 具有：

```text
worldId
physicalRepresentationOffset
physicalSignatureLo/Hi
possibilityFlags
probabilityMass
ourObservationHistorySignatureLo/Hi
enemyObservationHistorySignatureLo/Hi
enemyInformationSetId
associationChoiceOffset
queueChoiceOffset
```

`probabilityMass=0` 不删除 possibility。Proof 遍历所有 possible record；Value 才读取 mass。

### 5.2 联合相关性

一个 world 的 hidden assignment 至少联合绑定：

```text
enemy tank pose/status
projectile existence/identity/pose/shot group
bomb existence/identity/deadline/owner
enemy queue head/prefix
shield hit count or other unobserved physical counters
association choices
```

禁止分别采样每个边缘后做笛卡尔积，也禁止因 top-K 裁剪删除低概率联合事实。

## 6. ResidualSupport

当 exact worlds 超出 configured top materialization 时，只允许转入能够无损表示 possibility 的 residual：

```text
RESIDUAL_NONE
RESIDUAL_FACTORED_CONSTRAINTS
RESIDUAL_EQUIVALENCE_CLASS
RESIDUAL_QUEUE_SUFFIX
RESIDUAL_UNREPRESENTABLE
```

Residual descriptor 包含 domain bitsets、关联约束、互斥/同源约束和可执行 expansion cursor。只有下列情况可称 lossless：

- 展开可恢复全部 support 且不增加不存在组合；
- transition/observation 查询能直接在 factor 上求完整上下界，或按需展开；
- enemy information partition 的一致性不丢失。

无法保留相关性时使用 `RESIDUAL_UNREPRESENTABLE + INCOMPLETE_RESIDUAL_CAPACITY`。禁止退化为独立边缘概率。

## 7. ProbabilityBelief

```text
PROB_SCALE = 10000
topWorldId[]
topProbability[]
residualProbabilityInterval
beliefVersion
```

- 归一化整数和必须为 10000；未确认概率使用 outward interval。
- top-K 只加速 Expected/Robust backup；Possibility support 独立完整保留。
- 概率更新不能创建/删除物理 world，只能在规则/观察已更新 support 后重新分配。
- residual probability 不能默认均匀，也不能用于 strict cutoff。

## 8. EnemyInformationPartition

对每个 world 运行 `observeForSide(world, enemySeat)`，再把新 observation 与敌方已有 observation/own-action memory 合并为 history signature，按完整 information history 分组：

```text
partitionWorldStart[]
partitionWorldCount[]
partitionInformationHistoryLo/Hi[]
worldToEnemyInformationSet[]
partitionVersion
```

同一 enemy information set 必须复用同一 EnemyAction；不同 set 可以选择不同动作。敌方知道自己过去提交的 ActionProgram，因此只按当前画面相同分组仍会造成 strategy fusion。构建 partition 使用 direct-address accumulator/touched list，不创建 Map。

如果敌方 observation 规则未知且会改变 partition：

- Reference 对有限 relation variant 分别构建；
- Value 传播跨 variant interval；
- Proof 返回 UNKNOWN；
- 生产 Fast 不得假设敌方看见 TruthState。

## 9. Action relation

我方当前可统一提交的 action 是所有 world 共享 observation 下的 ActionProgram relation：

```text
commonSubmissionActionSet
executionOutcomeByWorld
```

只在部分 world 执行成功的 command 仍可提交；失败是 world-specific ExecutionStatus。禁止在 world loop 中为我方选择不同 action。高基数 teleport target 先用 cell bitset 表示，再 materialize ActionRecord。

## 10. DD3 候选与决议

### A. Compact WorldSnapshot

- common base + 每 world 固定小 scalar snapshot；
- terrain/entity 使用 sparse overlay；
- materialize 成独立 PhysicalScratch 后推进。

### B. Immutable WorldDelta

- 一个 immutable common PhysicalBase；
- 每 world 保存规范化 delta list；
- materialize 时 apply delta 到 scratch，退出后恢复 BranchMark。

两者必须共享逻辑字段、hash、RuleCorpus fixture 和 Result ABI。DD3 比较真实多 projectile/bomb/hidden queue workload；禁止仅用单 tank pose microbenchmark 选择。

DD3 决议：B 作为 multi-world 默认表示；A 只作为 exactCount=1、无 residual/partition split 的 direct physical fast path。两者调用同一 RulesKernel。packed Array 与递归 driver 退出 production candidate；热池使用 TypedArray SoA，详见 [architecture-prototype-report.md](architecture-prototype-report.md)。

## 11. 多 world 与 make/unmake 不变量

1. 活跃 InformationState 的 WorldRecord 在节点生命周期内不可变。
2. `materializeWorld(i)` 只写专用 PhysicalScratch 或新的 child slot。
3. undo 只恢复当前 scratch 到其 BranchMark，不修改 common base/其他 world。
4. 切换 world 前必须从同一 canonical base materialize，禁止从 world i 的剩余 mutable state继续 apply world j。
5. child InformationState 完成前，parent world/partition/action relation 均保持有效。
6. 任意中断后 root physical signature、world signatures、pool usedCount 和 active masks 完全恢复。

## 12. Hash 与等价合并

### 12.1 PhysicalHash

覆盖所有会改变规则 transition/terminal 的字段：terrain、frame/phase、tank、queue、entity、deadline、star、runtimeOrder 和规则版本。不得包含：

- belief probability；
- opponent model；
- evaluator score；
- Plan；
- cache generation；
- external string ID。

### 12.2 InformationHash

覆盖：

```text
common physical signature
exact support multiset
residual constraints
probability belief/version
our observation history/relation
enemy partition
common action relation
rule assumptions/capabilities
```

world 枚举顺序不能改变 InformationHash。实现使用两个独立 commutative mixed accumulator + count/version；严格 cache 命中还要核验 compact support/partition signature，禁止只信 XOR 或单 hash。

`decisionHash` 与 `informationHash` 分工：

- decisionHash：common physical、完整 possibility support、observation histories、enemy partition、common action relation、规则/assumption；不含概率；
- informationHash：decisionHash + ProbabilityBelief/residual probability version；
- Proof/Hard cache 使用 decisionHash；Value/Expected/Robust cache 使用 informationHash，并额外带 Risk/Profile/Model version；
- opponent model、RiskProfile 和 evaluator weights 不写回 InformationState physical fields。

### 12.3 等价 world

只有在指定 horizon 内以下全部相同才可合并：

- legal submission/execution relation；
- physical transition 与 terminal；
- 双方 observation relation；
- chance support；
- evaluator dependency fields（仅 Value 合并）。

Proof 等价不能依赖概率或 evaluator。

## 13. Owner、生命周期与撤销

| 数据 | Owner | 生命周期 | Undo/commit |
|---|---|---|---|
| MatchStaticState | MatchArena | 整局 | 不变 |
| TrackedRootState | PersistentArena | 跨 callback | shadow generation commit |
| InformationState/WorldRecord | InformationKernel | 当前 search/node | usedCount rewind |
| PhysicalScratch | RulesKernel | 当前 branch | BranchMark |
| Terrain/entity delta | 对应 Kernel | 当前 branch | 专用 reverse delta |
| ProbabilityBelief | BeliefKernel | information node/root | immutable child record |
| EnemyPartition | InformationKernel | information node | usedCount rewind |
| Result/Policy | SearchDriver/StageSolver | search/result | usedCount rewind |

## 14. 容量与 incomplete

- observed/committed physical entity 不得因 world 容量不足被删除；
- exact world 超限时先尝试 lossless residual/equivalence；
- exact world arena 先不足时记录 `INCOMPLETE_WORLD_CAPACITY` 并尝试 lossless residual；residual 也无法表达则最终返回 `INCOMPLETE_RESIDUAL_CAPACITY`，Proof/strict Hard 禁用；
- partition/action/association overflow 各有独立 IncompleteReason；
- top-K 满只影响概率精度，不影响 possibility；
- EmergencyReserve 只保护根事实和最终安全动作，不伪造完整 InformationState。

## 15. 性能合同

- singleton fast path 不初始化 world/partition 大 scratch。
- world record、probability 和 partition 使用 SoA/offset；搜索中零对象、零 Map。
- 合并使用预分配 direct-address table/touched accumulator；radix 仅在 DD5/8 复合 benchmark 证明更优时通过新 physical revision 引入。
- world expansion 支持 iterator/prefix DFS，不 materialize enemy policy 笛卡尔积。
- 每个函数声明 `maxWorldsVisited/maxFactorsExpanded/maxEvents`，预算中断返回合法 interval/incomplete。

## 16. 必须测试

- 两个 world 在同一节点并存且交替 materialize 不互相覆盖；
- hidden tank 与 hidden projectile 相关而非独立组合；
- ambiguous bullet association 保留排列约束；
- enemy information partition 禁止 strategy fusion；
- 当前 observation 相同但敌方 history/own action memory 不同的 world 不得错误合并；
- top-K 删除概率项但 Possibility support 不变；
- lossless residual 展开集合完全相等；
- unrepresentable overflow 返回 incomplete；
- physical/info hash perspective、world-order 和 apply/undo 性质；
- singleton 与 one-world InformationState 结果一致；
- source/minified、cache on/off 一致。

## 17. DD2 决议

InformationState 的语义单位是联合 PhysicalWorld support，不是多个互相独立的风险热图。world storage 必须 immutable 并存，物理推进只在 branch-local scratch 上完成；容量优化可以改变表示，不能改变 support、partition 或策略一致性。
