# DD4 ReferenceKernel 合同

状态：DD4 规范合同，2026-07-15。定义规则校准用的独立、可读、确定性 ReferenceKernel；它是 FastKernel 的差分 Oracle，不是平台实现的副本。

关联：`DEC-0018`、`DEC-0027` 至 `DEC-0029`、`DEC-0037`、`DEC-0043`；`OI-R0-*`、`OI-R1-*`、`OI-R2-*`。输入数据由 [dd4-rule-corpus.json](dd4-rule-corpus.json) 和 [rule-corpus-schema.md](rule-corpus-schema.md) 管理。

## 1. 目标与非目标

ReferenceKernel 必须在一个显式 RuleContext 下回答：

```text
完整 PhysicalState
+ 双方本帧已执行 command head
+ ChanceOutcome
+ RuleVariantSelection
-> ordered canonical events
-> 后继 PhysicalState
-> 双方 observation relation
-> TerminalResolution
```

目标：

- 规则代码可审阅，phase、字段、事件和 UNKNOWN 都显式；
- 使用对象友好状态和不可变结果，优先正确性而非吞吐；
- 可穷举有限 RuleVariant、chance support 和小型状态；
- 对 replay、官方规则、外部 simulator 和未来 FastKernel 产生同一种 canonical trace；
- 能定位第一个 phase/event/state/observation 差异，而不是只比较 winner。

非目标：

- 不进入生产 bundle；
- 不满足 Minimax 热路径零对象要求；
- 不读取 Tank v1 的内部状态作为物理真值；
- 不使用外部 simulator 默认值关闭平台规则；
- 不实现策略、风险、评分或最终动作选择。

## 2. 逻辑模块

```text
RuleCorpusLoader
SourceAdapter
  PlatformReplayAdapter
  ExternalSimulatorAdapter
  GeneratedFixtureAdapter
ReferenceStateCodec
ReferenceScheduler
ReferenceFrameTimeline
ReferenceTerrainKernel
ReferenceEntityKernel
ReferenceSkillKernel
ReferenceObservationKernel
ReferenceTerminalResolver
CanonicalTraceBuilder
VariantDifferentialRunner
SmallExhaustiveOracle
```

Reference 与 Fast 共享字段语义、CommandCode/EventCode、phase id、RuleDefinition 和测试输入，不共享实现函数。直接让 Fast 调 Reference 内部 helper 会破坏差分独立性。

## 3. ReferenceState

ReferenceState 使用结构化对象；所有会影响 transition 的字段仍须与 DD2 owner 表一一对应：

```text
ReferenceState {
  rulesetVersion
  phaseOrderId
  terminalPolicyId
  platformFrame
  phaseOrdinal
  map: { width, height, terrainColumnMajor, terrainVersion, topologyVersion }
  tanks[2]
  projectiles[]
  bombs[]
  star
  commandQueues[2]
  observationMemory[2]
  runtimeOrder
  terminalFlags
  assumptionMask
}
```

ReferenceState 不允许使用“缺字段等于零”。字段必须是具体值、`null`（规范允许不存在）或 typed unknown：

```text
Known(value)
Unknown(ruleId, domainOrInterval)
Inconsistent(sourceRefs)
```

`Unknown` 不参加普通 JavaScript 算术。读取 unknown 的规则必须分叉有限 domain、返回 interval，或生成 `REFERENCE_UNSUPPORTED_RULE`；禁止隐式转换为 0/false/空数组。

## 4. RuleContext

```text
RuleContext {
  ruleCorpusFingerprint
  rulesetVersion
  phaseOrderId
  terminalPolicyId
  activeVariantByGroup
  probabilityIntervalByRule
  observationCapability
  strictEligibilityMask
}
```

- 每次 transition 固定一个 context；执行中不得从全局 registry 读取“最新值”。
- 未选择且有多个 active candidate 的 variant 返回 `REFERENCE_VARIANT_REQUIRED`。
- VariantDifferentialRunner 可以对同一 fixture 枚举 context，但 RuleVariant 不是游戏搜索的第四量词。
- source evidence、match ID 和注释不进入 physical state/hash；context 的语义版本必须进入 trace header。

## 5. Canonical event

Reference 使用 [action-result-abi.md](action-result-abi.md) 的 EventCode 语义，开发期记录附加可读 payload：

```text
CanonicalEvent {
  phaseOrdinal
  substepOrdinal
  sequenceOrdinal
  eventCode
  actorSeat
  targetSeat
  entitySemanticId
  sourceEntitySemanticId
  cellBefore/cellAfter
  valueBefore/valueAfter
  reasonCode
  ruleId
}
```

规范化示例：

- 平台 `bomb.placed` 与外部 `bomb.created` 都映射 `BOMB_PLACED`；
- projectile `go order=0/1` 映射 `PROJECTILE_MOVED` + substep；
- projectile `crashed` 必须附规范 stop reason，若原 replay 无法唯一恢复则 reason 为 typed unknown；
- speech/log 永不进入 physics trace；
- raw objectId 只帮助 SourceAdapter 关联，不进入 canonical entity identity。

事件排序 key 是 `(platformFrame, phaseOrdinal, substepOrdinal, sequenceOrdinal)`。同 key 重复、phase 倒退或 owner 不一致使 fixture 失败。

## 6. 规范 phase

当前平台主 phase：

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

一个 phase 内有 unresolved shared-resource variant 时，Reference 运行每个 variant 并分别产生 trace。只有输出完全相同才可形成 common trace；输出不同则 Value 取外扩区间、Proof/Hard 返回 UNKNOWN/HARD_INCOMPLETE、Fast 返回 unsupported。

## 7. 单帧算法

```text
advanceFrame(state, executedHeads[2], chanceCodes, context):
  validateCompletePhysicalState
  clone parent to reference child
  emit trace header

  expireDueEffectsAndLocks
  spawnDueKnownStar
  reconcile scheduled command heads

  for seat in [0, 1]:
    prepare execution without side effects
    apply stun/freeze/poison outcome from chance/variant
    execute seat slot

  collectCurrentStar under selected contest rule

  for substep in [0, 1]:
    advance every active projectile under selected resource rule

  resolve all due bombs under selected bomb batch rule
  resolve terminal with explicit trigger and policy
  observeForSide(child, 0)
  observeForSide(child, 1)
  canonicalize and validate child

  return ReferenceTransition
```

`prepare execution` 不产生副作用，因此 legality、stun chance、boost compound 和失败消费可以在写状态前验证。Reference 可以 clone state，但输出必须包含 `statePatch` 与完整 signature，避免 clone 掩盖漏字段。

## 8. Entity/terrain 规则边界

### 8.1 Projectile

- 每颗 projectile 独立 semantic id、owner、shot group、member ordinal、cell、direction 和 active state；
- 创建帧进入两个 substep；每个 substep 在命中/墙/土堆/边界/盾后立即停止；
- projectile 互穿，不互相抵消；该项当前为 USER_CONFIRMED，严格 Proof fixture 需平台升级前携带 assumption bit；
- overload member 0 从 tank cell，member 1 从固定正轴侧移 cell 产生；两者随后独立；
- 多 projectile 争用 dirt/shield/tank 时运行 `PROJECTILE_SEQUENTIAL_REPLAY_ORDER` 与 `PROJECTILE_SUBSTEP_BATCH` variants，除非 fixture 不受次序影响。

### 8.2 Bomb

- placed frame、explode frame、owner、cell、visibility 和 active 生命周期分离；
- blast 先由 phase-start terrain 生成 cardinal range，再按 variant 处理多 bomb 共享 terrain；
- wall 截止，dirt 包含后截止并被毁；
- shield 对一次 bomb damage 完全消费；
- bomb 与 action/projectile 的主 phase 已确认，多个 due bomb 的内部顺序仍由 variant 表达。

### 8.3 Terrain

Reference 每次 mutation 记录 before/after cell 与 terrainVersion。地图是 `map[x][y]`/column-major。动态 tank/projectile/bomb 不写进 terrain array。

## 9. Skill state machine 边界

每个 skill 使用共同状态：

```text
skillId
readyFrame
activeFromFrame/activeUntilFrame
targetSeat
remainingCharges
statusFlags
```

已确认 support：

- shield：持续最多 4 帧、两次 bullet charge、bomb hit 全消费；
- freeze：2 帧不能行动，已排队 command 不丢失；
- stun：6 帧，GO 与 TURN 各有 NORMAL/REVERSED support；无反向语义的 FIRE/BOMB/SKILL 保持正常执行；概率未知；
- overload：10 帧内下一次 successful FIRE 产生两个独立 projectile；
- cloak：6 帧隐藏 tank，受 teleport reveal 覆盖；
- poison：4帧相对施加时刻按`ACT-HOLD-ACT-HOLD`降低cadence，HOLD不出队；当前observed `canActThisFrame`仍是已提交事实，empty-repoll/ready边界为variant；
- teleport：合法目标、star 邻格 support、2 帧 pickup lock、近敌 2 帧 fire lock 和 landing reveal event；邻格概率与 reveal 精确 deadline未确认；
- boost：6 帧，GO 最多两格，第一 executed TURN 免费并可继续同队列 main command。

unknown deadline/support 不得通过 Reference 默认值变成 exact。依赖 poison/freeze/boost empty repoll 或 teleport reveal deadline 的 fixture 必须显式选择 variant或返回 unsupported。

## 10. Observation

```text
observeForSide(state, seat, context)
  -> ObservationRelation { alternatives[], complete, incompleteReason }
```

- enemy tank 在 grass/cloak 下隐藏，teleport reveal 可覆盖；
- enemy projectile 依据观察者 forward 90° cone 与 wall/dirt 遮挡；
- API 为 singular `enemy.bullet` 而物理可多弹时，输出所有仍可能被 API 选择的 visible projectile alternatives；
- open bomb visible，grass bomb hidden；已观察 bomb 后不可因暂时不可见而从 TrackedState 删除；
- observation 规则未知时返回 relation，不任选一个对象；
- `observeForSide` 只能读取 side-legal state 与 RuleContext，测试必须检测 TruthState 泄漏。

Reference transition 同时返回双方 relation；InformationState partition 使用完整 observation history + own action memory 分组。

## 11. TerminalResolver

Terminal 输入必须区分 trigger 与 tiebreak reason：

```text
trigger = CRASH | FRAME_LIMIT | TIMEOUT | NONE
tiebreak = SURVIVOR | STAR | RUNTIME | EXACT_TIE | NONE
```

优先级：

1. runtime timeout 独立失败；
2. 单方 crash：survivor；
3. 双方 crash：star，再 runtime；
4. 完成最后允许 record 的完整 phase 后触发 frame limit：star，再 runtime；
5. runtime exact tie 未确认时 `UNKNOWN_RULE`，不猜 seat priority。

244 局证明 recordIndex 127 仍可产生 seat action、projectile substep 和 terrain/bullet stop；终局在该完整 record 后发生。`platformFrame` 映射不完整的外部输入仍必须携带 frame-coordinate variant，不能只用数组长度。

## 12. 返回状态

```text
REFERENCE_OK
REFERENCE_TERMINAL
REFERENCE_UNKNOWN_RULE
REFERENCE_VARIANT_REQUIRED
REFERENCE_INCOMPLETE_INPUT
REFERENCE_INCONSISTENT_SOURCE
REFERENCE_UNSUPPORTED_RULE
REFERENCE_INTERNAL_ERROR
```

`ReferenceTransition`：

```text
status
childState
orderedEvents
statePatch
physicalSignature
observationsBySide
terminalResolution
activeAssumptionMask
consumedRuleIds
firstUnknownRuleId
```

Reference 不使用 HardGateStatus 代替规则错误。Hard/Proof 消费 Reference 结果时再按 DD1 algebra 映射。

## 13. SourceAdapter 与 replay 重建

平台 replay fixture 有两种合法形式：

1. `EXPLICIT_SETUP`：fixture 自带完整 pre-state；
2. `REPLAY_PREFIX_TO_STATE`：固定 replay hash，从初始地图和 record 0 顺序重放到 target record 前，得到 pre-state。

第二种仍是可执行 fixture，但必须：

- 固定 matchId、replayHash、recordIndex、platformFrame mapping 和 adapterVersion；
- 校验 prefix 每一条 canonical trace；
- 任何无法恢复的 queue、hidden entity、cooldown 或 observation history保留 typed unknown；
- factual replay 只验证原动作路径，不能验证分叉后的后缀；
- target event 可作为 transition expected，后续 records 不能补填当前不可观察字段。

ExternalSimulatorAdapter 固定 commit `1ef804e...`，只产生 `EXTERNAL_SIM_MATCH` 或 differential mismatch，不提升 rule status。

## 14. Variant differential

对每个 VARIANT fixture：

```text
for variant in finiteVariantGroup:
  run ReferenceTransition
  capture trace/state/observation/terminal
classify:
  IDENTICAL
  VALUE_ONLY_DIFFERENCE
  OBSERVATION_DIFFERENCE
  HARD_OR_TERMINAL_DIFFERENCE
  UNSUPPORTED_DOMAIN
```

- IDENTICAL 可生成 common Fast path；
- VALUE_ONLY 只能传播 interval；
- OBSERVATION_DIFFERENCE 进入 InformationState split；
- HARD_OR_TERMINAL_DIFFERENCE 禁止 strict Proof/Fast；
- UNSUPPORTED_DOMAIN 是 DD4/R1 阻塞，不能缩成两个方便的猜测。

## 15. SmallExhaustiveOracle

Reference 必须支持 3×3/5×5 小地图穷举：

- 双方 cardinal pose/action；
- 0–2 projectile、0–2 bomb；
- shield 0/1/2 charge；
- chance support；
- terminal/crash/star/runtime；
- observation mirror。

用途是验证规则闭包和 DD6 Proof 小型 oracle。它不用于 Monte Carlo，也不把深度穷举结果变成平台证据。

## 16. 性能与确定性

Reference 是冷层，允许对象和完整断言，但必须有界：

- 不允许无界 replay/network 读取；source artifact 在运行前固定；
- variant 数、chance support、entity 数由 fixture manifest 给出；
- canonical sort 使用稳定整数 key；
- 随机规则只接受明确 ChanceCode，不调用 `Math.random()`；
- source/minified 的 trace/signature 必须一致；
- 同一 fixture/context 重跑必须 byte-identical JSON canonical output。

## 17. 验收门

DD4 ReferenceKernel 设计完成需满足：

1. RuleCorpus 每个 rule/variant 都能映射到一个 handler 或 explicit unsupported；
2. R0 confirmed fixtures 可运行完整 transition；
3. R1 所有技能的 action/event support 已确认、有限 variant 化或显式生产阻塞；
4. R2 support 与 probability interval 分离；
5. replay、external、generated fixture 都能输出 canonical trace；
6. UNKNOWN 不被转换为 0、DRAW、HARD_ALLOW 或 exact expected；
7. DD5 FastKernel 只能消费 canonical rule table，不复用 Reference 实现。

若 DD4 fixture 发现 DD2/DD3 无法表达的物理字段，必须递增逻辑/物理 ABI 并回退阶段；ReferenceState 私藏字段不算通过。
