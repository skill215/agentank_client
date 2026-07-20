# DD1 FrameTimeline 与 Canonical Event 合同

状态：DD1 规范合同 + DD3 physical revision 1。主 phase 顺序由官方 Guide 与 244 局平台 replay 固化；未覆盖的复合边界使用有限 RuleVariant。Event 字段/整数 ABI 见 [action-result-abi.md](action-result-abi.md)，物理 EventBuffer 为预分配 TypedArray SoA。

关联：`DEC-0026`、`DEC-0027`、`DEC-0033`；`OI-R0-002` 至 `OI-R0-010`、`OI-R1-001` 至 `OI-R1-009`。

## 1. 时间坐标

禁止混用四种计数：

| 名称 | 定义 |
|---|---|
| `platformFrame` | `game.frames` 的绝对值；所有 effect、bomb、lock 使用它 |
| `recordIndex` | raw replay `records[]` 的数组下标；index 0 通常是初始 star setup |
| `decisionPly` | 搜索中的战略决策层数，不等于真实帧数 |
| `phaseOrdinal` | 当前 platformFrame 内的固定 phase 编号 |

带日志的真实 replay 显示 callback frame 从 1 开始；raw `records[0]` 为 setup。Historical Adapter 必须保存显式 `recordIndex -> platformFrame` 映射，禁止继续用隐式 `frame+1` 假设生成严格 fixture。

所有 deadline 使用绝对 platformFrame：

```text
expiresAtFrame
explodeAtFrame
cooldownReadyFrame
starSpawnAtFrame
fireLockUntilFrame
pickupLockUntilFrame
```

`remainingFrames` 只在 ObservationAdapter 边界计算，不进入 canonical physics hash。

## 2. 平台 replay 证据摘要

扫描 corpus fingerprint `965dcfe90d3605e848485dfc0d1a6926e01d52118f299110f8ef6c1491e04e85` 的 244 个唯一对局、10,996 个有序 replay frame：

- 9,642 个双方都有 action event 的 frame 全部为 seat 0 后 seat 1，无反例；
- 3,305 个 action 与 bullet movement 共存的 frame 全部先 action 后 bullet；
- 3,103 个完整 projectile frame 的 order 为 `0,1`；546 个在 order 0 后失效；
- 1,078 个创建后当帧移动样本全部 `created` 先于 `go`；
- 345 次 star collection 全部在双方 action 后；其中与 bullet 共存的 95 次全部在 bullet 前；
- 228 个可配对 star 重生样本全部与收集相差 10 个 record frame；
- 38 个可配对 bomb 全部 placement 后 10 frame 爆炸，且爆炸在 action/bullet 后；
- bomb causal 样本包含 1 次“旧位置在爆区、先移出后存活”和 3 次“旧位置安全、先移入后被炸”；
- timed skill expiry 位于 action 前；overload 成功射击的 expiry 位于两颗 bullet creation 后，属于消费事件而非计时到期；
- freeze：seat 0 施放的 14 个样本均抑制 seat 1 当帧 action；seat 1 施放的 5 个样本均不撤销 seat 0 已完成 action。

这些结论是已观察 support 上的 `PLATFORM_REPLAY_CONFIRMED`。未出现的同目标移动、多 bomb 同帧、多 projectile 同时命中同一资源等仍不得推断。

## 3. Active PhaseOrder

```text
T00 PREVIOUS_RUNTIME_TERMINAL
T10 TIMED_EFFECT_EXPIRE
T20 STAR_SPAWN
T30 OBSERVE_AND_COMMAND_POLL
T40 SEAT_0_ACTION
T50 SEAT_1_ACTION
T60 STAR_COLLECTION
T70 PROJECTILE_RESOLUTION
T80 BOMB_RESOLUTION
T90 TERMINAL_RESOLUTION
T100 NEXT_FRAME
```

### T00 Previous runtime terminal

若上一 callback 已触发平台 runtime timeout，frame 不再执行物理动作。准确阈值边界保留 `RV-RUNTIME-GE-3000` 与 `RV-RUNTIME-GT-3000`；生产 RuntimeController 不依赖踩线判定，必须提前保留余量。

### T10 Timed effect expiry

处理 `expiresAtFrame <= platformFrame` 的计时效果，发出 `EFFECT_EXPIRED(reason=DEADLINE)`。技能因命中或消费而结束时在对应 action/projectile/bomb phase 发事件，不在 T10 重复发出。

### T20 Star spawn

到期 star 在双方观察和 action 前创建。重生时点为收集后 10 frame；位置/分布仍属于 StarSpawnModel/ChanceOutcome，概率未知。

### T30 Observe and command poll

根据 T10/T20 后的状态为双方生成 observation。空 queue 且可 poll 的 seat 提交 ActionProgram；双方同时可提交时使用 SIMULTANEOUS_DECISION，但彼此看不到对方 program。

新 command 记录 `eligibleAtFrame >= platformFrame + 1`，不能在本帧 T40/T50 执行。T30 后 queue 已非空，因此也不能重复 poll。这个一帧提交边界来自 Guide 的“commands execute on later frames”，必须进入 state/hash。

### T40/T50 Seat action

seat 0 完整执行后再执行 seat 1。这里只消费 T30 前已经存在且 `eligibleAtFrame <= platformFrame` 的 queue head。effect、position、terrain、projectile/bomb creation 对后手立即可见于物理状态，但后手脚本不会在同一 frame 重新观察先手结果。

skill 的 cast/applied/failed 与 action 同 phase。FIRE 创建的 projectile 参加本帧 T70。THROW_BOMB 创建的 bomb 不会提前于 `explodeAtFrame` 进入 T80。

### T60 Star collection

双方 action 后按最终位置收集当前 star；收集发生在 projectile 与 bomb damage 前。因此“先拿星后同帧死亡”的星数必须进入 terminal tiebreak。

若多个存活 tank 同时占据 star，使用开发变体：

```text
RV-STAR-CONTEST-SEAT_PRIORITY
RV-STAR-CONTEST-NO_COLLECTION
RV-STAR-CONTEST-COLLISION_RESULT
```

正常 no-cooccupancy 规则下候选数至多 1；只有 contested fixture 依赖该变体。

### T70 Projectile resolution

每颗 active projectile 每 frame 最多执行 substep 0、1：

1. 计算下一 cell；
2. 发 `PROJECTILE_MOVED(substep)`；
3. 立即处理越界、terrain、shield 或 tank collision；
4. 失效则发 cause event，不再执行下一个 substep。

创建帧也执行 T70。projectile 与 projectile 互相穿过是当前 USER_CONFIRMED 规则；在平台 fixture 固化前不能单独支持严格 Proof。

多 projectile 对共享资源的内部顺序使用：

```text
RV-PROJECTILE-SEQUENTIAL-PLATFORM-ORDER
RV-PROJECTILE-SUBSTEP-BATCH
```

raw event 多数显示每颗 projectile 的 `0,1` 连续处理，但实体排序不是简单 creation order。DD4 校准前，只要顺序会改变 dirt、shield 或 terminal，Proof 返回 UNKNOWN_RULE。

### T80 Bomb resolution

处理所有 `explodeAtFrame <= platformFrame` 的 bomb。blast 基于 T70 后地形与 T40/T50 后 tank 位置：

- wall 阻断；
- dirt 被毁并阻断该 ray；
- shield 消耗；
- owner 及任意 tank 均可受伤。

同帧多 bomb 使用两个开发变体：

```text
RV-BOMB-SEQUENTIAL-PLACEMENT-ORDER
RV-BOMB-BATCH-START-TERRAIN
```

若结果受先后影响，在 DD4 前不得产生严格 terminal/proof。

### T90 Terminal resolution

在 projectile 与 bomb 全部处理后统一解析 crash、frame limit 和 tiebreak。不得在第一个 tank crash event 后提前返回，否则会漏掉同 phase 双毁。完整合同见 [terminal-proof-algebra.md](terminal-proof-algebra.md)。

### T100 Next frame

递增 platformFrame，清空 frame-local flags，保留 queue、实体、absolute deadline 和版本。下一轮回到 T00。

## 4. 移动冲突 RuleVariant

已确认 action seat 顺序不等于已确认碰撞语义。只在双方移动 intent 发生冲突时展开：

| Variant | 同目标 | 交换位置 | 占据对方起点 |
|---|---|---|---|
| `RV-MOVE-SEQUENTIAL-BLOCK` | 后手 blocked | 后手 blocked | 按已更新位置判断 |
| `RV-MOVE-INTENT-BLOCK` | 双方 blocked | 双方 blocked | 依 intent batch 判断 |
| `RV-MOVE-COLLISION-CRASH` | 双方 crash | 双方 crash | 产生 collision damage |

ReferenceKernel 对相关 fixture 运行全部变体；FastKernel 在规则未确认前不得优化依赖 contested move 的严格路线。普通无冲突移动仍走唯一 fast path。

## 5. Canonical Event ABI

DD1 冻结语义字段，不冻结位宽：

```text
eventType
phaseOrdinal
sequenceInFrame
platformFrame
actorSeat          // 发起者；没有则 NONE
subjectHandle      // 被改变实体
sourceHandle       // projectile/bomb/skill source
positionBefore
positionAfter
directionBefore
directionAfter
reasonCode
auxValue0
auxValue1
```

### 5.1 EventType

```text
EFFECT_EXPIRED
STAR_CREATED
COMMAND_EXECUTED
COMMAND_NO_EFFECT
COMMAND_FAILED
TANK_TURNED
TANK_MOVED
SKILL_CAST
SKILL_APPLIED
SKILL_EXPIRED
PROJECTILE_CREATED
PROJECTILE_MOVED
PROJECTILE_DESTROYED
BOMB_PLACED
BOMB_EXPLODED
TERRAIN_DESTROYED
SHIELD_HIT
TANK_CRASHED
STAR_COLLECTED
TERMINAL_RESOLVED
AUX_SPEECH
```

平台 raw 中 `tank:crashed.by` 常是伤害来源 seat，而 `index/objectId` 才是 victim。Canonical Adapter 必须写 `actorSeat=by`、`subjectHandle=victim`，禁止把 by 当作被毁方。

### 5.2 顺序和状态修改

- `sequenceInFrame` 严格递增；
- 每个 event 在发出前或后修改状态的约定由 event type 固定，不允许调用者选择；
- physics trace hash 不包含 AUX_SPEECH、字符串和 replay 展示字段；
- Reference 与 Fast 必须产生相同 canonical physics event sequence；
- 平台 Adapter 可保留 raw event 作为 evidence，但不能直接把 raw 对象传入 FastKernel。

## 6. Observation 边界

T30 observation 只读取当时可见事实：

- `enemy.tank` 可因 grass/cloak 为 null；
- `enemy.bullet` 是单数接口，但内部 projectile pool 不受限；
- `game.bombs` 只含可见非草 bomb；
- skill/effect/status 是公开字段；
- 不可见实体直到确认物理失效前仍保留在 InformationState。

多颗可见 enemy projectile 中平台选择哪一颗返回尚未确认，使用集合值 `OBSERVED_ONE_OF_VISIBLE_PROJECTILES`：ObservationPartition 对每个可能返回值建立分支，不把它当 chance，也不丢掉其余 projectile。

## 7. Terminal boundary variants

244 corpus 的非 crash 终局都具有 128 条 replay record（含 setup record）。active 候选为在 `platformFrame=128` 的 action 前完成 frame-limit 结算：

```text
RV-LIMIT-BEFORE-ACTION-128   // active candidate
RV-LIMIT-AFTER-ACTION-128    // calibration only
```

任何依赖第 128 帧还能执行 command 或 projectile 的严格结论，在定向平台 fixture 前为 UNKNOWN_RULE。搜索不得把 128 当作“分配搜索时间”的概念；它只属于 TerminalPolicy。

## 8. 最坏成本

每帧热路径上界：

```text
O(expiringEffects)
+ O(2 seats * at most 2 commands)
+ O(activeProjectiles * 2 substeps)
+ O(dueBombs * blastCells)
+ O(tanks + starCandidates)
```

- expiring effect 使用 deadline bucket/固定 seat slots，不全表扫描；
- blastCells 最大值由规则生成；
- EventBuffer 容量由上述公式生成，不足返回 `INCOMPLETE_EVENT_CAPACITY`；
- transition 内禁止对象、字符串、Map、Date.now 和随机数；
- chanceCode 必须由调用者传入。

## 9. 不变量

1. action choice 与 action execution 分离。
2. T30 新提交 command 最早在下一 platformFrame 执行。
3. seat 0/1 是平台 initiative，不等于我方/敌方。
4. star collection 先于本帧 projectile/bomb damage。
5. projectile 先于 bomb。
6. terminal 只在完整 damage batch 后解析。
7. 未确认复合顺序只影响含该 interaction 的 branch，不污染普通 fast path。
8. RuleVariant 只存在于 Reference/fixture；生产 FastKernel 固定 phaseOrderId。
9. event overflow、unknown rule 或 observation ambiguity 不能静默丢事件。

## 10. 必须 fixture

- `TL-SEAT-ORDER-001` 及镜像；
- `TL-SUBMIT-NEXT-FRAME-001`；
- `TL-FREEZE-ORDER-001` 及镜像；
- `TL-BULLET-CREATE-MOVE-001`；
- `TL-BULLET-SUBSTEP-HIT-0/1`；
- `TL-STAR-BEFORE-BULLET-001`；
- `TL-BOMB-MOVE-OUT-001`；
- `TL-BOMB-MOVE-IN-001`；
- `TL-BULLET-BEFORE-BOMB-001`；
- `TL-EFFECT-EXPIRE-001`；
- `TL-OVERLOAD-CONSUME-001`；
- `TL-MOVE-CONTEST-*`；
- `TL-MULTI-PROJECTILE-SHARED-*`；
- `TL-MULTI-BOMB-*`；
- `TL-LIMIT-128-*`。

## 11. DD1 结论

主 FrameTimeline 已从外部模拟器候选改为真实平台 replay 顺序。`OI-R0-002`、`OI-R0-003`、`OI-R0-005`、bomb/star 的主时序已解决；移动冲突、多 projectile/多 bomb 共享资源、frame-limit off-by-one 和 observation 单 bullet 选择均已收敛成有限、具生产阻塞行为的 RuleVariant。
