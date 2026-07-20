# DD2 实体身份与数据关联合同

状态：DD2 规范合同 + DD3 physical revision 1；handle 语义、关联不变量和 TypedArray SoA pool 形状已冻结；生产容量由DD8 manifest合同约束并待v2 benchmark选值。

关联：`DEC-0012`、`DEC-0013`、`DEC-0015`、`DEC-0034`；`OI-R0-010`、`OI-R1-002`、`OI-R1-007`、`OI-ARCH-011`。

## 1. 核心原则

1. 平台字符串 `objectId` 不是内部地址，也不保证所有 runtime entity 都提供 ID。
2. 每颗 projectile、每个 bomb 都有独立内部 handle；overload 只通过 `shotGroupHandle` 表示共同来源。
3. 一次观察可能对应多个已有实体；歧义必须保留为关系，禁止贪心合并。
4. 已出现实体保留到物理失效或严格可见性反证，不使用固定 TTL 删除危险。
5. cache/Plan/事件中的实体引用必须验证 generation。

244 局平台 corpus 观察到外部 ID 长度 8、16、17，且 Guide 的 bullet schema 没有公开 ID。外部模拟器的 runtime bullet 也只返回 position/direction。因此禁止解析 ID 字符串前缀、长度或数字部分推导 owner/type。

## 2. EntityHandle

候选 32 位布局：

```text
bits  0..11  slot          // 0..4095
bits 12..15  entityType    // 16 kinds
bits 16..31  generation    // 1..65535
INVALID_HANDLE = 0xffffffff
```

所有运算最终 `>>> 0`。构建配置任一实体池需要超过 4096 slot 时必须失败并要求新的宽 handle ABI revision，禁止截断；DD3 没有把 conservative profile 伪称为平台上限。

Generation 规则：

- slot 初次启用 generation=1；0 保留为未初始化；
- 每次回收到 free-list 前递增；
- generation 将 wrap 时该 slot 在本局永久 retired；
- handle 比较同时比较 type、slot、generation；
- 根 track、PhysicalWorld、Event、Plan 和 cache 都不能只存 slot。

固定 tank 也使用 handle；seat 不是 handle。tank slot 可整局 pinned，但仍验证 generation，防止 match 切换后复用。

### 2.1 EntityType

```text
0  RESERVED
1  TANK
2  PROJECTILE
3  BOMB
4  SHOT_GROUP
5  EFFECT_SOURCE
6..15 RESERVED_APPEND_ONLY
```

EntityType 数值只能追加，删除保留 tombstone。star 是单例 objective state，不进入 entity pool。terrain 使用 cell/version，不伪装成 entity。

## 3. 外部身份键

平台 ID 只在 ObservationAdapter 冷边界规范化为：

```text
externalKeyPresent
externalKeyLo
externalKeyHi
externalKeyLength
externalEntityTypeHint
```

Lo/Hi 使用两个独立的构建期固定 32 位字符串 hash；正式搜索不保留字符串。碰撞处理：

- key 不同可以快速排除；
- key 相同只增加候选优先级，不能单独证明同一实体；
- 必须同时满足 type、owner、可达位置、方向、deadline 和因果约束；
- 多个候选仍可行时保留 AssociationRelation；
- ProofCache 不以 external key 作为唯一实体签名。

外部 key 缺失是正常 capability，不是 invalid。

## 4. 两层实体记录

### 4.1 Persistent TrackRecord

描述“我们知道什么”：

```text
handle
trackKind                 // CONFIRMED | COMMITTED_OWN | POSSIBLE | INVALIDATED
ownerSeatMask
externalKey*
firstKnownFrame
lastObservedFrame
lastAdvancedFrame
associationEpoch
confirmationMask
possiblePhysicalDomainOffset
sourceCommandKey
shotGroupHandle
invalidationReason
```

TrackRecord 可以关联多个可能 PhysicalEntityState；它本身不是一个完整 PhysicalWorld。

### 4.2 PhysicalEntityState

描述一个 world 中的精确物理事实：

Projectile：

```text
handle/ownerTankHandle/shotGroupHandle
causalSourceKeyLo/Hi/shotMemberIndex
cell/direction
createdAtFrame
active
substepCursor
damageKind/effectKind
```

Bomb：

```text
handle/ownerTankHandle
causalSourceKeyLo/Hi/placementOrdinal
cell/placedAtFrame/explodeAtFrame
active
damageKind
```

Tank：

```text
handle/seat/cell/direction/crashed
stars/skill/effect/status/deadlines
```

规则未知导致的 deadline 区间属于多个 PhysicalWorld 或 residual constraint，不能把一个 PhysicalEntityState 写成“半确定物理对象”。

`causalSourceKey + member/placement ordinal` 是跨 arena 的 canonical semantic identity。未知敌方来源必须在 world/residual 中分配稳定的 symbolic source key；禁止退回 raw slot/generation。若两个实体在冻结 horizon 内所有语义字段完全相同，它们可按 multiplicity canonicalize，但关联关系仍保留计数。

## 5. ShotGroup

一次成功 FIRE 创建一个 shot group：

```text
shotGroupHandle
ownerTankHandle
sourceCommandKey
createdAtFrame
memberHandleStart/memberCount
memberOrdinalStart
skillModifier
```

- 普通射击 memberCount=1；overload=2；
- 每个 member 独立位置、方向、事件和失效；
- group 仅用于因果、观察关联和 Plan/cache 共享，不共同决定生死；
- group 在所有 member 失效且无 Plan/cache pin 后回收。

## 6. AssociationRelation

给定预测 track 集 `P` 和观察记录集 `O`，建立二部候选：

```text
candidateMaskByObservation[o]
candidateMaskByTrack[p]
newEntityAllowed[o]
hiddenContinuationAllowed[p]
relationVersion
```

候选边必须通过：

1. entity type；
2. owner/owner mask；
3. 从 `lastAdvancedFrame` 到当前帧的物理可达性；
4. cell/direction/phase；
5. terrain 与已确认 stop event；
6. placement/fire/overload 因果；
7. 可用时的 external key。

### 6.1 结果分类

| 条件 | 结果 |
|---|---|
| observation 与 track 一一唯一且约束完整 | `ASSOCIATED_EXACT` |
| 多个 matching/排列仍可能 | `ASSOCIATED_AMBIGUOUS` |
| 无旧 track，但当前规则允许新实体 | `OBSERVED_NEW_ENTITY` |
| track 未返回且仍可能隐藏/被 singular API 省略 | `PREDICTED_HIDDEN` |
| track 在完整可见集合中缺失或遇到确定 stop | `PREDICTED_INVALIDATED` |
| support、字段或容量不足 | `ASSOCIATION_INCOMPLETE` |

歧义关系以 bitset/factor 保存，InformationKernel 惰性展开；禁止立即 materialize 所有排列。

## 7. 特定实体协调

### 7.1 Own projectile

己方已提交 FIRE、执行 frame 和 created event 构成最强因果。`me.bullet` 只用于确认/纠错，不得删除未返回的 overload member。自身 active projectile 的物理上限由规则表生成。

### 7.2 Enemy projectile

- 可见 observation 与所有物理可达 projectile 建候选；
- `enemy.bullet=null` 只排除“当前规则保证会被 singular 接口选中”的候选；选择规则未知时不删除；
- 我方转向造成离开视锥时，track 继续按两个 substep/frame 推进；
- projectile 只有碰墙、命中、越界、terrain stop 或严格可见性反证后 invalidated。

### 7.3 Bomb

- own bomb 由 THROW_BOMB command、owner bombActive/status 和 deadline 精确跟踪；
- visible bomb 若提供 ID/timer则作为额外约束，不作为必需字段；
- 草中 bomb 的缺失不产生删除边；
- `explodeAtFrame` 到达后必须推进 T80，不能仅因 observation 缺失提前删除。

### 7.4 Hidden tank

tank handle 整局稳定；隐藏只改变 possible pose domain，不创建“新 enemy tank”。重新可见时把 pose observation 与原 handle 的候选 world 协调。

## 8. 失效、回收与 pin

合法失效原因：

```text
OUT_OF_BOUNDS
WALL_HIT
DIRT_HIT
TANK_HIT
SHIELD_HIT
BOMB_EXPLODED
RULE_EVENT
COMPLETE_VISIBILITY_ABSENCE
MATCH_RESET
```

禁止使用 `AGE_LIMIT` 作为已确认 projectile/bomb 的物理失效原因。概率模型可以降低权重，但 Possibility support 不删除。

slot 只有满足以下条件才能回收：

- 所有 live PhysicalWorld 均 inactive；
- 不再被 TrackedState、EventBuffer、Plan 或 active search branch 引用；
- 相关 cache 通过 generation/version 不再可命中；
- 本次 root commit 已完成。

生产实现使用 generation + arena/root epoch 避免逐实体 refcount；DD3 已验证并存 world 与 branch rewind 不互相覆盖，DD5 必须再做 Reference/Fast 生命周期差分。

## 9. Hash 与缓存

- PhysicalHash 包含 active entity 的 canonical semantic identity、物理字段和 multiplicity，但不包含 raw slot/generation 或 external key；携带 handle 的 cache/Event/Plan 另外验证 generation。
- decisionHash 包含 association relation、possible domains、trackEpoch 和 observation capability；informationHash 继承这些字段并增加 ProbabilityBelief/version。
- entity-local trajectory/cache key 至少包含 handle、generation、terrainVersion、phaseOrderId 和 start physical signature。
- relationVersion 改变使 BeliefCache、InformationTT、ObservationPartition 和相关 Plan 失效。
- hash 命中后仍核验 type/generation/关键物理签名；不得让 hash collision 合并实体。

## 10. 性能合同

- 规则上限内默认 O(observations × tracks)，没有字符串比较、对象、Map 或排序。
- candidate mask 在容量 ≤32 时可用 Uint32；更大时用构建期定长 bitset。
- touched-list 清理 relation scratch，不全量清空大型矩阵。
- exact unique match 快路径不创建 HiddenWorld。
- ambiguity factor 超出容量时返回 `ASSOCIATION_INCOMPLETE`，不贪心选最近实体。

DD3 必须 A/B：小型全扫描、按 `(type,owner,cell,direction)` 直达 bucket，以及 external-key hint table。只有复合根协调 Benchmark 的赢家进入生产。

## 11. 必须测试

- 外部 ID 同值但物理不相容；
- 不同长度/格式 ID 不被解析；
- bullet 无 ID 的唯一/歧义关联；
- overload 两 member 只返回一个 observation；
- 两个敌方 projectile 交叉后不交换 handle；
- grass bomb 消失/重现保持 generation；
- projectile 失效后 slot reuse 使旧 Plan/cache 拒绝；
- generation wrap retire；
- association overflow 返回 incomplete；
- cache on/off、source/minified 关联结果一致。

## 12. DD2 决议

内部身份由 `EntityHandle(type,slot,generation)` 决定，外部 ID 只是冷边界提示。任何不能唯一关联的 observation 都成为显式 AssociationRelation，并保持实体间相关性直到规则或后续观察消除歧义。
