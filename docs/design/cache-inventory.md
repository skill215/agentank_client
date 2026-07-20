# DD8 唯一 Cache Inventory 与 Key Matrix

状态：DD8 规范合同，2026-07-16。缓存名称、owner、semantic/version key、value、cutoff、碰撞、生命周期和失效以本文及 [dd8-cache-inventory.json](dd8-cache-inventory.json) 为唯一清单；旧文档名称只作alias。

关联：`DEC-0015`、`DEC-0036`、`DEC-0042`、`DEC-0051`、`DEC-0058`、`DEC-0059`、`DEC-0064`；`OI-ARCH-007`、`OI-R3-007`；[memory-capacity-manifest-schema.md](memory-capacity-manifest-schema.md)。

## 1. 缓存不是状态

缓存可以关闭、清空、未命中或被替换而不改变语义结果。以下不是cache：

- ObservedRoot/TrackedState/PhysicalState/InformationState；
- active projectile/bomb实体事实；
-当前root committed HazardTimeline/HardViableSet；
-CommandQueue/PendingOwnCommand；
-Active PersistentPlan header；
-Result/Policy/Coverage live arena。

它们属于各owner working set/事实池，容量失败按FACT/SUPPORT/OUTPUT规则处理，不能通过cache eviction解决。

## 2. Canonical inventory

```text
PHYSICAL_VALUE_TT
INFORMATION_VALUE_TT
PROOF_CACHE
STAGE_MATRIX_CACHE
CHANCE_CACHE
PATH_CACHE
FEATURE_CACHE
BELIEF_CACHE
ENTITY_PLAN_CACHE
REGRET_WARM_CACHE      optional, default off
TRANSITION_CACHE       optional, default off
```

旧名迁移：

| 旧名 | Canonical id | 说明 |
|---|---|---|
| PhysicsTT | PHYSICAL_VALUE_TT | 完全物理stage value，不是transition cache |
| InformationTT / ValueTT | INFORMATION_VALUE_TT | InformationState ValueSearch唯一TT |
| ProofCache | PROOF_CACHE | strict独立保护表 |
| StageMatrixCache / RootCache matrix | STAGE_MATRIX_CACHE | root/关键节点matrix warm/exact |
| RegretCache | REGRET_WARM_CACHE | 只能warm start |
| TransitionCache | TRANSITION_CACHE | 独立optional physical patch |

禁止再创建`RootCache`、`PhysicsCache`、`PlanCache`等未登记同义表。新增cache必须增加inventory schema version、decision和cache-off differential。

## 3. Search profile key拆分

DD8明确区分：

```text
SearchSemanticProfileId
  horizon utility、Eval/Risk/continuation basis等“值是什么”。进入ValueSearchKey。

SearchBudgetProfileId / RuntimeMode
  node/depth attempt、batch、matrix iteration、write policy等“算多少”。不自动进入值语义key。
```

若fallback实际切换EvalProfile、horizon、continuation basis，则对应semantic id/depth字段自然不同；不能只靠`runtimeMode`隐藏语义变化。相同semantic key下，NORMAL和FALLBACK可共享已完成bounds/Proof/physics；incomplete条目仍保留flags，不因换mode升级。

## 4. Key matrix摘要

| Cache | Semantic key核心 | Version核心 | 可存value | Cutoff资格 |
|---|---|---|---|---|
| PHYSICAL_VALUE_TT | PhysicsHash+depth/horizon+semantic profiles | rules/state/result/risk/feature | interval/bound/action/policy key | matching complete bounds |
| INFORMATION_VALUE_TT | ValueSearchKey+depth/horizon | belief/model/risk/feature/rules | interval/gap/action/policy key |结构核验后complete bounds |
| PROOF_CACHE | DecisionHash+goal+horizon+coverage+ActionKey | support/partition/rules/proof ABI | strict status+compact coverage | assumption0/full coverage |
| STAGE_MATRIX_CACHE | ValueSearchKey+action sets+chance+solver semantic | matrix/policy/risk/model | cells/sets/avg policies/BR/gap | full BR+complete cells才exact |
| CHANCE_CACHE | physical+both actions+support context | chance/rules/skill | support/probability interval | 不直接cutoff |
| PATH_CACHE | topology+goal+capability+mound delta | map/path/skill capability | distance/ETA/dependencies | deadline proof另需certificate |
| FEATURE_CACHE | state+ActionKey+feature+declared deps | feature/optional model/plan | raw feature/completeness | point或verified horizon envelope |
| BELIEF_CACHE | observation history+visibility+effects+command belief | observation/entity/rules/belief algo | exact prefix+lossless residual+belief/partition | 不直接cutoff |
| ENTITY_PLAN_CACHE | entity generation/signature+terrain/time/capability | entity/hazard/path/rules | trajectory/blast/escape/contributions/raw physical | strict层另核source/coverage |
| REGRET_WARM_CACHE | exact public-belief subgame/action/basis | matrix/risk/feature/model | regret/avg strategy/gap hint | never |
| TRANSITION_CACHE | physical+both actions+ChanceCode | Fast/state/event/rules | replayable patch/events/child/terminal | 只复用完整物理transition |

完整字段与机器可检查列表以JSON为准；Markdown不得另加隐藏key。

## 5. Hash与碰撞

所有cache至少使用双uint32 hash + compact semantic signature：

```text
probe hash bucket
-> compare version/generation
-> compare compact counts/signature
-> strict cache进一步比较support/coverage摘要
-> only then HIT
```

实体multiset使用可增减双hash，不用XOR抵消重复实体。返回raw handle/offset的value必须核验generation；TT保存ActionKey/PolicyKey，不保存ActionRef/PolicyHandle。

无法完成核验视为MISS。`INCOMPLETE_CACHE_UNVERIFIED`只用于本应生成strict结论但无法核验的路径；普通cache miss不产生search incomplete。

## 6. 布局和替换

-每cache独立预分配TypedArray SoA；
-entry count为2的幂，bucket=`keyLo & mask`；
-2-way/4-way由DD8 benchmark profile选择并记录manifest，不运行时混用；
-generation避免每frame清零，wrap按manifest策略整体reset；
-Proof protected entries与soft values不共slot；
-active entity的当前SourcePlan working set不被cache替换；其跨分支副本可淘汰并重算。

替换优先顺序由cache class固定：empty → old generation/version → off-root/incomplete/shallow → lower reuse estimate。严格Proof只能被同级更新或旧version淘汰。

## 7. 生命周期和失效

### Match-static

PATH静态topology/ray可整局；terrain dependency mutation只失效相关entry/suffix。

### Entity-lifetime

ENTITY_PLAN按handle generation/physical signature缓存到规范失效；overload member独立，shot group共享header。terrain/shield/tank交互改变只失效受影响后缀。

### Root/search/reroot

Value/Matrix/Belief/Feature通过exact signature自然reroot。新root不保存JS Node树；只保留PV key、TT、Proof、matrix warm、ActivePlan引用。

### Version reset

RULESET/phase/state/event/proof ABI变化按descriptor整体失效；objective/opponent/profile变化只失效声明依赖的soft cache。不得“更新常量但读取旧entry”。

### Consistency failure

root hash/undo/owner mismatch使当前search generation全部不可发布；相关cache writes丢弃。长期事实池重新由ObservedRoot协调，不读取可疑cache恢复事实。

## 8. Cache off/on语义

每个cache descriptor必须有direct fallback：

- value/proof/matrix：重新搜索/返回当前sound interval；
- chance/path/feature/belief/entity plan：直接重算；
- transition：Fast apply；
-regret warm：zero-regret cold start。

Cache full只替换或MISS；不得返回0、无路径、无危险、空support、旧score或旧action。cache-off/on必须产生相同Physics/Terminal/Hard/Proof、相同complete Value/Policy和相同PRNG选择；若时间预算导致完成深度不同，比较共享完成horizon的semantic fingerprint而不是强求动作偶然相同。

## 9. Runtime mode中的cache

- NORMAL：允许全部enabled cache读写；
- DEGRADED：可停止低收益write，保留cheap probe；
- FALLBACK：优先Proof/Value/PATH/ENTITY_PLAN已验证hit；可禁用Regret/Transition和高成本write；
- EMERGENCY：不依赖任何cache才能完成root fact/Hard/emitter；verified active SourcePlan working set可用，miss直接最小扫描。

mode变化不清空事实或Proof；只通过SearchBudgetProfile控制访问。cache lookup batch必须计入runtime reserve。

## 10. 容量选择

每cache生成候选entry counts/ways：

```text
netBenefit = hitCount * recomputeCostSaved
           - probes * lookupCost
           - writes * writeCost
           - invalidationCost
           - memory/opportunity cost
```

correctness先通过，再在函数、复合、全景、终局和完整对局测cold/steady/P95/P99。只有多层workload净收益为正且不挤压EmergencyReserve/事实池才进入production。`REGRET_WARM_CACHE`和`TRANSITION_CACHE`默认off，需要独立更强证据。

数值结果写MemoryCapacityManifest的`BENCHMARK_SELECTED`字段；当前设计不把DD3 synthetic capacity宣称为平台最终值。

## 11. Production strip

诊断build记录probe/hit/write/replacement/invalidation/work saved/latency/bytes。production剥离counter和名字，只保留key/value/version/replacement必要字段。关闭统计不能改变访问顺序、generation或结果。

## 12. 必须测试

- JSON inventory id唯一、alias闭合、11 entries字段完整；
-每cache off/on semantic differential；
-hash collision/compact signature mismatch视为MISS；
-stale generation/ActionRef/PolicyHandle拒绝；
-opponent/profile改变只失效声明cache；
-terrain dirt mutation局部失效PATH/ENTITY_PLAN suffix；
-active projectile/bomb不因cache eviction从state消失；
-Proof protected replacement；
-NORMAL→FALLBACK共享相同semantic completed result；
-optional caches default-off仍通过全景/终局；
-source/minified generation/replacement/fingerprint一致。

## 13. 冻结结论

Cache inventory现在只有11个canonical id，`InformationTT/ValueTT`和`PhysicsTT/TransitionCache`的旧歧义已消除。缓存模块独立于业务模块：它只能复用完整派生结果，任何miss/full/disable都回到同一语义重算。
