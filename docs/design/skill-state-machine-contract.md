# DD7 Skill Descriptor 与策略状态机合同

状态：DD7 规范合同，DD10 平台回放修订，2026-07-16。冻结八技能的生成式descriptor、公开身份、构建专门化、动作/Plan/feature接口和UNKNOWN边界；技能物理仍唯一由DD4 RuleCorpus + DD5 FastKernel拥有。

关联：`DEC-0010`、`DEC-0019`、`DEC-0023`、`DEC-0029`、`DEC-0046`、`DEC-0047`；`OI-R1-*`、`OI-R2-*`；[dd4-rule-corpus.json](dd4-rule-corpus.json)、[fast-kernel-contract.md](fast-kernel-contract.md)、[evaluation-contract.md](evaluation-contract.md)。

## 1. 技能在何时已知

进入场地后的root输入公开：

```text
me.skill.type / cooldown / remaining cooldown
enemy.skill.type / cooldown / remaining cooldown
双方公开status/effects
```

因此技能身份不是HiddenWorld：

-我方skill在发布build时已知，可专门化为唯一OwnSkillEmitter；
-敌方skill进入局后已知，ObservationAdapter每root只把字符串分类为`enemySkillId`一次；
-搜索节点只读整数id/descriptor，不枚举八种skill身份；
-descriptor保留八种是bundle capability，不扩大每node动作分支。

若平台输入缺skill type，根为INCOMPLETE_INPUT，不用belief猜身份。

## 2. 物理与策略职责分离

```text
RuleCorpus/Fast SkillTable
  action legality, cooldown, duration, effect, chance, event, observation

SkillStrategyDescriptor
  feature dependencies, purpose families, target generation hint,
  risk/resource class, Plan kind, compute cost
```

策略descriptor引用Fast handler code/capability mask，但不实现第二份transition。任何官方规则变化先更新RuleCorpus/RULESET_VERSION并重新生成两表；禁止只改技能评分文件。

## 3. Descriptor ABI

```text
SkillStrategyDescriptor
  skillId
  actionFamilyCode
  targetFamilyCode
  fastCapabilityMask
  chanceSupportCode
  cooldownFrames/durationFrames       只读生成常量
  resourceClass
  purposeMask
  featureDependencyMaskLo/Hi
  riskFeatureMaskLo/Hi
  planKind
  targetGeneratorCode
  cheapPrefilterCode
  unknownCapabilityMask
  descriptorVersion
```

production不保存skill名称字符串。handler/feature/target code是生成整数，数组按skillId直接寻址。

## 4. 当前冻结表

| Skill | cooldown / active window | 物理support摘要 | 策略purpose与主要风险 |
|---|---|---|---|
| SHIELD | 25 / 最多4帧、2 bullet charges | bullet逐hit消费；bomb一次全消费 | SURVIVE、TRADE、WINDOW；过早使用的opportunity cost |
| FREEZE | 29 / 2帧 | 抑制行动、queue保留；seat phase已知 | INTERRUPT、ESCAPE、TERMINAL_DENY；empty repoll variant |
| STUN | 20 / 6帧 | GO/TURN normal/reversed support，其他无inverse正常 | DISRUPT、POSITION、SHOT_WINDOW；outcome probability未知 |
| OVERLOAD | 32 / 最多10帧等下一次successful FIRE | 两独立projectile、固定正轴offset | KILL、SHIELD_BREAK、ZONE；双trajectory/shot slot group |
| CLOAK | 35 / 6帧 | grass/cloak visibility，teleport reveal可覆盖 | AMBUSH、REPOSITION、INFO_DENIAL；敌方possible fire仍保留 |
| POISON | 20 / 4帧 | 施加后相对节拍 `ACT-HOLD-ACT-HOLD`；HOLD不出队 | CADENCE_DENY、TERMINAL_DELAY；空队列后同帧repoll仍incomplete |
| TELEPORT | 40 / instant + pickup/fire/reveal locks | target support、星邻格chance、pickup2、近敌≤4 firelock2 | ESCAPE、STAR、FLANK；高基数target/chance/reveal deadline |
| BOOST | 26 / 6帧 | GO≤2、每帧首次TURN免费且可同slot main command | MOBILITY、ESCAPE、CHASE；compound queue/empty repoll variant |

表值来自DD4冻结RuleCorpus；外部simulator的poison25、旧shield一hit等不得进入descriptor。

## 5. 通用策略状态机

每个side的skill状态由Fast physical fields决定：

```text
UNAVAILABLE_COOLDOWN
READY
CAST_PENDING
ACTIVE
ACTIVE_CONSUMABLE_ARMED
EXPIRED_OR_CONSUMED
RULE_INCOMPLETE
```

策略层只查询状态并生成action/feature/Plan；状态转移由Fast canonical events写入。failed cast是否消费cooldown按RuleCorpus执行，策略不得在提交时自行假设成功。

## 6. 动作生成

```text
generateSkillActionFamily(state, actor, skillId, outFamily)
  read generated descriptor
  cheap capability/Hard prefilter
  generate scalar action or target mask
  classify submission legality
  retain unknown execution outcomes in support
```

- shield/freeze/stun/overload/cloak/poison/boost通常scalar family；
-teleport使用legalTargetMask和candidateTargetMask，星格请求展开到合法相邻ChanceOutcome；
-candidateTargetMask只用于soft order；Proof/BR scan仍覆盖完整legal target family；
-unknown rule触发的target/effect必须Fast unsupported/HARD_INCOMPLETE，不能被skill score过滤成“不会发生”。

## 7. 技能价值与风险

descriptor只声明feature依赖，不内置总分。共同raw features：

```text
immediate terminal/proof impact          由严格层提供，不由skill猜
deadline slack change
future legal action options
opponent response support
resource/cooldown opportunity cost
observation/information change
star/position/kill robust gain
chance/hidden interval width
counter-skill interaction
Plan continuity
```

chance技能的Expected/Robust值由DD6对support/probability interval递归求解；不在descriptor使用50/50、均匀teleport等猜测。skill不能因评分高绕过Hard，不能因评分低从Proof action support删除。

## 8. 各技能特殊接口

### 8.1 Shield

策略查询`shieldHitsRemaining`、untilFrame、已提交hit timeline和未来窗口。两个bullet hit按独立event；bomb consume不能按“两次”估值。重复cast/failed cast只由Fast决定。

### 8.2 Freeze/Poison/Stun

动作抑制与queue继续是Scheduler事实。Poison 的已执行动作序列在 30 个完整平台样本中均为相对施加时刻的 `ACT-HOLD-ACT-HOLD`，不是“绝对平台帧偶数执行”的外部模拟器规则；HOLD 不 dequeue。仅当队列变空而后续同帧是否再次 poll 会改变分支时，Value 扩大区间且 Proof/Fast 返回 incomplete。Freeze 的 empty repoll/ready deadline仍按独立 variant 处理；Stun概率未知但support完整时Proof全覆盖NORMAL/REVERSED。

### 8.3 Overload

armed plan绑定下一次successful FIRE；创建后ShotPlan保存shotGroup和两个member handle。任何member消失不删除另一member；trajectory/score按group聚合、按member失效。

### 8.4 Cloak/grass

隐身只改变observation relation。策略可奖励信息控制/ambush，但敌方可能盲射、bomb、路径预射仍在PossibleHazard/Risk；不可见不是安全证书。

### 8.5 Teleport

-目标合法性由Fast逐world处理；
-请求star cell产生合法邻格chance support；
-落地后pickup/fire lock进入绝对deadline；
-reveal exact deadline未冻结，依赖观察branch incomplete；
-“teleport总在星旁”只允许在请求star tile的action family剪枝，不能对任意target套用。

### 8.6 Boost

免费首次turn与main command是一个ExecutedFrameAction compound；ActionProgram/Plan保存完整command sequence。不能把免费turn当独立额外搜索ply。

## 9. SkillPlan

需要跨帧窗口的技能建立SkillPlan：

```text
skillId/actionKey
cast frame/expected activation
active/consume deadline
purpose
target/target set
required follow-up family
resource/feature dependencies
chance/unknown flags
```

Overload必须绑定follow-up FIRE；Cloak/Boost可绑定movement/ambush window；Teleport绑定landing/lock/escape；Shield/Freeze/Stun/Poison可在cast完成后直接completed或转active window。每个follow-up action仍先过Hard/Proof。

## 10. 构建专门化

```text
build own skill X:
  include OwnSkillEmitter[X]
  include OwnSkillDescriptor[X]
  remove other own emitters/features with no shared use
  retain compact EnemySkillDescriptor[8]
```

构建器验证RuleTable/Descriptor版本、handler id、feature masks和target family闭合。正式节点按`enemySkillId`直接访问一次descriptor，只生成实际敌方skill action。

## 11. Unknown 与禁用

- skill support未知：production build阻塞或对应action capability disabled并显式unsupported；
- probability未知但support完整：Value interval/robust，Proof universal；
- exact deadline/empty-repoll variant影响branch：Fast unsupported、Hard/Proof incomplete；
- descriptor评分字段unknown：skill仍保留合法action，仅soft score incomplete；
- target容量不足：support-critical incomplete，不截teleport target后称完整；
- failed cast规则未知：不提交依赖其精确consume的strict plan。

## 12. 性能合同

- descriptor为固定TypedArray/生成常量，lookup O(1)；
-根字符串skill分类每callback最多一次，节点无字符串switch/插件对象；
-我方只一个专用emitter，敌方每node只一个实际descriptor；
-target高基数用bitset/lazy ActionFamily，不提前创建全部ActionRecord；
-shared skill features按root/block缓存，profile仅点积；
-Plan/trajectory引用handle，不复制数组；
-skill code不读wall clock/log；
-source/minified bytes与8 descriptor lookup进入DD8门。

## 13. 必须测试

-八descriptor与RuleCorpus constants/handlers逐项一致；
-own specialization只含一个emitter，enemy仍可八id直接查；
-root string分类后节点不访问字符串；
-shield两bullet/bomb consume、overload独立members；
-freeze seat order/queue、stun support、poison相对节拍和empty-repoll incomplete；
-teleport star-neighbor target剪枝只用于star request；
-boost compound action；
-chance probability未知不影响Proof support；
-skill score/Plan不绕过Hard/Terminal；
-source/minified/common-path/unsupported行为一致。

## 14. 冻结结论

技能身份进入场地后公开：我方构建专门化，敌方只在root转成整数id。历史语料只在 `PUBLIC_INPUT_CAPTURE`、`OBSERVED_CAST`、`SAME_TANK_INFERRED` 等明确 provenance 下提供技能事实；缺失 cast 不是 `none`。八种技能共享一套生成descriptor接口，规则仍由Fast唯一执行；策略层可以高性能评估窗口、风险和Plan，却无法复制或改写技能物理。
