# DD5 Reference/Fast 差分设计报告

状态：DD5 设计级差分矩阵，DD10 规则修订，2026-07-16。21 个 DD4 fixture 均已分配 Fast 预期行为、比较字段和失败语义；JavaScript Reference/Fast 实现及真实性能执行不属于本轮设计文档修改，必须在实现阶段运行后才能声明 execution PASS。

关联：[reference-kernel-contract.md](reference-kernel-contract.md)、[fast-kernel-contract.md](fast-kernel-contract.md)、[hazard-kernel-contract.md](hazard-kernel-contract.md)、[dd4-rule-corpus.json](dd4-rule-corpus.json)、[benchmark-contract.md](benchmark-contract.md)。

## 1. 结论

DD5 不把“Reference 和 Fast 都返回一个 winner”视为一致。差分最小单位是规范 phase trace：

```text
fixture/context
-> ordered events
-> state patch + canonical PhysicalSignature
-> observation relation for side0/side1
-> terminal resolution
-> committed hazard contribution
-> undo root signature
```

差分矩阵区分三种合法结果：

```text
FAST_EXACT_EXPECTED
  当前输入只使用已冻结规则，Fast 必须逐字段等于 Reference。

FAST_COMMON_PATH_EXPECTED
  variant candidates 对当前输入输出相同；Fast 必须等于 common projection。

FAST_UNSUPPORTED_EXPECTED
  variant/unknown 对当前输入会影响输出；Fast 必须 fully undo 并返回 unsupported/incomplete。
```

第三种不是测试失败。真正失败是 Fast 默选一个 variant、产生部分 state、遗漏事件或把 unsupported 改成安全/非终局。

## 2. Harness 架构

```text
RuleCorpus fixture
  -> SourceAdapter / explicit setup
  -> canonical ReferenceState
  -> StateCodec -> Fast PhysicalState

ReferenceKernel(context)       FastKernel(generated table)
          |                              |
          +------ CanonicalComparator ---+
                         |
           first divergent phase/field

Fast branch mark
  -> apply
  -> compare
  -> undo
  -> RootRestoreComparator
```

Reference 与 Fast 只共享 schema、integer ids、fixture input 和 canonical comparator；不得共享 transition helper。SourceAdapter 只在冷层把 replay prefix/aggregate fixture 变成可重建 setup，Fast 不解析 replay。

## 3. 比较层级

每个 exact/common case 按下列顺序短路定位第一个差异：

1. status 与 completeness；
2. phase/substep/sequence event count；
3. 每个 event 的 eventCode、actor/target、entity semantic identity、cell、value、reason；
4. terrain patch 与 terrain/topology version；
5. tanks、queues、effects、cooldown、shield charges；
6. active projectile/bomb canonical multiset；
7. star、frame、phase、terminal flags；
8. PhysicsSignature 与 entity multiset signature；
9. side0/side1 observation relation alternatives/completeness；
10. TerminalResolutionStatus、trigger、tiebreak、outcome；
11. committed SourcePlan/timeline semantic fingerprint；
12. undo 后 root signature、owner usedCounts、active masks 和 versions。

hash 只用于快速定位；hash 相同不能替代结构核验。

## 4. DD4 fixture 覆盖矩阵

| Fixture | Fast 预期 | 必比内容 | 规则边界 |
|---|---|---|---|
| `FX-SEAT-ORDER-AGGREGATE` | EXACT | seat0/seat1 event order、state writes | 聚合证据先由 adapter 生成最小显式 setup |
| `FX-PROJECTILE-CREATE-MOVE-AGGREGATE` | EXACT_QUALIFIED | 创建帧两个 substep、stop lifecycle、plan | crossing assumption 不参与该输入时 exact；否则携带 assumption |
| `FX-STAR-PHASE-AGGREGATE` | COMMON | spawn/collection phase | 无 contest exact；contest 触发 unsupported |
| `FX-BOMB-AFTER-PROJECTILE` | EXACT | action→projectile→bomb、terrain/damage | 否定外部 bomb-before-action |
| `FX-FREEZE-SEAT1-CAST` | COMMON | seat order、freeze state/deadline、queue | 不触发 empty-repoll variant时 common |
| `FX-MUTUAL-PROJECTILE-KILL` | EXACT_QUALIFIED | 完整 damage batch、mutual crash、terminal | crossing assumption；不能在首个 crash 短路 |
| `FX-SHIELD-ABSORB-ONE-AND-STAY` | EXACT | hit event、remaining charge=1、projectile removal | 两 hit shield |
| `FX-SHIELD-GENERATED-TWO-HIT` | EXACT | 两次顺序 hit、charge 2→1→0 | bomb consume 使用独立 case |
| `FX-OVERLOAD-GEOMETRY-PLATFORM` | EXACT | member0/1 origin、group、独立 handle/trajectory | 固定正轴垂直 offset |
| `FX-LIMIT-AFTER-FULL-RECORD` | EXACT | recordIndex127 全 phase 后 terminal | 禁止 before-action-128 |
| `FX-TIMEOUT-RANGE` | COMMON/UNSUPPORTED | timeout fact terminal priority | 已给定 timeout fact可 exact；推断精确 comparator unsupported |
| `FX-STUN-SUPPORT-GENERATED` | EXACT | NORMAL/REVERSED ChanceCode 的执行 | probability 不属于 Fast transition |
| `FX-TELEPORT-STAR-SUPPORT` | EXACT | 每个合法 target ChanceCode、pickup/fire lock | target probability 不属于 Fast transition |
| `FX-TELEPORT-REVEAL-DOMAIN` | UNSUPPORTED when deadline-sensitive | observation alternatives、cloak/reveal precedence | reveal exact deadline variant 未冻结 |
| `FX-MOVE-CONTEST-VARIANTS` | UNSUPPORTED when contested | no mutation + full undo | 无争用移动仍走 exact common path |
| `FX-MULTI-BOMB-VARIANTS` | UNSUPPORTED when outputs diverge | no partial terrain/damage/event | 不受次序影响的 case 可 common |
| `FX-POISON-CADENCE-CONFIRMED` | EXACT `ACT-HOLD-ACT-HOLD` relative cadence | executionStatus/queue dequeue/event sequence | 绝对platform parity不得参与 |
| `FX-POISON-EMPTY-REPOLL-VARIANTS` | UNSUPPORTED when same-frame empty repoll affects branch | queue/phase capability untouched after undo | 已完成cadence prefix仍exact |
| `FX-EXACT-RUNTIME-TIE-VARIANTS` | UNSUPPORTED | TerminalResolution UNKNOWN_RULE | 不猜 seat priority |
| `FX-BOOST-COMPOUND-GENERATED` | COMMON | free first turn + same-slot main command | 触发 empty repoll variant时 unsupported |
| `FX-FAILED-CAST-FAMILY-VARIANTS` | COMMON/UNSUPPORTED | consume/queue/event behavior | candidates 投影一致才 common |

`R2-FUTURE-STAR` 无 DD4 fixture，并被 RuleCorpus 明确排除在 exact physics/proof。Fast 只接受 state 中已给定的 due star/chance outcome；不会在物理核内猜未来 star 分布。

## 5. 派生 fixture 扩展

每个可执行基础 fixture 生成以下 metamorphic cases：

- seat perspective swap；
- 地图内合法的平移；
- 90/180/270 度旋转，overload 固定正轴 offset 使用规范转换后的预期；
- x/y reflection，仅在规则非手性或显式调整 member geometry 时使用；
- entity slot permutation，canonical semantic multiset 不变；
- projectile insertion order permutation，仅对不受 resource order 影响的 case；
- cache off/on；
- singleton direct path 与 single-world materialize path；
- source/minified build；
- apply/undo 重复 1、2、N 次无漂移。

任何 metamorphic 关系都必须由规则允许，不能用错误“对称性”覆盖 overload 的固定正轴手性。

## 6. Hazard/ReverseViability 差分

Reference hazard oracle 不复用 Fast SourcePlan。它从 Reference ordered events 向前展开 committed entity，并用小地图 exhaustive continuation 判定 viability。

| Case family | Reference Oracle | Fast 被测输出 |
|---|---|---|
| projectile lifecycle | event-by-event entity closure | SourcePlan segments/end reason |
| bomb lifecycle | phase-accurate blast enumeration | BombPlan/blast contributions |
| shield/multiple hits | exhaustive ordered damage | lethal/exposure split、charge consume |
| escape before impact | small exhaustive action tree | ReverseViability frontier/firstActionMask |
| no escape | exhaustive all our continuations | no-viable certificate |
| mutual crash | Reference TerminalResolver | final Hard classification，不以 crash shortcut |
| hidden multi-world | per-world exhaustive closure | per-world certificate + information aggregation |
| unknown/variant | Reference variant divergence | incomplete，不生成 forbidden fact |

地图小于等于 fixture bound 时逐 microstate exhaustive；大图只用于性能和结构测试，不作为证明 Oracle 的替代。

## 7. Apply/undo 故障矩阵

每个 fixture 在以下边界注入 `capacity-1`、`capacity=required` 和 guard corruption：

| 故障点 | 期望状态 | 必须恢复 |
|---|---|---|
| entity spawn pool | `FAST_INCOMPLETE_ENTITY_CAPACITY` | entity mask/free-list/hash |
| transition delta | `FAST_INCOMPLETE_DELTA_CAPACITY` | 全 state/versions |
| semantic event | `FAST_INCOMPLETE_EVENT_CAPACITY` | eventUsed + 全 state |
| observation alternatives | `FAST_INCOMPLETE_OBSERVATION_CAPACITY` | partition/alternatives/state |
| hazard contribution | `HARD_INCOMPLETE` | source plan/timeline/physical root |
| reverse frontier | `HARD_INCOMPLETE` | viability scratch/root |
| invalid handle/generation | internal consistency | 所有 owner marks |
| forced exception guard | execution/internal error | root canonical signature |

cache capacity 不属于事实故障：full/miss 必须重算并保持 exact result。

## 8. 性能测量设计

DD5 只冻结测量单位和结构门，不冻结 DD8 的生产预算：

### 函数级

- prepare/apply/undo 单 action；
- projectile substep per active entity；
- bomb blast per due entity；
- terminal O(1)；
- source plan build/hit/invalidate；
- forbidden lookup；
- reverse bitset one layer；
- observation relation per entity。

### 复合级

- 20×20 terrain + 双 skill + 多 projectile/bomb；
- shield + overload + terrain destruction；
- action set 全部候选先 HardGate 后评分；
- multi-world shared timeline 与独立 delta；
- unresolved variant 的快速 unsupported/undo。

### 全景/终局级

- 到最后 committed entity 失效的 closure，不按 minimax depth 截断；
- recordIndex127 完整 terminal；
- mutual crash star/runtime；
- fallback profile 共享相同 physical/hard semantics；
- source/minified、cache off/on、normal/degraded semantic checksum。

每个样本记录 warmup、iterations、median/P95/P99、events/deltas、high-water、bytes、cache hit/miss和 semantic fingerprint。不得用 cache warm run 代替 cache-off correctness baseline。

## 9. 设计级准入结果

| DD5 差分设计门 | 状态 | 说明 |
|---|---|---|
| 21 DD4 fixtures 有 Fast disposition | DESIGN PASS | exact/common/unsupported 全覆盖 |
| state/event/observation/terminal 比较字段 | DESIGN PASS | 不只比较 winner/hash |
| committed Hazard 有独立 Reference oracle | DESIGN PASS | exhaustive small-state，不共享 helper |
| apply/undo fault matrix | DESIGN PASS | owner 与容量逐项覆盖 |
| unresolved rule 行为 | DESIGN PASS | unsupported/incomplete + full undo |
| 性能层级与指标 | DESIGN PASS | 函数/复合/全景/终局 |
| JavaScript Reference/Fast 实际运行 | IMPLEMENTATION PENDING | 设计完成后实施，不在本文伪报 PASS |
| 平台 source/minified 性能预算 | DD8 PENDING | 由实际引擎、bundle 和 runtime 冻结 |

## 10. 实现阶段通过标准

一个 build 只有同时满足以下条件才可宣称 DD5 implementation verified：

```text
exact/common fixture divergence count = 0
unsupported fixture accidental apply = 0
partial mutation on any failure = 0
root restore mismatch = 0
hazard strict false-positive = 0
active committed source early truncation = 0
source/minified semantic mismatch = 0
cache-off/on semantic mismatch = 0
```

性能只能在上述 correctness 全部为零后排序候选；更快但少事件、少 support 或少 closure 的实现自动淘汰。
