# DD2 内存与容量 Manifest Schema

状态：DD10同步schema。物理表示、canonical cache/runtime/build字段已冻结；具体生产容量值只能由v2实现benchmark写入`BENCHMARK_SELECTED`，平台字节门属于G9，运行artifact完整性属于G11。

关联：`DEC-0010`、`DEC-0015`、`DEC-0022`、`DEC-0023`、`DEC-0036`、`DEC-0038`、`DEC-0101`、`DEC-0102`、`DEC-0106`；`OI-ARCH-001`、`OI-ARCH-002`、`OI-ARCH-006`、`OI-ARCH-011`、`OI-R3-005`、`OI-R3-007`、`OI-R3-008`。

## 1. 目的

每个构建必须在代码生成前回答：

- 地图、实体、world、event、delta、action、policy 和 cache 各占多少字节；
- 上限来自平台规则、构建 profile 还是仅 corpus 观察；
- 容量不足时是构建失败、branch incomplete、cache miss 还是 emergency；
- 哪些容量关系到正确性，哪些只关系到性能；
- source/minified 是否使用同一 manifest。

禁止在业务模块散落 `new Uint8Array(400)`、`MAX=32` 一类未登记常量。

## 2. Manifest 顶层

```text
manifestSchemaVersion
buildId/buildProfile
rulesetVersion
phaseOrderId/terminalPolicyId
state/entity/observation/command/action/event/result/policy/prng ABI versions
guideHash/ruleCorpusFingerprint
targetRuntimeClass

platformLimits
ruleDerivedLimits
configuredSearchLimits
observedEvidence
scalarTypes
capacityParameters
formulaTable
arenaTable
arrayTable
overflowPolicyTable
cacheConfig
totalBytes
validationResults
```

Manifest 是构建产物；正式 bundle 只保留生成后的必要整数常量，不保留 JSON 字符串或证据说明。

## 3. 上限来源

每个 capacity parameter 必须标记：

```text
PLATFORM_CONFIRMED
RULE_DERIVED
BUILD_CONFIGURED
CORPUS_OBSERVED_LOWER_BOUND
BENCHMARK_SELECTED
UNKNOWN_BLOCKING
```

`CORPUS_OBSERVED_LOWER_BOUND` 永远不能单独作为数组安全上限。

### 3.1 当前 corpus 证据

244 个唯一平台 replay 的 observed lower bounds：

| 指标 | 最大观察值 | 用途 |
|---|---:|---|
| map width × height | 22×20 | DD3 workload 下界，不是平台上限 |
| canonical/raw events per frame | 13 | EventBuffer fixture 下界 |
| concurrent projectile | 3 | multi-entity fixture 下界 |
| concurrent bomb | 2 | bomb pool fixture 下界 |
| external object ID length | 8/16/17 | 证明不能定长解析 identity |

正式上限必须来自 Guide/Updates/平台校准或显式更大的 build configuration。

## 4. CapacityParameter schema

```text
name
value
unit
sourceKind
sourceRef
minimumObserved
formulaDependencies[]
semanticCritical
productionRequired
unknownBehavior
validationFixtureIds[]
```

基础参数至少包括：

```text
MAX_MAP_WIDTH/MAX_MAP_HEIGHT/MAX_CELLS
MAX_TANKS
RULE_MAX_PROJECTILES_PER_TANK
RULE_MAX_ACTIVE_BOMBS_PER_TANK
MAX_EFFECT_SLOTS_PER_TANK
MAX_OWN_PROGRAM_COMMANDS
MAX_TRACKED_ENEMY_QUEUE_PREFIX
MAX_ACTIONS_PER_INFO_NODE
MAX_CHANCE_OUTCOMES_PER_JOINT_ACTION
MAX_WORLDS_PER_INFO_NODE
MAX_RESIDUAL_FACTORS
MAX_ENEMY_INFORMATION_SETS
MAX_OBSERVATION_PARTITIONS
MAX_DECISION_DEPTH/MAX_ACTIVE_INFO_DEPTH
MAX_EVENTS_PER_TRANSITION
MAX_DELTAS_PER_TRANSITION
MAX_POLICY_ENTRIES
MAX_COVERAGE_RECORDS
MAX_PROJECTILES_CREATED_PER_JOINT_ACTION
MAX_BOMBS_CREATED_PER_JOINT_ACTION
MAX_RESULT_SLOTS
MAX_RESTRICTED_OUR_ACTIONS/MAX_RESTRICTED_ENEMY_ACTIONS
MAX_ACTIVE_TRANSITIONS
MAX_ABSOLUTE_DEADLINE
```

enemy queue 没有平台公开长度上限时，prefix capacity 是 BUILD_CONFIGURED；未展开 suffix 必须进入 `RESIDUAL_QUEUE_SUFFIX`，不能当作 queue end。

## 5. 公式表示

公式必须是构建脚本解析的受限整数 AST，不使用运行时 `eval`：

```text
CONST(value)
PARAM(name)
ADD(...)
MUL(...)
MAX(...)
SUB_NONNEG(a,b)
CEIL_DIV(a,b)
ALIGN_UP(value,alignment)
```

核心公式：

```text
MAX_CELLS = MAX_MAP_WIDTH * MAX_MAP_HEIGHT
MAP_WORDS = CEIL_DIV(MAX_CELLS, 32)

MAX_ROOT_PROJECTILES =
  MAX_TANKS * RULE_MAX_PROJECTILES_PER_TANK

MAX_ROOT_BOMBS =
  MAX_TANKS * RULE_MAX_ACTIVE_BOMBS_PER_TANK

MAX_SEARCH_PROJECTILE_SLOTS =
  MAX_ROOT_PROJECTILES
  + MAX_DECISION_DEPTH * MAX_PROJECTILES_CREATED_PER_JOINT_ACTION

MAX_SEARCH_BOMB_SLOTS =
  MAX_ROOT_BOMBS
  + MAX_DECISION_DEPTH * MAX_BOMBS_CREATED_PER_JOINT_ACTION

MAX_WORLD_RECORDS =
  MAX_ACTIVE_INFO_DEPTH * MAX_WORLDS_PER_INFO_NODE

MAX_POLICY_ENTRIES =
  MAX_RESULT_SLOTS * MAX_RESTRICTED_OUR_ACTIONS

MAX_EVENT_SLOTS =
  MAX_ACTIVE_TRANSITIONS * MAX_EVENTS_PER_TRANSITION
```

搜索实体公式是保守 arena allocation 上界，不等于同一 PhysicalWorld 的规则 active 上限；free-list/usedCount 可以复用，但 manifest 必须证明 DFS 最大同时存活量。

### 5.1 Event 上限公式

`MAX_EVENTS_PER_TRANSITION` 必须由 phase 分项相加：

```text
MAX_TIMED_EXPIRY_EVENTS
+ MAX_STAR_EVENTS
+ MAX_SEAT_ACTION_EVENTS
+ MAX_PROJECTILE_EVENTS
+ MAX_BOMB_EVENTS
+ MAX_TERRAIN_EVENTS
+ MAX_DAMAGE_EVENTS
+ MAX_TERMINAL_EVENTS
```

每项引用规则表中的 tank/projectile/bomb/effect 上限。不得把 corpus 的 13 直接写成 capacity。

## 6. ScalarTypes

```text
CellT:
  selectedType: Uint16 | Uint32
  invalidValue
  requiredMaxValue: MAX_CELLS - 1

FrameT:
  selectedType: Uint16 | Uint32
  invalidValue
  requiredMax: MAX_ABSOLUTE_DEADLINE

CountT:
  selectedType: Uint16 | Uint32
  invalidValue
  requiredMaxValue

HandleLayout:
  typeBits/slotBits/generationBits
  requiredSlotsByEntityType

ArenaHandleLayout:
  slotBits/generationBits
  requiredPolicy/Coverage/PlanSlots
```

构建验证使用数学整数；不能先用 32 位位运算再检查溢出。若 Uint16 不够，生成 Uint32 variant 并改变 ABI version；禁止饱和写入。

## 7. ArenaDescriptor

```text
arenaId
lifetime                  // MATCH/PERSISTENT/ROOT/SEARCH/CACHE/EMERGENCY
owner
resetMode                 // IMMUTABLE/GENERATION/USED_COUNT/DIRTY_LIST
alignment
normalBytes
emergencyBytes
arrayIds[]
highWaterBenchmarkId
productionIncluded
```

规范 arena：

| Arena | 生命周期 | 主要内容 |
|---|---|---|
| MatchArena | 整局 | terrain geometry、规则/技能表 |
| PersistentArena | 跨 callback | TrackedState、entity tracks、runtime/PRNG、Plan headers |
| RootArena | callback | ObservedRoot、association、根动作 |
| SearchArena | search | worlds、physical scratch、delta、events、Result/Policy/Coverage |
| CacheArena | 整局/profile | TT/path/feature 等可关闭缓存 |
| EmergencyReserve | 整局预留 | 根真实事实、最小 action/event/output scratch |

## 8. ArrayDescriptor

每个 TypedArray/packed candidate 都有：

```text
arrayId
arenaId
owner
semanticPurpose
elementType
lengthFormulaId
stride
alignment
byteFormula
resetMode
hashParticipation
undoMode
capacityClass
overflowPolicyId
cacheVersionInputs[]
benchmarkIds[]
```

`elementType=PACKED_JS_ARRAY_CANDIDATE` 只用于读取 DD3 历史 A/B；DD3 physical revision 1 的正式 manifest 必须选择 TypedArray SoA。若 DD8 平台 benchmark 反转，必须递增 physical ABI revision，不能在同一构建运行时混用。

## 9. CapacityClass 与 overflow

### 9.1 `FACT_CRITICAL`

地图、已观察/已提交 tank/projectile/bomb、own queue：

- 正常池满先使用 EmergencyReserve；
- 仍不足返回 root/transition incomplete，禁用 Proof/strict Hard；
- 最终 emitter 只使用不依赖丢失事实的 emergency action；
- 永不截断、覆盖最旧或按概率删除。

### 9.2 `SUPPORT_CRITICAL`

world、association、partition、chance support：

- 先用 lossless residual/equivalence/prefix iterator；
- 无损表示失败则 branch/result incomplete；
- 不把 incomplete support 当作低概率。

### 9.3 `SEARCH_QUALITY`

action candidates、matrix columns、深度、regret iterations：

- 缩减 SearchProfile/返回 interval；
- 不改变 RulesKernel、Terminal 或已有 Proof；
- 被省略动作如果属于合法 support，严格 Proof 必须 UNKNOWN。

### 9.4 `CACHE_ONLY`

cache 满时按合同替换或当 miss；cache off/on 语义一致。CacheArena 不得借用 EmergencyReserve。

### 9.5 `OUTPUT_CRITICAL`

最终 ActionProgram/Policy decode 缓冲在 EmergencyReserve 中有独立固定 slot，不能被 search high-water 占用。

## 10. OverflowPolicy schema

```text
overflowPolicyId
capacityClass
firstResponse
fallbackResponse
resultStatus
hardGateStatus
proofStatus
incompleteReason
runtimeModeTransition
mustUndo
telemetryOfflineOnly
```

禁止通用 `OVERFLOW` 一码包办；至少区分：

```text
ROOT_ENTITY_CAPACITY
EVENT_CAPACITY
DELTA_CAPACITY
WORLD_CAPACITY
RESIDUAL_CAPACITY
ASSOCIATION_CAPACITY
PARTITION_CAPACITY
ACTION_CAPACITY
CHANCE_SUPPORT_CAPACITY
POLICY_CAPACITY
COVERAGE_CAPACITY
CACHE_CAPACITY
```

规范映射：

| OverflowPolicy | IncompleteReason/行为 |
|---|---|
| ROOT_ENTITY_CAPACITY | `INCOMPLETE_ROOT_ENTITY_CAPACITY` |
| EVENT_CAPACITY | `INCOMPLETE_EVENT_CAPACITY` |
| DELTA_CAPACITY | `INCOMPLETE_DELTA_CAPACITY` |
| WORLD_CAPACITY | `INCOMPLETE_WORLD_CAPACITY`，随后可尝试 lossless residual |
| RESIDUAL_CAPACITY | `INCOMPLETE_RESIDUAL_CAPACITY` |
| ASSOCIATION_CAPACITY | `INCOMPLETE_ASSOCIATION_CAPACITY` |
| PARTITION_CAPACITY | `INCOMPLETE_PARTITION_CAPACITY` |
| ACTION_CAPACITY | `INCOMPLETE_ACTION_SUPPORT` |
| CHANCE_SUPPORT_CAPACITY | `INCOMPLETE_CHANCE_SUPPORT` |
| POLICY_CAPACITY | `INCOMPLETE_POLICY_CAPACITY` |
| COVERAGE_CAPACITY | `INCOMPLETE_COVERAGE_CAPACITY` |
| CACHE_CAPACITY | cache miss/replace；不产生 incomplete，不改变语义 |

这里的名字是 manifest policy id；运行时只能返回 [action-result-abi.md](action-result-abi.md) 中对应的 `IncompleteReason`。

## 11. EmergencyReserve

EmergencyReserve 必须在初始化时独立预分配，不计入正常 arena usedCount：

```text
root fact slots for rule-derived physical maximum
minimal terrain/visibility scan scratch
committed hazard scan scratch
one deterministic ActionProgram
one Result/Policy/Coverage record
undo/consistency guard
```

它的作用是“在正常 search 内存失败时仍不丢已知危险并能输出”，不是继续完整 InformationState/Minimax。使用后当前局永久进入 fallback，并在离线 harness 记录原因；正式 bundle 可以不输出日志。

## 12. CacheConfig

每项 cache descriptor：

```text
cacheId
entryCount/entryStride/bytes
keyVersions
replacementPolicy
collisionVerification
enabledByProfile
semanticFallback
```

所有 cache 的 `semanticFallback` 必须是“重新计算/返回非 cutoff interval”，不能是默认安全值。Cache 总字节单独列出，方便 DD8 调小而不改变 state ABI。

## 13. 构建验证

构建失败条件：

- 任一公式负数、非整数或超过 JavaScript safe integer；`SUB_NONNEG` 的被减数小于减数也直接失败；
- selected scalar/handle/offset 位宽不足；
- arena total/array offset 超出 Uint32；
- FACT_CRITICAL 没有 normal+emergency 路径；
- SUPPORT_CRITICAL overflow 没有 explicit incomplete；
- EVENT/DELTA overflow 不能完整 undo；
- source/minified manifest hash 不同；
- production 包含 Reference/replay/evidence/log arrays；
- 总 bytes 超过尚待 DD8 冻结的平台门。

验证输出：

```text
array bytes and offsets
arena subtotals
normal/emergency/cache totals
rule-derived vs configured headroom
corpus observed utilization
DD3 benchmark high-water
manifest hash
```

## 14. DD3 必须验证的 profiles

1. corpus-max：22×20、3 projectile、2 bomb、13 events/frame；
2. rule-max：构建期规则物理上限；
3. hidden-composite：hidden tank/projectile/bomb/queue + multi-world；
4. terminal-composite：多 damage + star/runtime；
5. search-high-water：最大 active depth/world/matrix/delta；
6. emergency：逐类容量只差 1 的故障注入；
7. cache-off/on；
8. source/minified。

corpus-max 只用于保证真实积累不回退；rule-max 和故障注入才决定正确性门。

## 15. DD2 决议

容量是可审计构建输入，不是散落的实现常量。真实事实、完整 support、搜索质量、cache 和独立输出保留区使用五类不同 overflow 语义；只有这样才能同时满足高性能预分配与“硬失败条件不会因容量截断被漏掉”。
