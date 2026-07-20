# DD2 Observation 与根协调合同

状态：DD2 规范合同 + DD3 physical revision 1；字段语义冻结，热池物理组合为 TypedArray SoA。

关联：`DEC-0001`、`DEC-0011`、`DEC-0012`、`DEC-0013`、`DEC-0026`、`DEC-0037`、`DEC-0038`；`OI-R0-010`、`OI-R1-007`、`OI-ARCH-001`、`OI-ARCH-002`、`OI-ARCH-011`。

## 1. 目标与边界

根入口把平台的 `me/enemy/game` 引用一次性转换为我方拥有的整数状态，并把“观察不到”与“物理不存在”分开。搜索开始后禁止再次读取平台对象。

本合同不负责：

- 推测未确认的技能物理；
- 给 HiddenWorld 分配策略概率；
- 选择动作或执行 HardGate；
- 冻结数组容量和最终 stride；
- 把 v1 的对象状态复制到 v2。

## 2. 根流水线

```text
capture callback scalars/references
  -> validate shape and map
  -> normalize strings/coordinates/remainingFrames
  -> build immutable ObservedRoot
  -> advance TrackedState to platformFrame
  -> reconcile observed and predicted entities
  -> produce RootFactSet + AssociationRelation
  -> build PhysicalState singleton or InformationState
```

入口状态码：

```text
ROOT_OK_SINGLETON
ROOT_OK_INFORMATION
ROOT_INCOMPLETE_RULE
ROOT_INCOMPLETE_CAPACITY
ROOT_INVALID_INPUT
ROOT_FRAME_REGRESSION
```

除 `ROOT_OK_*` 外都不得生成严格 Proof。`ROOT_INVALID_INPUT` 和 frame 回退进入 Emergency emitter；禁止用零值补齐继续普通搜索。
`ROOT_INCOMPLETE_RULE` 必须携带 `INCOMPLETE_UNKNOWN_RULE`；`ROOT_INCOMPLETE_CAPACITY` 必须携带具体 `IncompleteReason`（root entity、world、residual、association 或 partition），不能只有泛化容量标志。

## 3. Null 与字段存在性

每个可空输入先转换为：

```text
FIELD_PRESENT
FIELD_NULL
FIELD_ABSENT
FIELD_INVALID
```

语义矩阵：

| 平台字段 | null 的含义 | 禁止推断 |
|---|---|---|
| `enemy.tank` | 当前我方观察未返回敌方 tank | 敌方一定死亡或不存在 |
| `enemy.bullet` | 当前接口未返回一颗可见敌弹 | 敌方没有 active projectile |
| `me.bullet` | singular own-bullet 接口未返回对象 | overload 的全部己方弹一定消失 |
| `game.bombs` | 非数组为 invalid；空数组表示没有返回可见 bomb | 草中没有 bomb |
| `game.star` | 当前无 active star | 未来不再生成 star |
| `effects.self/debuff` | 对应公开 effect slot 为空 | cooldown 已 ready |

`undefined`、错误类型和 `null` 不可合并。运行时字段新增或缺失先写 observation capability bit；需要该字段才能推进的规则返回 incomplete。

## 4. ObservedRoot 语义布局

DD2 冻结字段集合，不冻结物理数组是否拆分。

除下表特别标注的版本 owner 外，ObservedRoot 全部规范字段均由 ObservationAdapter 拥有、单位取其声明的整数类型、生命周期为当前 callback、根构建后只读且无需 undo。它们先进入 root/observation signature；只有协调后生成的物理语义字段才进入 PhysicalHash，禁止直接 hash 平台引用、raw string 或 absent 字段的零填充值。

### 4.1 Header

| 字段 | 单位/类型 | Owner | Hash | 生命周期 |
|---|---|---|---|---|
| `rootGeneration` | uint generation | RootController | root signature | 每 callback +1 |
| `platformFrame` | FrameT | ObservationAdapter | physics/info | 当前根 |
| `observerSeat` | 0/1 | RuleContext | info | 整局 |
| `width/height/cellCount` | CountT | TerrainKernel | match | 整局 |
| `rulesetVersion/phaseOrderId/terminalPolicyId` | uint | RuleContext | 全部 | build/match |
| `inputCapabilityMask` | bitset | ObservationAdapter | info | 当前根 |
| `rootStatus/incompleteReason` | enum | RootController | result，不进 physics | 当前根 |

`platformFrame` 必须来自 `game.frames`，不得从 callback 次数或 replay `recordIndex` 推导。

### 4.2 Terrain observation

```text
terrainCode[cellCount]
wallBits
dirtBits
grassBits
walkableBits
terrainHashLo/Hi
terrainVersion
topologyVersion
```

- `game.map[x][y]` 在根处完整验证并转换为 `cellId=x*height+y`；编码公式只由 MatchConfig 生成。
- 地图必须矩形、尺寸正数、tile 属于冻结词典；失败为 `ROOT_INVALID_INPUT`。
- 每 callback 扫描全部 cell，成本 O(cellCount)。只有 dirt 等会改变通行/射线的差异才递增 topologyVersion。
- 平台 map 引用是否复用不具有语义；禁止用对象引用相等跳过核对。

### 4.3 Tank observation（每 seat）

```text
tankFieldStatus
externalKeyLo/Hi
cell
directionId
crashed
stars
skillId
skillCooldownFrames
skillReadyFrame
skillActiveType
skillActiveUntilFrame
selfEffectType/selfEffectUntilFrame
debuffType/debuffUntilFrame
statusFlags
actionSpeedClass
canActThisFrame
bombCooldownReadyFrame
bombActiveObserved
```

- 我方 tank 必须 FIELD_PRESENT；否则根输入 invalid。
- 敌方 tank 为 null 时只写 `tankFieldStatus=FIELD_NULL`，cell/direction 使用 INVALID，不清除 TrackedState。
- skill type 对双方公开，根处一次转为整数；搜索不得比较字符串。
- `enemy.stars`、enemy bomb cooldown/active 等未在 Guide 同一数据表明确保证的字段都按 capability 单独校验；FIELD_ABSENT 不得写 0/ready。
- `remainingFrames` 通过冻结的 `remainingToDeadline(ruleId, platformFrame, remaining)` 转为绝对 deadline。遇到未校准 off-by-one 使用 RuleAssumptionMask，不在各模块自行加一。
- status 与 effect 互相矛盾时保留二者的观察事实并返回 `ROOT_INCOMPLETE_RULE`，禁止任选一个。
- `status.shielded` 不公开 `hitsRemaining`。没有完整因果事件时必须保留合法 hit-count support，禁止沿用 v1“我方 1、敌方 2”的不对称猜测。

### 4.4 Entity observations

```text
observedProjectileCount
observedProjectileOwner[]
observedProjectileCell[]
observedProjectileDirection[]
observedProjectileExternalKeyLo/Hi[]
observedProjectileFieldMask[]

observedBombCount
observedBombCell[]
observedBombOwnerKeyLo/Hi[]
observedBombExternalKeyLo/Hi[]
observedBombExplodeAtOrInterval[]
observedBombFieldMask[]
```

指南只保证 singular `me.bullet/enemy.bullet`，内部列表不能因此限制为一颗。根 Adapter 把每个返回对象写成 observation record；TrackedState 与 overload/隐藏 projectile 负责补足未返回实体。

`game.bombs` schema 未被 Guide 完整公开。位置以外的 `id/owner/timer` 都由 capability bit 标明；未知 timer 保存区间 `[platformFrame, platformFrame+10]` 或由已知 placement 约束收紧，必须包含“本帧 T80 爆炸”的安全候选，禁止默认为“刚放置”。

### 4.5 Star observation

```text
starPresence       // PRESENT | NONE | INVALID
starCell
starSpawnModelId
```

当前 `game.star` 是公开精确事实；未来位置/时间模型不进入 ObservedRoot physics hash。

## 5. TrackedState

TrackedState 跨 callback 保存我方已知但本帧不一定返回的事实：

```text
trackedFrame
ownSubmittedQueue
confirmedEntityPools
associationRelations
hiddenEntityConstraints
lastObservationSignatureBySide
lastVisibleTankPoseBySeat
terrainVersion/topologyVersion
runtimeControllerState
trackEpoch
```

规则：

1. 先按冻结 FrameTimeline 把 tracked support 推进到当前 `platformFrame`，再与观察匹配。
2. 已提交己方 command、projectile 和 bomb 的因果前缀优先于启发式关联。
3. 不可见不删除；只有“接口在此状态必然完整返回且预测实体必然可见”时，缺失才能成为失效证据。
4. singular bullet API 永远不是 active projectile 集合的完整枚举证明。
5. frame 倒退、match identity 改变或规则版本改变时整体重建，不复用旧 track。

TrackedState 是事实/约束 owner，不保存 Evaluator score、对手概率或 Plan 意图。

### 5.1 callback 间隔推进

`onIdle` 只在己方 queue 为空时调用，因此两个 callback 之间可以跨越多帧。推进规则：

- 己方已提交 queue 精确执行；
- committed projectile/bomb/effect 按自动 phase 精确推进；
- 未观察的敌方 queue/action 历史成为联合 HiddenWorld/QueueSupport，不能当作当前敌方新选择或默认 HOLD；
- 每个跳过 frame 的 visibility/terminal 约束用于过滤 support；
- 可用 deadline 跳过没有事件的自动区间，但不能跨过 action slot、观察分裂或实体 substep；
- gap support 超出 lossless residual 能力时返回 `ROOT_INCOMPLETE_CAPACITY + INCOMPLETE_RESIDUAL_CAPACITY`，不得只外推最后位置。

## 6. 根协调算法

### 6.1 Tank

- 我方以 seat 固定 handle 协调；位置/方向必须精确覆盖预测根。
- 可见敌方以 external key（若存在）和物理候选共同协调。
- 敌方 null 时，将可与当前视野规则一致的候选保留；明显应可见但未返回的 world 被删除。
- 若所有 world 被删除，返回 `ROOT_INCOMPLETE_RULE`，不得重新凭空放置敌方。

### 6.2 Projectile/Bomb

调用 [entity-data-association-contract.md](entity-data-association-contract.md) 建立候选二部关系。结果分为：

```text
ASSOCIATED_EXACT
ASSOCIATED_AMBIGUOUS
OBSERVED_NEW_ENTITY
PREDICTED_HIDDEN
PREDICTED_INVALIDATED
ASSOCIATION_INCOMPLETE
```

歧义进入 InformationState 的联合约束，不通过复制一份“最可能”实体解决。

### 6.3 Observation consistency

对每个候选 PhysicalWorld 运行与平台同源的 `observeForSide(world, observerSeat)`，比较 canonical observation relation：

- 完全不相容的 world 删除；
- 同 observation 的 world 合并到同一 InformationState；
- 仅概率为零不能删除 world；
- 观察规则本身未知时保留 RuleVariant/incomplete，不把差异当 HiddenWorld chance。

## 7. Observation signature

每方 signature 至少覆盖：

```text
platformFrame
visible terrain/topology version
own tank/public status
returned enemy tank relation
returned projectile relation
returned bomb set relation
star
skills/effects/status capability mask
queue poll eligibility
```

使用 `signatureLo/signatureHi + structural counts`。单独 32 位 hash 不得决定 InformationState 合并或 Proof；collision check 必须比较规范字段/关系摘要。

## 8. Hash、撤销与缓存

- ObservedRoot 在搜索中只读，不需要 undo。
- TrackedState 只在 callback 边界提交；协调失败时保留上一 committed generation，不留下半更新。
- terrainHash 只覆盖当前 tile；topologyVersion 进入 path/ray cache key。
- observation signature 不进入 PhysicalHash，但进入 decisionHash（因此也进入 informationHash）、ObservationPartition 和 BeliefCache key。
- input capability、association ambiguity 和 incomplete reason 必须进入 InformationState assumption/coverage，不能只写日志。

## 9. 性能合同

```text
O(cellCount)
+ O(observedEntities * trackedEntities)
+ O(candidateWorlds * observationSignatureCost)
```

- 1v1 规则生成上限内 projectile/bomb 使用固定小循环；DD3 比较二部扫描与签名直达表。
- 根转换允许读取字符串和平台对象；完成后热路径零字符串、零 Map、零对象分配。
- 不创建 map clone；直接写预分配 terrainCode/bitset。
- 使用 shadow write + commit generation，避免协调中断破坏上一根状态。
- wall clock 只由外层 RuntimeController 在批次边界读取。

## 10. 必须测试

- enemy tank visible→grass null→visible；
- cloak open-ground null 与 teleport reveal；
- visible bullet→转向后 null 但 projectile 保留；
- overload 两弹但 singular bullet observation；
- grass bomb 不在 `game.bombs` 但保留到 explode/失效；
- visible bomb 无 timer 字段；
- dirt 被毁导致 terrain/topology version 更新；
- frame regression/match switch 清空 track；
- malformed map/position/direction；
- status/effect 矛盾返回 incomplete；
- root capacity overflow 不截断实体；
- source/minified 产生相同 ObservedRoot 与 signature。

## 11. DD2 决议

平台对象只允许存在于根 Adapter 调用栈。`null` 是观察事实，不是物理删除命令；所有跨帧实体先进入 TrackedState，再通过可见性与关联约束形成 singleton PhysicalState 或 InformationState。
