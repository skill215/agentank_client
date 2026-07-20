# DD2 Action、Event、Result、Policy 与 PRNG 整数 ABI

状态：DD2 数值语义 + DD3 physical revision 1；热池统一 TypedArray SoA、整数 handle 和 generated BranchMark；生产容量遵守DD8 manifest合同，具体值待v2 benchmark。

关联：`DEC-0010`、`DEC-0024`、`DEC-0025`、`DEC-0029`、`DEC-0030`、`DEC-0032`、`DEC-0033`、`DEC-0038`；`OI-ARCH-006`、`OI-ARCH-010`、`OI-ARCH-011`。

## 1. ABI 原则

- 热路径参数只传整数、offset 和预分配数组引用；不返回对象、tuple 或新数组。
- 语义 key 与 arena address 分离：地址可重用，key 可进入 hash/cache/replay。
- 所有定点值的 scale 和 unknown sentinel 唯一。
- JavaScript 位运算结果统一 `>>>0`；普通定点乘加不能误进 32 位位运算。
- ABI 变化必须递增对应 version 并清空 cache/fixture build。

```text
OBSERVATION_ABI_VERSION
ENTITY_ABI_VERSION
STATE_ABI_VERSION
COMMAND_ABI_VERSION
ACTION_ABI_VERSION
EVENT_ABI_VERSION
RESULT_ABI_VERSION
POLICY_ABI_VERSION
PRNG_ABI_VERSION
```

Observation/Entity/State 版本分别由三份 DD2 状态合同拥有；本文件只要求它们进入跨模块 cache/fixture/manifest 失效集合。DD3 临时物理布局若变化也必须递增对应 candidate ABI version，不能沿用旧缓存。

## 2. 基础标量

| 语义 | 候选存储 | 范围/哨兵 |
|---|---|---|
| `CellT` | Uint16；宽地图 ABI 候选为 Uint32 | INVALID_CELL=全 1；`maxCellId < INVALID_CELL` |
| `FrameT` | Uint16；必要时 Uint32 | INVALID_FRAME=全 1；所有 deadline 小于 sentinel |
| `CountT` | Uint16；必要时 Uint32 | 存储的最大 count 小于全 1 invalid；不得饱和 |
| `OffsetT/RefT` | Uint32 | `0xffffffff` invalid |
| `ArenaHandleT` | Uint32 | low16 slot + high16 generation；全 1 invalid |
| `EntityHandle` | Uint32 | type/slot/generation，见实体合同 |
| `ValueT` | Int16 | -10000..10000；-32768 unknown |
| `ProbabilityT` | Uint16 | 0..10000；65535 unknown |
| `RiskT` | Uint8 | 0..100；255 unknown |
| `EnumT` | Uint8 | 0..254；255 invalid |
| `HashT` | Uint32×2 | Lo/Hi，严格命中需结构核验 |
| `MaskT` | Uint32 Lo/Hi | 最多 64 flags；超出时构建失败或升级 ABI |

244 局语料最大地图为 22×20，但这只是 observed lower bound。`CellT/FrameT` 由 MemoryCapacityManifest 根据平台/构建上限选择，不能因当前 corpus 小而写死坐标位数。

## 3. CommandCode

`CommandCode` 是一个 primitive command 的稳定 uint32 语义编码：

```text
bits  0..5   family       // 64 families
bits  6..21  payload      // 16 bits
bits 22..27  variant      // 6 bits
bits 28..30  flags        // 3 bits
bit  31      reserved=0
0xffffffff   INVALID_COMMAND
```

规范化规则：

- 无参数 command 的 payload/variant/flags 必须为 0；
- teleport payload=`cellId+1`，0 表示无 target，因此 COMMAND_ABI_V1 最大 cellId=65534；
- TURN_LEFT/RIGHT 使用独立 family，不把字符串写入 variant；
- stun 反向结果、teleport 随机落点属于 ChanceCode/ExecutionStatus，不改写原 CommandCode；
- 未使用位必须为 0，避免同一命令多种编码；
- family 超过 63 或 target 超范围时构建失败，不降级截断。若未来地图要求 Uint32 CellT，必须同时设计 `COMMAND_ABI_V2_INDIRECT_TARGET`，不能只扩大 CellT 后继续使用 V1 payload。

COMMAND_ABI_V1 family：

```text
0  RESERVED
1  GO
2  TURN_LEFT
3  TURN_RIGHT
4  FIRE
5  THROW_BOMB
6  CAST_SHIELD
7  CAST_FREEZE
8  CAST_STUN
9  CAST_OVERLOAD
10 CAST_CLOAK
11 CAST_POISON
12 CAST_BOOST
13 CAST_TELEPORT
14..63 RESERVED_APPEND_ONLY
```

搜索 HOLD 是 `commandCount=0`、`commandStart/firstCommandCode=INVALID` 的 ActionRecord，不生成可被 emitter 解码的平台 CommandCode。

## 4. ActionProgram 与 ActionRef

搜索策略选择的是一次提交的 ActionProgram，不一定只是一个 command。32 位无法无损内嵌任意短队列和 teleport payload，因此分离：

```text
ActionRef              // arena-local Uint32 address/slot
ActionKeyLo/Hi         // command sequence 的稳定 canonical signature

ActionRecord:
  commandStart
  commandCount
  firstCommandCode
  programFlags
  actionKeyLo/Hi
```

- commandCount=1 是 scalar fast path；
- command sequence 存在 CommandArena，ActionRecord 不复制数组；
- `firstCommandCode/programFlags` 都是从 canonical sequence 派生的加速字段，不能改变动作语义；读取时可由 manifest/debug guard 核验；
- ActionKey 由 `COMMAND_ABI_VERSION + ACTION_ABI_VERSION + commandCount + canonical CommandCode sequence` 通过双 32 位 hash 生成；
- TT/cache 保存 ActionKey，不保存易失 ActionRef；命中后在当前 action set 查找相同 key并核验 command sequence；
- PolicyArena 保存当前节点有效 ActionRef，同时保存 key 用于校验；
- action generator 以稳定 `(commandCount, lexicographic CommandCode sequence)` 顺序生成，使 source/minified 一致。

旧草案中的单一 `ActionCode` 统一迁移为 `CommandCode | ActionRef | ActionKey` 三个明确概念。

## 5. ExecutedFrameAction

不再尝试把 boost compound execution 塞进一个 CommandCode：

```text
freeTurnCommandCode
mainCommandCode
freeTurnExecutionStatus
mainExecutionStatus
actorSeat
frame
```

普通 action 的 freeTurn=INVALID_COMMAND。ExecutedFrameAction 是 frame-local scratch/event 输入，不进入提交 policy key。

## 6. ChanceCode

```text
bits  0..7   chanceKind
bits  8..31  outcomePayload
0xffffffff   INVALID_CHANCE
```

概率不编码在 ChanceCode 中，而存于同一 `(state,ourAction,enemyAction)` 的 ProbabilityT 数组。相同 outcome 的 ChanceCode 必须稳定；不得复用 EnemyAction/HiddenWorld/RuleVariant 编码空间。
V1 direct `outcomePayload` 最大为 `0x00ffffff`；更大 cell、组合 target 或结构化 outcome 必须升级为 versioned indirect ChanceOutcomeArena 引用，manifest 位宽不足时构建失败，禁止截断 payload。

## 7. 核心枚举 ABI

### 7.1 Terminal/Hard/Proof

```text
TerminalOutcome:
  0 NON_TERMINAL, 1 WIN, 2 LOSS, 3 DRAW

TerminalResolutionStatus:
  0 RESOLVED, 1 UNKNOWN_RULE, 2 INCOMPLETE_STATE

HardGateStatus:
  0 HARD_ALLOW
  1 HARD_REJECT_PROVEN
  2 HARD_REJECT_POLICY
  3 HARD_INCOMPLETE

ProofStatus:
  0 UNKNOWN
  1 FORCED_WIN_PROVEN
  2 FORCED_NONLOSS_PROVEN
  3 FORCED_LOSS_PROVEN
  4 ACTION_REFUTED
```

### 7.2 Bound/Result

```text
BoundKind:
  0 INCOMPLETE
  1 HEURISTIC_ONLY
  2 APPROXIMATE_WITH_GAP
  3 INTERVAL_COMPLETE
  4 LOWER_COMPLETE
  5 UPPER_COMPLETE
  6 EXACT_COMPLETE

ResultStatus:
  0 RESULT_COMPLETE
  1 RESULT_INCOMPLETE
  2 RESULT_ERROR
```

核心 enum 数值不得被技能模块重排。扩展只能追加；删除保留 tombstone。

### 7.3 Submission/Execution/Scheduler

```text
SubmissionLegality:
  0 SUBMISSION_LEGAL
  1 SUBMISSION_ILLEGAL_API
  2 SUBMISSION_ILLEGAL_ARGUMENT
  3 SUBMISSION_UNSUPPORTED_RULE

ExecutionStatus:
  0 EXECUTED_EFFECT
  1 EXECUTED_NO_EFFECT
  2 EXECUTED_TRANSFORMED
  3 FAILED_COOLDOWN_CONSUMED
  4 FAILED_COOLDOWN_PRESERVED
  5 INCOMPLETE_RULE

SeatSlotStatus:
  0 SLOT_NO_ACTION
  1 SLOT_DEFERRED_CONTROL
  2 SLOT_DEFERRED_NOT_ELIGIBLE
  3 SLOT_PREPARED
  4 SLOT_EXECUTED
  5 SLOT_NEEDS_CHANCE
  6 SLOT_INCOMPLETE_RULE
```

`SLOT_NEEDS_CHANCE` 在任何 dequeue/state write 前返回；ExecutionStatus 只为实际消费的 command 生成。

### 7.4 IncompleteReason

```text
0  INCOMPLETE_NONE
1  INCOMPLETE_UNKNOWN_RULE
2  INCOMPLETE_INPUT_SHAPE
3  INCOMPLETE_ROOT_ENTITY_CAPACITY
4  INCOMPLETE_EVENT_CAPACITY
5  INCOMPLETE_DELTA_CAPACITY
6  INCOMPLETE_WORLD_CAPACITY
7  INCOMPLETE_RESIDUAL_CAPACITY
8  INCOMPLETE_ASSOCIATION_CAPACITY
9  INCOMPLETE_PARTITION_CAPACITY
10 INCOMPLETE_ACTION_SUPPORT
11 INCOMPLETE_CHANCE_SUPPORT
12 INCOMPLETE_POLICY_CAPACITY
13 INCOMPLETE_COVERAGE_CAPACITY
14 INCOMPLETE_TIME_BUDGET
15 INCOMPLETE_CACHE_UNVERIFIED
16 INCOMPLETE_INTERNAL_CONSISTENCY
```

新增原因只能追加；不得用 `UNKNOWN_RULE` 代替容量、时间或一致性失败。

## 8. Canonical EventBuffer ABI

EVENT_ABI_V1 eventType：

```text
0  EFFECT_EXPIRED
1  STAR_CREATED
2  COMMAND_EXECUTED
3  COMMAND_NO_EFFECT
4  COMMAND_FAILED
5  TANK_TURNED
6  TANK_MOVED
7  SKILL_CAST
8  SKILL_APPLIED
9  SKILL_EXPIRED
10 PROJECTILE_CREATED
11 PROJECTILE_MOVED
12 PROJECTILE_DESTROYED
13 BOMB_PLACED
14 BOMB_EXPLODED
15 TERRAIN_DESTROYED
16 SHIELD_HIT
17 TANK_CRASHED
18 STAR_COLLECTED
19 TERMINAL_RESOLVED
20 AUX_SPEECH_TEST_ONLY
```

类型只能追加，删除保留 tombstone。AUX_SPEECH_TEST_ONLY 不进入 production physics EventBuffer。

Event 采用 SoA；每个字段数组长度=`MAX_EVENTS_PER_TRANSITION`：

| 字段 | 类型 | 说明 |
|---|---|---|
| `eventType` | Uint8 | DD1 EventType id |
| `phaseOrdinal` | Uint8 | T00..T100 生成 id |
| `sequenceInFrame` | Uint16 | 严格递增 |
| `platformFrame` | FrameT | 绝对 frame |
| `actorSeat` | Uint8 | 0/1/255 |
| `subjectHandle` | Uint32 | generation-safe |
| `sourceHandle` | Uint32 | generation-safe |
| `positionBefore/After` | CellT | INVALID_CELL 允许 |
| `directionBefore/After` | Uint8 | INVALID_ENUM 允许 |
| `reasonCode` | Uint8 | event-specific table |
| `auxValue0/1` | Int32 | 仅按 event schema 解码 |

EventBuffer header：

```text
eventCount
eventCapacity
eventOverflow
traceHashLo/Hi
```

overflow 时当前 transition 返回 `INCOMPLETE_EVENT_CAPACITY` 并 undo；禁止只保留前 N 个事件。AUX_SPEECH 不进入 physics EventBuffer，可由离线 adapter 单独保存。

## 9. ResultArena

每个 result slot 的唯一字段：

```text
resultStatus
hardGateStatus
proofStatus
boundKind
terminalResolutionStatus
terminalOutcome
incompleteReason
solverKind
resultFlags                  // recovery/singleton/mixed/assumed...

lowerValue
upperValue
worstValue
expectedValue
robustValue

bestActionRef
bestActionKeyLo/Hi
policyHandle
coverageHandle

completedDecisionDepth
completedFrameHorizon
actionCountCovered
worldCountCovered
enemyPolicyCountOrPrefixCovered
chanceCountCovered
assumptionMaskLo/Hi
```

字段语义：

- `lower/upper` 在二者有效时必须满足 lower≤upper；否则二者都为 VALUE_UNKNOWN，禁止让 sentinel 参与比较/算术；
- `worstValue` 是完整 support 上已计算的 scenario worst，缺完整覆盖时为 VALUE_UNKNOWN，不能冒充 lower；
- `expectedValue` 只有概率合同允许时有效；
- `robustValue` 只保存一次递归 risk backup 结果，避免根再次重复施加；
- deterministic 与 mixed 输出都必须通过 policyHandle；bestAction 只在 deterministic policy 或明确的排序 hint 中有效，mixed emitter 必须忽略它；
- incomplete/error 仍必须给出合法 interval 或 VALUE_UNKNOWN，并携带原因。

这组字段取代旧 `resultWorst/resultBestAction` 与另一份 `completedDepth/policy` 的两个不兼容 Result 版本。

## 10. CoverageArena

CoverageCertificate 使用 ArenaHandleT 指向固定记录：

```text
certificateKind
rootInformationSignatureLo/Hi
rulesetVersion/phaseOrderId/terminalPolicyId
supportVersion fields
horizonKind/horizonEndFrame
capacityComplete/searchComplete/strategyConsistent
assumptionMaskLo/Hi
traceRootLo/Hi
```

完整 source refs/trace 不进入生产热路径。CoverageHandle 失效或 generation 不匹配时 Proof 降为 UNKNOWN，不继续使用 cached status。

## 11. PolicyArena

```text
PolicyRecord:
  generation
  actionStart
  actionCount
  probabilityScale        // 10000
  cumulativeEnd           // 必须 10000
  policyFlags             // deterministic/mixed/approximate
  policyKeyLo/Hi

PolicyEntry:
  actionRef
  actionKeyLo/Hi
  probability             // Uint16
  cumulativeProbability   // Uint16
```

PolicyHandle/CoverageHandle 的 generation 规则与 arena slot reuse 同步；任一 pool 需要超过 65535 slot 时当前 ABI 构建失败，不能只存裸 offset 跨生命周期使用。
generation 即将 wrap 时该 slot 在当前 search epoch 永久 retired；因此导致 pool 不足时分别返回 `INCOMPLETE_POLICY_CAPACITY` 或 `INCOMPLETE_COVERAGE_CAPACITY`，禁止 wrap 后让旧 handle 重新有效。

不变量：

- 每个概率 0..10000，总和严格等于 10000；
- deterministic policy 也是 count=1/probability=10000；
- 浮点 solver 输出只允许离线实验；生产 solver 用整数/有界分数，最终按最大余数法量化；
- 舍入余数按 ActionKey 字典序稳定分配；
- 0 概率 entry 不写入正式 policy；Proof support 与 policy support 分开。

PolicyEntry 按 ActionKey 稳定排序。PolicyKey 由 `POLICY_ABI_VERSION + ordered(ActionKey,probability)` 生成双 32 位 hash；cache/回放命中仍核验 entry count、总概率和条目序列。

ActionRef 生命周期不变量：任何 live Result/Policy 引用的 ActionRecord 必须仍 pinned；rewind 顺序先释放 Result/Policy/Coverage，再释放它们引用的 ActionArena 区间。根 policy 的 actions 保留到 root 校验和 emitter 完成。违反 pin/usedCount 关系返回 `INCOMPLETE_INTERNAL_CONSISTENCY`，不得重新绑定“相同 slot 的新动作”。

## 12. PRNG ABI

PRNG 只用于最终 mixed policy 取样；ChanceOutcome 在搜索中枚举，规则推进禁止内部随机。

```text
algorithm = XORSHIFT32_V1
state = nonzero uint32

x ^= x << 13
x ^= x >>> 17
x ^= x << 5
state = x >>> 0
```

seed 由 match root fingerprint、our seat、build salt 混合；0 修复为固定非零常量。正式动作选择规则：

1. deterministic/forced policy 不推进 PRNG；
2. mixed policy 只推进一次；
3. 将 uint32 `r` 映射到 0..9999：

```text
hi = r >>> 16
lo = r & 0xffff
bucket = (hi * 10000 + ((lo * 10000) >>> 16)) >>> 16
```

该 multiply-high 映射不保存或运算任何小数值，也不使用`Math.imul`、BigInt或无界rejection loop。JavaScript内部虽以Number承载整数，但这里两个16位乘积及其和均小于2^31，逐步结果精确；离线测试再以BigInt作oracle。桶数量差最多一个uint32输入，即概率差最多1/2^32。按 cumulativeProbability 选择第一条 `bucket < cumulative`。

PRNG state 属于 Persistent RuntimeController/selection state，不进入 PhysicalHash、Proof 或对手模型。离线 replay signature 必须记录 selection 前后 state；正式 bundle 不需要输出日志。

## 13. 函数边界

```text
generateActions(searchStateKind, stateOffset, actionArenaOffset) -> actionCount
applyJointActionPrograms(worldOffset, ourActionRef, enemyActionRef, chanceCode, childOffset) -> transitionStatus
solveNode(searchStateKind, stateOffset, profileId, resultOffset) -> resultStatus
selectPolicyEntry(policyHandle, prngStateOffset) -> actionRef
validateRootAction(actionRef, actionKeyLo, actionKeyHi, rootGeneration) -> status
emitActionProgram(actionRef, me) -> status
```

结果通过 out-offset 写入。输入可传 TypedArray 引用/offset，但被调用者不得保留外部平台对象或可变 scratch 引用到生命周期之外。

## 14. Cache 与版本

- TT 保存 ActionKey/PolicyKey，不保存 ActionRef/PolicyHandle；命中后重新绑定当前 arena。
- Result cache key 包含 STATE/COMMAND/ACTION/RESULT/POLICY ABI versions、ruleset、profile 和风险版本。
- Event trace key 包含 EVENT_ABI_VERSION、phaseOrderId 和 entity generation。
- PRNG 不进入 Value/Proof cache；只影响最终 mixed selection。
- 任一 enum/bit layout/scale/sentinel 变化使 source/minified fixture、cache 和 build manifest 全部失效。

## 15. Owner、生命周期、hash 与撤销

| 数据 | Owner | 生命周期 | Hash/key | 撤销/提交 |
|---|---|---|---|---|
| CommandArena/ActionRecord | ActionGenerator | 当前 node/search | ActionKey | usedCount rewind |
| PreparedSeatSlot | Scheduler | 当前 transition | 不独立 hash | execute 前无副作用 |
| EventBuffer | FrameTimeline | 当前 transition/fixture | traceHash | BranchMark eventCount |
| ResultArena | SearchDriver | 当前 search/root output | state/profile/result ABI | usedCount rewind |
| PolicyArena | StageSolver/SearchDriver | 当前 search/root output | PolicyKey + ActionKey entries | generation/usedCount |
| CoverageArena | ProofKernel | 当前 search/cache certificate | support/rule/horizon signature | generation/usedCount |
| PRNG state | RuntimeController | 整局 | 不进 physics/info hash | mixed root selection shadow commit |

PRNG 只有选定 mixed policy 且 root action 校验成功后才提交新 state；emitter 失败或 rootGeneration 改变必须回滚 shadow state。

## 16. 性能合同

- Result/Policy/Coverage slot 使用预分配 TypedArray SoA；搜索函数返回一个小整数 handle/status。
- scalar ActionProgram fast path 只读取 firstCommandCode，不遍历 queue。
- policy 取样 O(policyActionCount)，根受限 action 上界由 manifest 生成；可选累计二分只有 Benchmark 证明收益后采用。
- EventBuffer、ActionArena、PolicyArena 用 usedCount rewind；不逐条 free。
- 热路径无 Float32Array/Float64Array、字符串、BigInt、对象、闭包和随机 API。

## 17. 必须测试

- CommandCode encode/decode 全域与 unused-bit canonicality；
- teleport cell0/最大 cell/sentinel；
- ActionRef 重用但 ActionKey 不变；
- TT key 重绑定当前 action set；
- Event overflow 全 transition undo；
- lower≤upper、unknown sentinel 不参与算术；
- deterministic/mixed policy 都经 policyHandle；
- 概率最大余数归一化和稳定 tie；
- XORSHIFT32 source/minified 序列一致、0 seed 修复；
- multiply-high 对 BigInt 离线 Oracle 全边界一致；
- stale Coverage/Policy generation 被拒绝；
- cache on/off 与 Result ABI 一致。

## 18. DD2 决议

Action 的稳定语义、arena 地址和实际 frame 执行被彻底分离。Result 只有一个统一版本，可同时表达 HardGate、Proof、上下界、Expected/Robust、deterministic/mixed policy 和 incomplete；正式热路径不需要浮点或临时对象。
