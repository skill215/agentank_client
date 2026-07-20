# DD5 FastKernel 合同

状态：DD5 规范合同，2026-07-15。冻结 FastKernel 的生成输入、整数接口、单帧执行、make/unmake、失败语义和复杂度边界；生产容量与缓存配额遵守DD8合同并待v2 benchmark选值。

关联：`DEC-0010` 至 `DEC-0013`、`DEC-0025` 至 `DEC-0030`、`DEC-0036` 至 `DEC-0046`；[dd3-frozen-abi.md](dd3-frozen-abi.md)、[reference-kernel-contract.md](reference-kernel-contract.md)、[dd4-rule-corpus.json](dd4-rule-corpus.json)。

## 1. 目标与非目标

FastKernel 是 production search 唯一物理转换实现：

```text
完整 PhysicalState offset
+ 双方 ExecutedFrameAction / command head
+ ChanceCode
+ 构建时冻结的整数 RuleTable
-> ordered EventBuffer
-> 原地 child PhysicalState
-> TerminalResolution
+ 可完全撤销的 TransitionDelta
```

目标：

- 热路径只读写预分配 TypedArray SoA，不创建临时对象、数组、字符串、闭包或 Promise；
- 与 ReferenceKernel 对相同冻结规则产生相同 event、state、observation relation 和 terminal；
- 每个写操作先确保对应 delta/event 容量，任何失败 fully undo；
- 单实体、多 projectile、多 bomb 和 terrain mutation 使用同一代码路径；
- 未确认 RuleVariant、字段未知或容量不足显式 incomplete，不猜默认结果；
- singleton PhysicalState 与 multi-world materialized scratch 共用同一 Fast transition。

非目标：

- 不决定策略、风险、评分、对手概率、搜索深度或最终 action；
- 不读取平台 `me/enemy/game` 对象、Guide、replay 或 v1 状态；
- 不在搜索节点枚举开发期 RuleVariant；
- 不把 Hazard、Cache 或 Reference helper 当作物理事实来源；
- 不在 DD5 冻结生产池大小、TT 大小或时间预算。

## 2. 版本和生成边界

```text
FAST_KERNEL_ABI_REVISION       = 1
FAST_RULE_TABLE_ABI            = INTEGER_TABLE_V1
FAST_TRANSITION_ABI            = PREPARE_COMMIT_UNDO_V1
FAST_TRACE_ABI                 = CANONICAL_EVENT_V1
FAST_OBSERVATION_ABI           = RELATION_SIGNATURE_V1
```

构建器只从已校验的 RuleCorpus 和 build manifest 生成 production 表。生成输入 fingerprint 至少包含：

```text
RuleCorpus SHA-256
RULESET_VERSION
phaseOrderId
terminalPolicyId
skillRuleTableVersion
DD3_PHYSICAL_ABI_REVISION
capacityManifestFingerprint
assumptionMask
```

production 表只保留整数语义，不保留 source URL、evidence 文本、match id、fixture 注释、handler 字符串或 variant 名称。开发构建另保留 `integerId -> readable name` 映射，但转换函数不得读取它。

若一个 active variant group 在当前 fixture/context 可能产生不同输出，则该规则不能进入该 production RuleTable。构建必须失败或把对应能力标记 `FAST_CAP_UNSUPPORTED`；不得在每个节点执行 variant 分支。

## 3. 生成整数表

### 3.1 表组成

```text
PhaseTable
  phaseCode[]                 Uint8
  phaseHandlerCode[]          Uint8
  phaseCapabilityMask[]       Uint32

RuleTable
  ruleCode[]                  Uint16
  ruleStatusCode[]            Uint8
  handlerCode[]               Uint8
  readMaskLo/Hi[]             Uint32
  writeMaskLo/Hi[]            Uint32
  eventMaskLo/Hi[]            Uint32
  proofEligibilityMask[]      Uint32
  unknownBehaviorCode[]       Uint8

SkillTable
  skillCode[]                 Uint8
  duration[]                  FrameT
  cooldown[]                  FrameT
  chargeCount[]               Uint8
  capabilityMask[]            Uint32
  handlerCode[]               Uint8

TerminalTable
  triggerPriority[]           Uint8
  tiebreakPriority[]          Uint8
  frameLimitRecordCount       FrameT
  runtimeComparatorCode       Uint8

CapabilityTable
  enabledMaskLo/Hi            Uint32
  unsupportedMaskLo/Hi        Uint32
  strictEligibleMaskLo/Hi     Uint32
```

表中所有 id、位宽、范围和 sentinel 由单一生成器输出。业务模块禁止复制魔数。构建器验证：id 唯一、引用闭合、值可表示、phase 单调、每个 write 有 owner、每个 event 有容量上限、每个 unsupported rule 有失败出口。

### 3.2 Common path

有限 variants 只有在所有候选对当前输入投影为同一 state/event/terminal/observation 时，才能由 Reference harness 生成 `COMMON_PATH_CONFIRMED` fixture。Fast 执行 common handler，并在 capability precondition 不成立时返回 unsupported。

这允许无争用 projectile/bomb、无 contest star/move 等路径高性能执行，同时禁止把 shared-resource 次序猜测写入正式物理。

## 4. 输入和输出 ABI

语义签名：

```text
prepareJointPhysical(parentOffset,
                     ourActionRef, enemyActionRef, chanceCode,
                     branchMarkOffset, outPreparedOffset) -> FastStatus

commitPreparedJoint(parentOffset, preparedOffset,
                    outTerminalOffset, outObservationOffset) -> FastStatus

applyJointPhysical(parentOffset,
                   ourActionRef, enemyActionRef, chanceCode,
                   branchMarkOffset,
                   outTerminalOffset, outObservationOffset) -> FastStatus

undoTo(branchMarkOffset) -> FastStatus
```

`applyJointPhysical` 是 prepare + commit 的融合热路径；分离接口只用于 action HardGate 的无副作用预检、差分定位和故障注入。两条路径必须生成相同 canonical trace fingerprint。

FastStatus：

```text
FAST_APPLIED
FAST_APPLIED_TERMINAL
FAST_UNSUPPORTED_RULE
FAST_INCOMPLETE_STATE
FAST_INCOMPLETE_ENTITY_CAPACITY
FAST_INCOMPLETE_EVENT_CAPACITY
FAST_INCOMPLETE_DELTA_CAPACITY
FAST_INCOMPLETE_OBSERVATION_CAPACITY
FAST_INCOMPLETE_INTERNAL_CONSISTENCY
FAST_EXECUTION_ERROR
```

只有前两个状态可把 child 留在 scratch。其他状态必须恢复到传入 BranchMark，并保持 root hash、entity multiset、active masks、terrain、usedCount 和 phase 完全一致。

FastStatus 不承载 SubmissionLegality、HardGateStatus、ProofStatus 或 BoundKind。提交非法在动作生成/提交层处理；物理执行失败仍可产生规范 execution event，但不是 kernel 异常。

## 5. 单帧执行顺序

当前生成的主表按 DD4 冻结：

```text
P00 TIMED_EXPIRY
P10 STAR_SPAWN
P20 OBSERVE_OR_POLL
P30 SEAT_0_ACTION
P40 SEAT_1_ACTION
P50 STAR_COLLECTION
P60 PROJECTILE_SUBSTEP_0
P61 PROJECTILE_SUBSTEP_1
P70 BOMB_RESOLUTION
P80 TERMINAL_RESOLUTION
P90 OBSERVATION_EMISSION
```

Fast 执行算法：

```text
1. 保存生成式 BranchMark，并校验 parent phase/hash/active masks。
2. 读取 capability mask；缺失已触发能力则 UNSUPPORTED + undo。
3. 预留本 transition 的保守 event/delta 上限；无法预留则 INCOMPLETE + undo。
4. 处理绝对 deadline 到期的 effect、lock、queue 状态。
5. 处理已知 star spawn；未知 future star 不进入 Fast exact transition。
6. 对 seat0、seat1 依次 prepare 后 commit ExecutedFrameAction。
7. 按已选 contest rule 收星；触发未知争用则 UNSUPPORTED。
8. 对 substep0、substep1 扫描 active projectile mask 的稳定 slot 顺序。
9. 对 due bomb 扫描稳定 slot 顺序；触发未知共享资源次序则 UNSUPPORTED。
10. 在完整 damage batch 后调用 TerminalResolver。
11. 生成双方 ObservationRelation signature/alternatives。
12. 递增 frame/版本，校验 child invariants，返回 applied/terminal。
```

recordIndex127 的完整 phase 执行后才进入 frame-limit terminal。Fast 不能恢复旧 `BEFORE_ACTION_128` 候选。

## 6. Prepare、commit 与撤销

### 6.1 写入协议

每个 owner 的写入遵守：

```text
validate input and capability
compute required record counts
reserve delta and event capacity
append old value to owner delta
write new value
update owner hash/version
append canonical event
```

禁止先写 state、之后才发现 delta 无容量。一个 phase 内可能由前一事件改变后续预留量时，使用构建期 worst-case phase bound 或分段 mark；不得依赖可增长数组。

### 6.2 BranchMark

使用 [dd3-frozen-abi.md](dd3-frozen-abi.md) 的 generated used counts，并补充生成表要求的 owner mark。撤销顺序严格为提交的逆序：

```text
observation scratch
terminal scratch
hazard deltas
entity deltas
terrain deltas
generic transition deltas
events
arenas
hash/version restore
```

`undoTo` 不运行规则，不重新计算 parent；它只消费反向 delta。开发构建在每个 fixture 后比较 canonical parent signature，production 构建保留 O(1) compact signature guard。

### 6.3 事件与 delta 分离

- EventBuffer 是规范语义输出，按 phase/substep/sequence 排序；
- TransitionDelta 只存恢复所需旧值，可按 owner 压缩；
- 一个 event 可以对应多个 delta，一个 delta 也可能无外部 event；
- HazardDelta 记录派生 committed timeline 的增删，不得与 projectile physical delta 共用语义；
- event overflow 和 delta overflow 分别报告，不提交部分 trace。

## 7. 模块合同与复杂度

设 `T=2`、`P=activeProjectileCount`、`B=activeBombCount`、`E=dueEffectCount`、`A=commandsInExecutedProgram`、`V=visibleEntityAlternatives`。所有数量由 manifest 上限约束。

| 热模块 | 单 transition 复杂度 | 禁止行为 |
|---|---|---|
| Scheduler | `O(T + A)` | 扫描 replay/history、字符串 command dispatch |
| TimedEffect | `O(E_due)`，使用 deadline bucket/active list | 每帧扫描全部历史 effect |
| Terrain | `O(mutations)` | 复制全图、动态对象 cell |
| Entity | `O(P*2 + B_due + spawned)` | filter/map/splice、按外部 string id 查询 |
| Skill | `O(T + emitted skill entities)` | 浮点概率、规则名 switch |
| Star | `O(T)` common path | 未确认 contest 时任选 seat |
| Terminal | `O(1)` | 回扫 events、读取评分或 risk |
| Observation | `O(P+B+T+V)`，固定 bitset/ray query | 建立 JS alternatives 数组 |
| Hash | `O(actual writes)` | 每节点全状态重 hash |
| Undo | `O(actual deltas)` | clone parent 恢复 |

静态 terrain 的 ray/topology 表整局共享；分支 terrain mutation 使用版本和 dependency mask。无 terrain/entity 事件时，不允许全图刷新 Hazard、Path 或 visibility。

## 8. 实体和技能执行约束

### 8.1 Projectile

- 每颗 projectile 有独立 handle/generation、owner、shotGroupHandle、memberOrdinal、cell、direction、createdFrame 和 active 状态；
- overload member0/member1 使用 DD4 固定 geometry，随后完全独立；
- 每颗 active projectile 每帧最多两个 substep，命中 tank/shield/dirt/wall/boundary 后立即失效；
- projectile crossing 不产生相互碰撞；在平台证据升级前携带 assumption bit，不能生成无假设 strict Proof；
- 多 projectile 共享目标若会触发未冻结 resource order，Fast 返回 unsupported；不受次序影响的 common path 可继续。

### 8.2 Bomb

- active bomb 具有 placedFrame、explodeFrame、owner、cell、visibility、blast descriptor；
- 只在 P70 解析 due bomb；blast 的 wall/dirt 截止由冻结 rule handler 决定；
- 多 bomb 共享 dirt/shield/tank 且 variant 输出分歧时 unsupported；
- shield 对 bomb damage 的消费与 bullet 两 charge 规则分离。

### 8.3 Skill

技能只读生成的 SkillTable 和 state fields。stun/teleport 概率由 ChanceCode 输入；Fast 不生成或估计概率。poison按施加后相对`ACT-HOLD-ACT-HOLD`执行；只有empty-repoll/ready边界、teleport reveal deadline等未冻结分支在当前transition不依赖时走common path，否则unsupported。

## 9. ObservationPartition 边界

Fast transition 为每一 side 输出规范 observation relation：

```text
relationSignatureLo/Hi
alternativeStart/count
completenessCode
incompleteReason
```

`partitionByObservation` 属于 InformationKernel：它遍历已 materialize physical children，以完整 observation history、own action memory 和 relation signature 分组。Fast 只生成 side-legal relation，不能访问“搜索者知道但该 side 不知道”的 world label。

singular `enemy.bullet` 对应多 projectile 时，relation alternatives 必须保留所有 API 可能选择；容量不足为 support-critical incomplete，不能只保留最近一颗。

## 10. HardGate 的调用边界

每个候选 action 在评分前必须经历真实候选转换，而不是只按目标 cell 静态过滤：

```text
SubmissionLegality
-> enumerate relevant enemy action / chance / physical support as required
-> Fast prepare/apply
-> HazardKernel committed check / ReverseViability
-> TerminalResolver
-> classify HardGateStatus
-> fully undo candidate
-> only HARD_ALLOW enters Risk/Evaluator scoring
```

Hazard 可提前提供禁入 cell-time bitset作 broad phase，但最终结论必须由 Fast transition + Terminal/viability certificate核验。Fast 不自行返回 `HARD_REJECT_PROVEN`。

## 11. UNKNOWN、容量与异常

| 情况 | Fast 行为 | 上层行为 |
|---|---|---|
| active RuleVariant 未冻结 | `FAST_UNSUPPORTED_RULE` | Hard/Proof incomplete；Value 外扩/禁用能力 |
| state typed unknown 被 transition 读取 | `FAST_INCOMPLETE_STATE` | 补 world/support 或返回 incomplete |
| fact-critical entity overflow | `FAST_INCOMPLETE_ENTITY_CAPACITY` | 丢弃 search generation，进入 emergency |
| support/observation overflow | 对应 incomplete | 不得裁 possibility |
| event/delta overflow | 对应 incomplete + undo | 调低搜索质量不能修复事实 |
| cache miss/full | 不影响 FastStatus | 直接重算或无缓存执行 |
| invariant/hash mismatch | `FAST_INCOMPLETE_INTERNAL_CONSISTENCY` + undo | 禁止发射该搜索结果 |

任何 incomplete 都不能被解释为正常执行、未命中、无危险或 DRAW。

## 12. 差分与发布资格

FastKernel 获得 production 资格前必须通过：

1. DD4 全部可执行 fixture 的 Reference/Fast ordered trace 差分；
2. common-path fixtures 对所有 variant 投影一致；
3. mirror seat、方向旋转/反射、实体排列变换性质测试；
4. apply/undo 后 root signature、每个 owner usedCount、mask、hash 和版本完全恢复；
5. EVENT/DELTA/ENTITY/OBSERVATION 容量故障注入；
6. cache-off/on、source/minified 相同 semantic fingerprint；
7. committed projectile/bomb 从创建到失效的跨 depth 生命周期；
8. unresolved rule 不产生 strict Terminal/Hard/Proof。

DD5 冻结的是这些可执行合同和覆盖矩阵，不宣称尚未实现的 JavaScript FastKernel 已经运行通过。实现阶段必须把差分门作为合并和发布的前置条件。

## 13. DD5 冻结结论

Fast 物理只有一条生成表驱动、prepare/commit/undo 的整数路径。Reference 提供语义 Oracle，Hazard 提供派生加速，Cache 提供可关闭的性能优化；三者都不能取代 Fast 的实际规则执行。任何未知、容量不足或一致性故障都会 fully undo 并显式 incomplete，因此不会用速度交换物理真实性。
