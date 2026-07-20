# DD1 Action、Command 与 Scheduler 合同

状态：DD1 规范合同 + DD3 physical revision 1。定义动作提交、命令队列、执行 slot 和搜索节点；Command/Action 整数 ABI 见 [action-result-abi.md](action-result-abi.md)，物理 Arena 使用 TypedArray SoA；生产容量由DD8 manifest合同约束并待v2 benchmark选值。

关联：`DEC-0002`、`DEC-0003`、`DEC-0011`、`DEC-0025`、`DEC-0030`、`DEC-0032`；`OI-R0-001`、`OI-R0-002`、`OI-R0-004`、`OI-R1-003`、`OI-R1-008`、`OI-R1-009`、`OI-ARCH-004`。

## 1. 目标与非目标

本合同保证：

1. 区分脚本调用、已排队 command、实际执行 action 和产生的 event；
2. 普通队列、boost 免费 turn、freeze/stun/poison 都能由同一个 scheduler 表达；
3. EnemyAction、HiddenWorld 和 ChanceOutcome 不因队列而混合；
4. 非法、无效果、延迟、硬失败和高风险不会共用一个状态码；
5. 每帧 scheduler 工作量有固定上界，不扫描整条历史队列。

本合同不决定：

- InformationState 中敌方队列 belief 的压缩布局；
- CommandCode 的具体 bit 数；
- stun/teleport 的概率；
- 同格/交换移动的最终平台规则；
- 搜索深度和队列 prefix 容量。

## 2. 四层动作模型

```text
ActionProgram        onIdle 一次提交的调用序列
  -> CommandQueue    按顺序保存的 primitive commands
  -> ExecutedAction  某帧 action slot 实际执行的一个或两个 command
  -> OrderedEvents   FrameTimeline 产生的状态变化
```

禁止把 `me.fire()` 的调用当作 bullet 已创建；也禁止把 replay 中 `bullet:created` 反推成当前帧必然调用了 `fire()`，因为 command 可能在更早的 onIdle 排队。

### 2.1 ActionProgram

ActionProgram 是一次 callback 的纯提交结果：

```text
actionRef
actionKeyLo/Hi
commandCount
commands[0..commandCount)
auxiliaryCount       // speak/print，不进入物理队列
submissionFrame
```

每个进入物理队列的 command 同时获得 `eligibleAtFrame >= submissionFrame + 1`。当前 active 规则为下一 platformFrame 即可执行；禁止 T30 刚提交、T40/T50 同帧立即消费。

`me.go(n)` 在 Adapter 边界展开成 n 个 `GO` command；搜索永远不把 `GO_N` 当作原子物理动作。v2 正式 emitter 默认只生成必要的短 program；平台允许的更长队列由测试 Adapter 处理。

### 2.2 Primitive Command

规范 CommandFamily：

| Family | 参数 | 是否占普通 action slot |
|---|---|---|
| `GO` | 无 | 是 |
| `TURN_LEFT` / `TURN_RIGHT` | 无 | 是；boost 本帧首个 turn 可免费 |
| `FIRE` | 无 | 是 |
| `THROW_BOMB` | 无 | 是 |
| `CAST_SHIELD/FREEZE/STUN/OVERLOAD/CLOAK/POISON/BOOST` | 无 | 是 |
| `CAST_TELEPORT` | targetCell | 是 |
| `HOLD` | 无 | 否；只存在于 commandCount=0 的 ActionRecord，不编码为平台 CommandCode |
| `SPEAK` / `PRINT` | 离线字符串/参数 | 否；不进入物理 CommandCode |

我方构建产物只暴露自身 skill 的 CAST family。敌方八种 skill family 保留在规则表中，但 action generator 只启用公开的 `enemy.skill.type`。

### 2.3 ExecutedFrameAction

每个 seat 每帧最多形成：

```text
freeTurn = NONE | LEFT | RIGHT
mainCommand = NONE | one primitive command
```

普通状态下 `freeTurn=NONE`，最多执行一个 mainCommand。boost 状态下，本帧从队首取到的第一个 turn 可作为 freeTurn，再取至多一个 mainCommand。第二个 turn 若被取到，属于 mainCommand 并消耗 slot。

如果免费 turn 后队列为空，本帧结束该 seat 的执行；scheduler 不在同一帧再次调用 onIdle。该规则记为 `RV-SCHED-BOOST-NO-REPOLL`，当前由 Guide 语义和外部模拟器共同支持，仍保留定向平台 fixture。

## 3. 队列状态

每个 seat 的语义状态：

```text
queuePrefix
queueResidualKind       // NONE | UNKNOWN_SUFFIX | OVERFLOW
headGeneration
submittedAtFrame
headEligibleAtFrame
pollEligibility
canActThisFrame
actionSpeedClass
boostFreeTurnFrame
```

- 我方 root 收到 onIdle 时，平台事实保证我方 queue 为空；提交后 prefix 精确已知。
- 敌方 queue 不可见，属于 InformationState；不能默认为空，也不能从“本帧没动作”直接推断为空。
- queue prefix/suffix support overflow 不允许截断成空；返回 `SLOT_INCOMPLETE_RULE + INCOMPLETE_ACTION_SUPPORT`，Proof 失效。
- freeze/poison 导致本帧不能行动时不得 dequeue。
- command 被执行、失败或无效果后才从队首移除。
- `headEligibleAtFrame > platformFrame` 时视为队列非空但当前不可执行；不得再次 poll，也不得 dequeue。

## 4. 三组互不替代的状态

### 4.1 SubmissionLegality

```text
SUBMISSION_LEGAL
SUBMISSION_ILLEGAL_API
SUBMISSION_ILLEGAL_ARGUMENT
SUBMISSION_UNSUPPORTED_RULE
```

SubmissionLegality 只检查调用是否属于可用 API 与参数域。未来可能因 cooldown、实体或位置变化而失败的 command 仍可合法入队。

### 4.2 ExecutionStatus

```text
EXECUTED_EFFECT
EXECUTED_NO_EFFECT
EXECUTED_TRANSFORMED
FAILED_COOLDOWN_CONSUMED
FAILED_COOLDOWN_PRESERVED
INCOMPLETE_RULE
```

ExecutionStatus 描述 dequeue 时发生了什么，不表达最终输赢。

### 4.2.1 SeatSlotStatus

```text
SLOT_NO_ACTION
SLOT_DEFERRED_CONTROL
SLOT_DEFERRED_NOT_ELIGIBLE
SLOT_PREPARED
SLOT_EXECUTED
SLOT_NEEDS_CHANCE
SLOT_INCOMPLETE_RULE
```

SeatSlotStatus 描述本帧 seat 调度结果；它不冒充某个 command 已执行。`SLOT_NEEDS_CHANCE` 必须在 dequeue/状态修改前返回。

### 4.3 HardGateStatus

```text
HARD_ALLOW
HARD_REJECT_PROVEN
HARD_REJECT_POLICY
HARD_INCOMPLETE
```

- `HARD_REJECT_PROVEN`：冻结规则下存在完整 InevitableLossCertificate；可进入严格 cache。
- `HARD_REJECT_POLICY`：用户明确的保守政策，例如同星终局且 runtimeOrder 未知时按我方更慢处理；不可冒充 Proof。
- `HARD_INCOMPLETE`：规则、容量或搜索不完整；不可当作安全。
- 高风险但并非无条件失败必须保持 `HARD_ALLOW`，交给 Risk 层。

这四层分别解决“能否提交、执行结果、是否硬拒绝、软风险多少”，禁止再用单一 `HARD_INVALID` 表达全部含义。

## 5. Command 执行语义

| Command | 已确认语义 | 仍需 RuleVariant 的部分 |
|---|---|---|
| GO | 普通前进一格；boost 最多两格并遇 blocker 提前停 | 双方同目标、交换位置、碰撞伤害 |
| TURN | 左/右转；普通 turn 消耗 slot | stun 的正常/反向 outcome |
| FIRE | command 一定被消耗；有己方活跃 bullet 或 fireLocked 时不创建 bullet | 多弹可见选择、同 phase 多实体结算 |
| THROW_BOMB | 成功时当前格创建 bomb，消耗 slot | cooldown/已有 bomb 时是 NO_EFFECT 还是失败事件 |
| CAST_* | 对应 skill 公开且 ready 时施放，产生 cast/applied 或 failed | cooldown 边界、部分 failed cast 是否重置 cooldown |
| TELEPORT | 合法 target 即时改变位置；非法 target 失败且消耗 cooldown | 星旁落点概率、精确 lock/reveal deadline |
| HOLD | 不提交 command、不改变物理状态 | 无 |

执行失败也不能自动标为 HARD：例如一次被 fire lock 消耗的 FIRE 可能只是失去机会；只有后继状态满足硬失败代数才拒绝。

## 6. 控制效果与 scheduler

### 6.1 Freeze

- 已排队 command 不丢弃；
- frozen seat 在受控 action slot 不 dequeue；
- seat 0 施放 freeze 后，真实 replay 的 14 个样本中 seat 1 当帧均未行动；
- seat 1 施放 freeze 的 5 个样本中 seat 0 已完成当帧行动；
- 因此 active timeline 按 seat 顺序即时应用 freeze，不追溯撤销已完成 action。

队列为空时 frozen seat 是否仍被平台 poll，使用两个开发变体：

```text
RV-SCHED-FROZEN-POLL-HOLD
RV-SCHED-FROZEN-NO-POLL
```

两者产生相同当前帧物理结果，但影响后续 command belief。DD4 未校准前，相关严格 Proof 必须覆盖两者。

### 6.2 Stun

stun 不改变 EnemyAction；它在 command 确定后产生 ChanceOutcome：

```text
TURN_LEFT  -> TURN_LEFT | TURN_RIGHT
TURN_RIGHT -> TURN_RIGHT | TURN_LEFT
GO         -> GO_FORWARD | GO_REVERSE
```

其他 command 的 support 若未确认，返回 `INCOMPLETE_RULE`。概率未知不影响 support Proof：严格 Proof 对全部 support 做 AND。

### 6.3 Poison

Scheduler 读取 `canActThisFrame`；false 时 queue 保留。根观察优先信任平台字段，深层 hypothetical cadence 按施加后的相对 `ACT-HOLD-ACT-HOLD` 计算，禁止写成绝对平台帧奇偶。只有队列变空后的同帧repoll/ready边界仍由 RuleVariant 表达。poison 不作为随机动作，也不丢弃 command。

### 6.4 Boost

boost 改变 slot capability，不修改 CommandCode：

1. 最多一个免费 turn；
2. 随后最多一个 mainCommand；
3. GO 在自己的执行语义中最多跨两格；
4. boost 在 command 真正执行前到期时，不能保留旧 compound capability。

## 7. Search NodeKind

```text
OUR_DECISION
ENEMY_DECISION
SIMULTANEOUS_DECISION
AUTOMATIC_FRAME
CHANCE_RESOLUTION
OBSERVATION_SPLIT
TERMINAL
```

### 7.1 生成规则

1. Terminal precheck 成立：`TERMINAL`。
2. 需要展开隐藏 observation：`OBSERVATION_SPLIT`。
3. 一个 seat 可 poll 且 queue 为空：对应 OUR/ENEMY decision。
4. 双方在同一 public state 可独立提交且不能观察对方 program：`SIMULTANEOUS_DECISION`。
5. command 已定但 stun/teleport 等 outcome 未定：`CHANCE_RESOLUTION`。
6. 没有战略选择，只推进 phase/entity：`AUTOMATIC_FRAME`。

`SIMULTANEOUS_DECISION` 只表示 command 选择同时、不互相可见；执行仍按 seat 0、seat 1 的 FrameTimeline。不得把 simultaneous matrix 序列化成“后手看见先手动作”。

### 7.2 EnemyAction 边界

- 敌方选择 queue program 或当前未知 queue head：EnemyAction；
- 敌方隐藏位置、隐藏 projectile、隐藏 queue 事实：HiddenWorld；
- stun 反向、teleport 随机落点：ChanceOutcome；
- 平台 phase 未确认：RuleVariant，只在开发 Reference 展开。

## 8. Scheduler 算法

每个 seat action phase 只查看队首至多两项，并分成无副作用 prepare 与事务式 execute：

```text
prepareSeatSlot(state, seat, frame):
  if crashed: return SLOT_NO_ACTION
  if !canActThisFrame: return SLOT_DEFERRED_CONTROL
  if queue empty: return SLOT_NO_ACTION
  head = peek(0)
  if head.eligibleAtFrame > frame: return SLOT_DEFERRED_NOT_ELIGIBLE
  if boosted && head is TURN && freeTurnUnused:
      prepared = {freeTurn: head, main: eligible peek(1) or NONE}
  else:
      prepared = {freeTurn: NONE, main: head}
  if prepared needs unresolved outcome: return SLOT_NEEDS_CHANCE + support
  return PREPARED_SLOT

executePreparedSeatSlot(state, prepared, chanceCode):
  mark = branchMark()
  validate prepared queue generations/eligible frames
  dequeue and execute freeTurn/main in order
  on error/incomplete: undo(mark); return SLOT_INCOMPLETE_RULE
  return SLOT_EXECUTED + per-command ExecutionStatus
```

chance 未提供时不允许函数内部调用随机数；prepare 返回 `SLOT_NEEDS_CHANCE` 及 support，交给 CHANCE_RESOLUTION 节点。prepare 不修改 queue、entity、event 或 hash。

## 9. 性能合同

- 每 seat 每帧最多检查两个 command；复杂度 O(1)。
- 不 shift JavaScript Array；queue 使用预分配 TypedArray 的 ring/prefix index；具体容量/stride 由构建 manifest 生成。
- scheduler 不创建对象、不访问字符串、不读取 wall clock。
- command family、skill id、status 和结果使用整数表。
- queue residual 不展开时返回显式 incomplete，不能循环到耗尽。
- ActionProgram sequence 在 action generation 时写入 CommandArena；深层搜索只消费 ActionRef 和预建 CommandCode，不创建/展开对象。

## 10. 不变量

1. 未执行 command 不产生物理 event。
2. 任一 SLOT_DEFERRED/SLOT_NEEDS_CHANCE 不 dequeue。
3. FIRE 无弹不代表 FIRE 未执行。
4. chance 不能改变原始 EnemyAction 量词。
5. boost capability 按执行帧判断，不按提交帧判断。
6. seat 1 action 不得改变已经完成的 seat 0 action。
7. 当前 frame 新提交的 command 不得在同一 frame 执行。
8. HARD 只在 legality/execution 之后、soft score 之前运行。
9. scheduler 的任何 unknown 都必须出现在 RuleAssumptionMask 或 IncompleteReason。

## 11. 必须 fixture

- `ACT-QUEUE-001`：`turn(); fire()` 分两帧；
- `ACT-SUBMIT-DELAY-001`：T30 提交后最早下一 platformFrame 执行；
- `ACT-GO2-001`：普通 `go(2)` 两个 command；
- `ACT-BOOST-001`：免费 turn + GO；
- `ACT-BOOST-002`：免费 turn + FIRE；
- `ACT-BOOST-003`：免费 turn 后 boost 到期不可复用 compound；
- `ACT-FIRE-LOCK-001`：FIRE consumed/no bullet；
- `ACT-FREEZE-01` / mirror：seat 0 当帧抑制 seat 1，seat 1 不追溯 seat 0；
- `ACT-STUN-SUPPORT-001`：turn/go 全 support；
- `ACT-POISON-HOLD-001`：不可行动帧不 dequeue；
- `ACT-CHANCE-PREPARE-001`：stun/teleport 缺 chance 时零状态修改；
- `ACT-SIMULTANEOUS-001`：双方 program 不互相可见，执行 seat-ordered；
- `ACT-QUEUE-OVERFLOW-001`：返回 `SLOT_INCOMPLETE_RULE + INCOMPLETE_ACTION_SUPPORT`。

## 12. DD1 结论

`OI-R0-001`、`OI-R0-002` 和 `OI-ARCH-004` 的语义缺口已由本合同关闭。移动碰撞和 frozen 空队列 poll 已收敛为有限 RuleVariant；它们在 DD4 校准前阻止相关严格 Proof，但不影响 DD2 对这些分支的无损表达。
