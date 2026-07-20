# DD7 Plan 生命周期与缓存边界合同

状态：DD7 规范合同，2026-07-16。冻结PlanSketch、ShotPlan、BombPlan、SkillPlan的生命周期、实体绑定、deadline、依赖、重评分、缓存和Hard重验证；DD5 SourcePlan仍是物理派生索引，DD8拥有缓存容量/替换。

关联：`DEC-0012` 至 `DEC-0015`、`DEC-0048`、`DEC-0051`；`OI-ARCH-008`；[hazard-kernel-contract.md](hazard-kernel-contract.md)、[evaluation-contract.md](evaluation-contract.md)、[skill-state-machine-contract.md](skill-state-machine-contract.md)。

## 1. Plan 是意图，不是事实

```text
Plan
  为什么选择/继续一组动作，绑定目的、依赖、实体和deadline。

SourcePlan
  DD5对已存在projectile/bomb的物理trajectory/blast派生索引。

CommandQueue
  已提交给平台、等待执行的命令事实。
```

三者owner分离。Plan不能创造projectile/bomb、不能延长实体寿命、不能覆盖CommandQueue，也不能成为Hard/Proof事实来源。

## 2. 两级表示

为兼顾“每个FIRE/BOMB都有明确目的”和性能：

```text
PlanSketch
  node-local固定小记录；每个FIRE/BOMB/需要follow-up的skill action都必须有。

PersistentPlan
  只为root finalists/selected action materialize；可跨真实帧。
```

PlanSketch包含purpose、target mask handle、deadline、cheap raw features、dependency mask和ActionKey。没有Sketch的FIRE/BOMB不进入动作集；但不为全部候选复制trajectory/path数组。

## 3. 生命周期

```text
CANDIDATE_SKETCH
  -> PENDING_EXECUTION
  -> ACTIVE
  -> COMPLETED
  -> INVALIDATED
```

转移：

- selected root action通过validation/emitter后，sketch复制为PENDING_EXECUTION；
- Command执行并产生预期canonical event/entity时转ACTIVE并绑定handle/generation；
-执行no-effect/failed按purpose转COMPLETED_NO_EFFECT或INVALIDATED_EXECUTION；
-目标达成、所有绑定实体规范失效、窗口完成转COMPLETED；
-事实/规则/dependency/Hard/terminal冲突转INVALIDATED；
-任何terminal结束全部plan生命周期。

Plan state只由root reconciliation/canonical events提交，hypothetical search不能改PersistentPlan。

## 4. 通用记录

```text
PersistentPlanRecord
  planHandle/generation
  planKind/purpose
  lifecycleStatus/reasonCode
  createdFrame/selectedFrame/activatedFrame
  deadlineFrame/deadlinePhase
  rootDecisionSignature
  actionKeyLo/Hi
  commandProgramSignature
  targetMaskHandle/targetSignature
  boundEntityStart/count
  shotGroupHandle or bomb/skill handle
  terrain/topology/objective versions
  belief/observation/opponent epochs
  ruleset/skill/feature/profile versions
  physicalDependencyMaskLo/Hi
  scoreDependencyMaskLo/Hi
  dirtyMaskLo/Hi
  rawFeatureRef/featureSignature
  sourcePlanSignature/trajectoryRef
  lastValidatedFrame
  cachedScore/scoreProfileId
```

handle/generation失配立即invalid；不得按裸slot重新绑定“看起来相同”的新实体。

## 5. ShotPlan

Purpose：

```text
DIRECT_KILL
INTERCEPT
ZONE_DENIAL
TERRAIN_BREAK
BELIEF_SWEEP
SHIELD_BREAK
```

附加字段：

```text
target world/cell/path set
expected impact frame/substep
shotGroup/member handles
covered/denied cell-time mask signature
counter-fire/escape deadline
bullet slot opportunity cost
hit/observation confidence interval
```

### 5.1 多 projectile

overload成功FIRE后一个ShotPlan绑定shotGroup和两个独立member handles：

-每member有独立SourcePlan/trajectory/active generation；
-一个member碰墙/命中不删除另一个；
-group raw features按member contribution增量扣除；
-直到全部members失效或purpose完成，Plan保持ACTIVE；
-新terrain/entity event只失效依赖它的member suffix。

### 5.2 BELIEF_SWEEP

保存覆盖的Possibility/route/grass mask和“结果是否必然可观察”flag。无必然反馈时，未命中只调整probability/Plan score，不能删除possibility或生成Proof。

## 6. BombPlan

Purpose：

```text
DIRECT_KILL
ZONE_DENIAL
TERRAIN_BREAK
STAR_DENIAL
BELIEF_SWEEP
ESCAPE_FORCING
```

附加字段：placement cell、explode deadline、blast signature、terrain dependency、escape viable signature、interference、coverage、resource cooldown和bound bomb handle。

Bomb从placed event到explosion/removal始终由PhysicalState+SourcePlan保存。临近deadline的“必须逃离”不是Plan升级成Hard，而是DD5 committed bomb事实让Hazard/ReverseViability产生HardGate；这样删除/损坏Plan也不会丢失安全约束。

爆炸后Plan可保留一个root observation reconciliation步骤完成purpose/feature更新，随后COMPLETED；物理bomb已按Fast event删除。

## 7. SkillPlan

SkillPlan字段由技能合同扩展：cast/active/consume deadline、target、required follow-up、resource window和chance/unknown flags。

- Overload：绑定后续successful FIRE/ShotPlan；
- Cloak/Boost：绑定movement/ambush窗口；
- Teleport：绑定target family、landing alternative、pickup/fire lock和escape；
- Shield/Freeze/Stun/Poison：绑定防守/控制目的和有效窗口；
-任何follow-up仍是新action，必须过Submission/Hard/Value；Plan不能强制提交。

## 8. Root revalidation pipeline

每个真实root按固定顺序：

```text
1. reconcile pending command and canonical creation/execution events
2. validate plan handle/generation/ruleset/root lineage
3. validate bound entity generations and lifecycle
4. apply physical dirty events to SourcePlan suffix/dependency versions
5. validate target/objective/observation/belief assumptions
6. regenerate candidate continue/cancel ActionKeys
7. run DD5 HardGate for every continue action
8. refresh only dirty raw features
9. recompute score for current Eval/Risk/Opponent profile
10. keep ACTIVE / COMPLETE / INVALIDATE
```

Plan continuity只给ordering/feature bonus。新ForcedWin、唯一Hard-safe action、terminal relation或真实observation可以无条件打断Plan。

## 9. Dirty 与缓存

Physical dependencies和score dependencies分开：

| 变化 | 物理缓存 | raw feature | score |
|---|---|---|---|
| profile/weight变化 | 保留 | 保留 | 重做dot |
| opponentModelEpoch | 保留 | 只重算OPPONENT依赖 | 重做 |
| risk/state class | 保留 | 通常保留 | robust/score重做 |
| terrain dependency hit | 失效受影响trajectory/blast suffix | 相关feature dirty | 重做 |
| entity member失效 | 删除该contribution | group feature增量dirty | 重做 |
| star/objective变化 | 保留无关trajectory | objective/target dirty | 重做 |
| observation/belief变化 | committed source保留 | belief/target feature dirty | 重做 |
| ruleset/phase变化 | 全物理派生失效 | 全dirty | Plan invalid/build reset |

EntityPlanCache存SourcePlan/trajectory/blast/escape tree等物理派生；FeatureCache存raw features；PersistentPlan只存handle/signature/dependency。缓存full/miss重算，Plan不能把stale score当事实。

## 10. Invalidation reasons

```text
PLAN_EXECUTION_FAILED
PLAN_ENTITY_MISMATCH
PLAN_ENTITY_COMPLETE
PLAN_DEADLINE_EXPIRED
PLAN_TARGET_GONE
PLAN_TERRAIN_CHANGED
PLAN_OBSERVATION_CONTRADICTED
PLAN_RULE_OR_ABI_CHANGED
PLAN_HARD_REJECTED
PLAN_FORCED_OVERRIDE
PLAN_CAPACITY_OR_CONSISTENCY
PLAN_PURPOSE_COMPLETE
```

Reason是整数enum；开发adapter可映射字符串，production不保留文本log。

## 11. Plan 与搜索

- ActivePlan continue/cancel进入动作排序和restricted matrix初始集；
- Plan不能永久剪掉其他action；Double Oracle/Proof仍看完整support；
-Plan cached score只在完整ValueSearchKey匹配时复用；
-hypothetical branch可创建node-local PlanSketch，但不能写PersistentArena；
-根mixed policy若选择多个action，只为实际抽中的action提交PersistentPlan；
-emitter失败/root generation变化时Plan shadow commit和PRNG一起回滚。

## 12. 容量与性能

- PlanSketch为固定SoA slab，创建O(1)且只含small masks/handles；
-PersistentPlan active数量由manifest固定，通常每kind少量；不使用对象链；
-root revalidation common path O(bound entity count + dirty dependencies)，无dirty时O(1)；
-projectile/bomb已发出后trajectory/blast缓存到规范失效，不每node/每frame重建；
-raw feature与score分离，profile调整只点积；
-target大mask存Arena/cache，Plan只持handle/signature；
-Plan不读wall clock/history/log；
-capacity不足使候选不建立persistent plan并返回OUTPUT/PLAN incomplete，不能提交无计划FIRE/BOMB。

## 13. 必须测试

- PlanSketch覆盖每个FIRE/BOMB而不复制trajectory；
- pending→active通过canonical event绑定generation；
-fire consumed no bullet、bomb failed cast、skill no-effect生命周期；
-overload一member失效另一member继续；
-bomb逃生Hard在删除Plan后仍存在；
-terrain只失效依赖suffix；
-profile/opponent/risk只重评分，不重建物理；
-belief sweep无必然反馈不删possibility；
-ActivePlan不能阻止ForcedWin/Hard override/Double Oracle扩列；
-stale handle/cache collision被拒绝；
-source/minified/cache-off-on Plan选择/生命周期一致。

## 14. 冻结结论

所有FIRE/BOMB先有廉价PlanSketch，只有finalist/实际动作生成PersistentPlan。射弹和炸弹出现后，物理SourcePlan与trajectory/blast缓存到实体失效；Plan只增量维护目的、依赖和raw score。安全永远来自PhysicalState/Hazard，因此Plan损坏、切换或淘汰也不会触发硬失败。
