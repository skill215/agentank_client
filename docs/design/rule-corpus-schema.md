# DD1 RuleCorpus Schema 与 Fixture 目录

状态：DD1 语义合同 + DD4 schema revision 2。定义规则、证据、变体、输入状态、ordered events、observation、terminal 和 proof eligibility；可执行实例见 [dd4-rule-corpus.json](dd4-rule-corpus.json)。

关联：`DEC-0018`、`DEC-0029`；`OI-R0-001` 至 `OI-R0-011`。

## 1. 目标

RuleCorpus 是规则校准和 Reference/Fast 差分的唯一可执行事实入口。它必须回答：

```text
在指定 rule/variant、完整状态、双方 command 和 chanceCode 下，
按什么 phase 产生哪些有序 event、后继 state、双方 observation 和 terminal？
```

RuleCorpus 不保存策略权重，不把外部模拟器结果自动升级为平台真值，也不把 historical action 当成期望 action。

## 2. 两类记录

### 2.1 RuleDefinition

```text
ruleId
category                   // R0/R1/R2；R3 策略/性能参数不进入物理 RuleCorpus
title
status                     // CONFIRMED/VARIANT/UNKNOWN/REJECTED
sourceRefs[]
preconditions
phaseOrdinal
stateReads[]
stateWrites[]
emittedEventTypes[]
chanceSupport
chanceProbabilityInterval
observationEffectBySide
terminalImpact
unknownRuleBehavior
variantIds[]
activeVariantId
fixtureIds[]
hashDependencies[]
cacheDependencies[]
proofEligibility
rulesetVersionIntroduced
```

### 2.2 RuleFixture

```text
fixtureId
schemaVersion
title
tags[]
ruleIds[]
sourceRefs[]
setup
input
expectedByVariant
proofExpectation
performanceClass
mirrorOf
```

DD4 revision 2 增加：

```text
fixtureKind                 // PLATFORM_SLICE/MULTI/AGGREGATE/GENERATED_EXPLICIT/GENERATED_VARIANT
reconstruction              // EXPLICIT_SETUP 或 REPLAY_PREFIX_TO_STATE 等
variantGroup
```

`PLATFORM_SLICE` 可以不重复保存巨大完整 setup，但必须固定 replayHash，并从初始地图顺序重放 prefix 得到 target record 的完整 pre-state。它不是“省略 setup”；setup 是可复现的 adapter 输出。无法重建的 queue/hidden/deadline 保留 typed unknown，禁止用后续 replay 补值。

## 3. SourceRef

```text
sourceType                 // UPDATE/GUIDE/PLATFORM_REPLAY/PLATFORM_SIM/EXTERNAL_SIM/USER/INFERRED
sourceId
sourceVersionOrHash
matchId
recordIndex
platformFrame
eventSequenceRange
extractorVersion
contentHash
notes
```

平台 replay fixture 必须同时保存 matchId、recordIndex 和 platformFrame；只有映射已验证时才能省略其中一个。外部 simulator 必须保存 commit，不允许写 `main`。

## 4. Setup 与 Input

```text
setup:
  mapWidth/mapHeight
  terrainColumnMajor
  tanks[]
  projectiles[]
  bombs[]
  star
  effects[]
  cooldowns[]
commandQueues[]
commandEligibleAtFrames[]
platformFrame
  runtimeOrder/runtimeTicks
  phaseOrderId
  terminalPolicyId
  observationHistorySeed

input:
  nodeKind
  submittedProgramsBySeat[]
  executedCommandHeads[]
  chanceCodes[]
  hiddenWorldId
  ruleVariantSelection
```

字段使用语义名称；DD2 生成 binary fixture 时必须无损映射。Fixture 不能省略“默认刚好为零但会影响结果”的字段。

## 5. ExpectedByVariant

每个 variant 的期望包含：

```text
executionStatuses[]
orderedCanonicalEvents[]
statePatch
physicalStateSignature
observationsBySide[]
observationPartitionSignature
terminalResolution
incompleteReason
```

`statePatch` 用于可读 review；`physicalStateSignature` 用于实现差分。两者不一致时 fixture 失败，不允许只比较最终 winner。

## 6. ProofExpectation

```text
strictEligible
expectedProofStatus
expectedHardGateStatus
requiredCoverage
forbiddenAssumptionMask
allowedIncompleteReasons
```

- 规则证据不属于 OFFICIAL_UPDATE/GUIDE/PLATFORM confirmed 时，默认 `strictEligible=false`；
- support 已知、概率未知时，universal Proof 可 strict eligible，但 ExpectedValue 不 exact；
- 多个 active RuleVariant 产生不同 terminal/hard 结果时，ProofStatus 必须 UNKNOWN；
- external simulator 一致只能作为 expected variant，不能设置 strictEligible=true。

## 7. 有限 RuleVariant Inventory

| Variant group | 候选 | 生产行为 |
|---|---|---|
| Seat action order | `SEAT_0_THEN_1` | 平台 replay confirmed，生成唯一 phase table |
| Boost free turn repoll | `NO_REPOLL` / `SAME_FRAME_REPOLL` | active 为 NO_REPOLL；依赖差异时 Proof UNKNOWN |
| Frozen empty queue poll | `POLL_AND_HOLD` / `NO_POLL` | 进入 command HiddenWorld；Fast 只推进相同物理结果 |
| Contested same-target/swap move | `SEQUENTIAL_BLOCK` / `INTENT_BLOCK` / `COLLISION_CRASH` | 普通GO进入同record确定腾空的帧初位置已有平台共同fast path；same-target/swap及boost/teleport/effect复合仍为Reference/诊断variant，Fast strict disabled |
| Star contest | `SEAT_PRIORITY` / `NO_COLLECTION` / `COLLISION_RESULT` | no-cooccupancy fast path不受影响 |
| Projectile shared resource | `SEQUENTIAL_PLATFORM_ORDER` / `SUBSTEP_BATCH` | dirt/shield/terminal 受影响则 UNKNOWN_RULE |
| Multiple due bombs | `SEQUENTIAL_PLACEMENT_ORDER` / `BATCH_START_TERRAIN` | 受共享 terrain/shield 影响则 UNKNOWN_RULE |
| Frame limit boundary | `AFTER_COMPLETE_RECORD_INDEX_127` | 128-record replay 的最后 record 仍执行 action/projectile；输入时间坐标不完整时是 input incomplete |
| Runtime threshold | `GE_3000` / `GT_3000` | RuntimeController 提前 fallback，不靠精确踩线 |
| Exact runtime tie | `DRAW` / `SECONDARY_KEY_UNKNOWN` | strict terminal 依赖时 UNKNOWN_RULE |
| Visible multi-projectile | `ONE_OF_VISIBLE_SET` | ObservationSplit 枚举实体，不限制内部 pool |

RuleVariant 是开发层模型不确定性，不作为生产搜索第四量词。构建时未收敛且会影响当前 action 的变体必须返回 unsupported/incomplete，而不是选数组第一个。

## 8. UNKNOWN 行为矩阵

| 未知类型 | ReferenceKernel | ValueSearch | Proof/Hard | FastKernel | Production emitter |
|---|---|---|---|---|---|
| 有限 RuleVariant，结果相同 | 全变体差分 | 可复用共同 interval | 可在证据等级允许时证明 | 生成共同 fast path | 正常使用 |
| 有限 RuleVariant，结果不同 | 全变体展开 | lower=min lower，upper=max upper | UNKNOWN / HARD_INCOMPLETE | 返回 UNSUPPORTED_RULE | 避免依赖该交互的 action |
| support 已知、概率未知 | 枚举 support | 概率区间 backup | universal AND 可证明 | 固定 support table | 正常但不声称 exact expected |
| support 未知 | 登记 unresolved support | 最大合法 interval | UNKNOWN | unsupported | 保守 fallback |
| observation 选择未知 | 枚举 observation relation | InformationState backup | coverage 全部 relation | DD2 set-valued adapter | 不把 null/单值当完整事实 |
| capacity overflow | 保留完整对象参考 | incomplete interval | UNKNOWN/HARD_INCOMPLETE | 返回对应 subsystem 的 `IncompleteReason` | Emergency policy，不丢事实 |
| source conflict | 分别运行 source variants | 跨来源 interval | UNKNOWN | 不生成冲突规则 | 禁用依赖动作 |

每个 RuleDefinition 的 `unknownRuleBehavior` 必须引用本矩阵的一个具体行并可附加 action family；空值阻塞构建。

## 9. DD1 R0 Fixture Catalog

### 9.1 Action/Scheduler

| Fixture ID | 目的 | 证据/variant |
|---|---|---|
| ACT-QUEUE-001 | turn/fire 跨帧 | GUIDE_CONFIRMED |
| ACT-SUBMIT-DELAY-001 | onIdle 提交后最早下一 frame 执行 | GUIDE_CONFIRMED |
| ACT-GO2-001 | go(2) 展开 | GUIDE_CONFIRMED |
| ACT-BOOST-001/002/003 | 免费 turn、main、过期 | Guide + variants |
| ACT-FIRE-LOCK-001 | command consumed/no projectile | GUIDE_CONFIRMED |
| ACT-FREEZE-01-MIRROR | seat 顺序与 queue hold | PLATFORM_REPLAY_CONFIRMED |
| ACT-STUN-SUPPORT-001 | chance support | Guide + R1 variant |
| ACT-POISON-HOLD-001 | cadence 不 dequeue | Guide + R1 variant |
| ACT-SIMULTANEOUS-001 | choice simultaneous、execution ordered | DESIGN/phase contract |

### 9.2 Timeline/Physics

| Fixture ID | 目的 | 证据/variant |
|---|---|---|
| TL-SEAT-ORDER-001-MIRROR | seat 0 → seat 1 | 9,642 replay frames |
| TL-BULLET-CREATE-MOVE-001 | 创建帧移动 | 1,078 replay frames |
| TL-BULLET-SUBSTEP-0/1 | 两 substep/提前失效 | 3,649 projectile-frame samples |
| TL-STAR-BEFORE-BULLET-001 | collect phase | 95 replay co-occurrences |
| TL-STAR-RESPAWN-10 | spawn deadline | 228 replay pairs |
| TL-BOMB-MOVE-OUT/IN | action before explosion | causal replay fixtures |
| TL-BULLET-BEFORE-BOMB | projectile phase first | platform replay |
| TL-MOVE-CONTEST-* | 同目标/swap/collision | 3 variants |
| TL-MULTI-PROJECTILE-SHARED-* | dirt/shield/tank | 2 variants |
| TL-MULTI-BOMB-* | terrain/shield | 2 variants |
| OBS-MULTI-BULLET-ONE-OF | 单数 API/多实体 | observation relation |

### 9.3 Terminal

| Fixture ID | 目的 |
|---|---|
| TERM-SINGLE-CRASH-001 | survivor wins regardless of stars |
| TERM-MUTUAL-STAR-001 | double crash star tiebreak |
| TERM-MUTUAL-RUNTIME-001 | double crash runtime tiebreak |
| TERM-LIMIT-STAR-001 | frame limit star tiebreak |
| TERM-LIMIT-RUNTIME-001 | frame limit runtime tiebreak |
| TERM-RUNTIME-TIMEOUT-001 | 3 秒 timeout 与 runTime cause 分离 |
| TERM-EXACT-TIE-* | DRAW/secondary-key variants |
| TERM-LIMIT-AFTER-FULL-RECORD | recordIndex 127 完整 action/projectile 后 terminal |

## 10. Fixture 变换

每个 R0 fixture 支持以下机械变换：

- `mirrorSeat`：交换 seat、owner、initiative 相关字段；
- `mirrorMapX/Y`：映射坐标和方向；
- `swapPerspective`：只交换 expected WIN/LOSS，不改变物理 trace；
- `sourceToCanonical`：platform/external raw 转 canonical；
- `canonicalToExternal`：只供 simulator adapter；
- `source/minified`：同输入必须输出相同 ActionProgram/trace signature。

seat mirror 不得改变规则为“我方先手”；seat 0 始终是平台 initiative。

## 11. 示例

```json
{
  "fixtureId": "TL-BOMB-MOVE-OUT-001",
  "schemaVersion": 1,
  "ruleIds": ["R0-PHASE-BOMB-AFTER-ACTION"],
  "sourceRefs": [{
    "sourceType": "PLATFORM_REPLAY",
    "matchId": "mat_LjZoCdmhQP29ldr8x",
    "recordIndex": 29,
    "platformFrame": 29
  }],
  "setup": {
    "platformFrame": 29,
    "phaseOrderId": "PHASE_PLATFORM_20260715",
    "terminalPolicyId": "TERM_PLATFORM_20260715"
  },
  "input": {
    "nodeKind": "AUTOMATIC_FRAME",
    "ruleVariantSelection": "BOMB_AFTER_ACTION"
  },
  "expectedByVariant": {
    "BOMB_AFTER_ACTION": {
      "terminalResolution": {"status": "RESOLVED", "outcome": "NON_TERMINAL"}
    }
  },
  "proofExpectation": {
    "strictEligible": true,
    "forbiddenAssumptionMask": 0
  }
}
```

完整 fixture 必须直接包含或通过固定 replay prefix 可重建 tank/bomb positions、ordered events、statePatch 和 observations；示例只展示 schema 关键字段。

## 12. 验证层

1. schema validation；
2. source adapter reconstruction；
3. Reference expected event/state/observation/terminal；
4. RuleVariant differential；
5. Fast vs Reference；
6. apply/undo/root signature；
7. cache on/off；
8. source/minified；
9. corpus manifest/fingerprint。

胜率、动作一致率和外部 simulator pass 不能替代第 3–8 层。

## 13. 性能与构建

- JSON/证据字符串只存在离线；
- 构建脚本把 confirmed RuleDefinition 生成整数 phase/skill/terminal 表；
- production 不包含 fixture、matchId、RuleVariant 列表或 source note；
- build manifest 保存 RuleCorpus fingerprint、规则表 hash、active variant 和 rejected rule；
- 相同规则表必须可重复生成相同 bytes/hash。

## 14. DD1 结论

`OI-R0-001` 至 `OI-R0-011` 均已有唯一语义或有限 RuleVariant，并且每类 unknown 都有 Reference、Value、Proof、Fast 与 emitter 行为。DD4 已生成 schema revision 2 corpus、handler binding、platform replay reconstruction 与 generated variant fixtures；后续实现不得新增未登记的隐式 phase。
