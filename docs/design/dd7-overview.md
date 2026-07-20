# DD7 Overview 与一致性审计

状态：DD7 COMPLETE（详细设计），2026-07-16。DD8 READY。

## 1. 阶段结论

DD7 已把所有软决策模块冻结为五个有边界的消费者：

```text
Evaluation        raw feature -> integer point/envelope
StrategySelector  root state -> fixed profile bundle
OpponentModel     opportunity/choice -> nominal enemy policy
SkillDescriptor   RuleCorpus capability -> strategy/feature/Plan adapter
Plan              purpose/dependency/entity -> cross-root intent
```

共同硬边界是：它们只能影响Expected/Robust Value、action ordering、restricted matrix初始集、profile和Plan；不能写Physics、Possibility、Hard、Terminal或Proof。

## 2. 产物

| 文档 | 冻结内容 |
|---|---|
| [evaluation-contract.md](evaluation-contract.md) | 64-feature registry、cost tier、dependency、raw/weight分离、Table/Generated A/B |
| [strategy-selector-contract.md](strategy-selector-contract.md) | 5 primary、modifier、forced override、能力阶段、hysteresis、profile bundle |
| [opponent-model-contract.md](opponent-model-contract.md) | opportunity/choice、fast/slow、confidence、risk preference、action/fire probability |
| [skill-state-machine-contract.md](skill-state-machine-contract.md) | 八技能public identity、own specialization、enemy descriptor、action/feature/Plan接口 |
| [plan-contract.md](plan-contract.md) | PlanSketch/PersistentPlan、Shot/Bomb/Skill生命周期、dirty/cache/Hard重验证 |
| 本文 | 阶段退出门、冲突审计与DD8准入 |

## 3. 退出门

| DD7退出条件 | 设计结果 | 说明 |
|---|---|---|
| soft feature成本/范围有界 | PASS | 每feature有range、tier、dependency、max loop、unknown行为 |
| 可快速调动作分数 | PASS | raw feature缓存；profile/weight变化只重做整数dot |
| 一局只更新敌方参数 | PASS | 我方feature/strategy/risk表固定，OpponentModel epoch动态 |
| 对手风险喜好/开火概率可计算 | PASS | opportunity-normalized多维risk + context integer policy |
| strategy动态且不抖动 | PASS | root score interval、switch margin、dwell、hysteresis、forced override |
| 八技能不复制物理 | PASS | public id + generated descriptor引用唯一Fast handler |
| hidden/grass/cloak有风控 | PASS | PossibleShot、BeliefSweep、InformationControl；不删support |
| Plan实体/deadline/失效明确 | PASS | sketch→pending→active→complete/invalidate，generation/version完整 |
| projectile/bomb缓存到失效 | PASS | SourcePlan物理前缀共享，member/suffix事件驱动dirty |
|软模块不污染strict层 | PASS |所有文档显式禁止Hard/Terminal/Proof写入 |

这些是详细设计门。具体weights、alpha、risk class阈值和Table/Generated性能赢家仍需实现/benchmark，不在未运行时伪报数值最优。

## 4. 评分与性能一致性

评分管线：

```text
HardGate
-> root shared/T1 cheap features
-> score upper + family representative
-> T2 survivors
-> T3 root/critical finalists
-> raw feature cache
-> profile integer dot/LUT
```

-普通point不收紧terminal bound；
-feature zero weight不计算，但不能删除Proof action；
-TableEvaluator与GeneratedEvaluator共享registry/raw vector，DD8仅选择实现；
-terrain/trajectory/belief/opponent/profile各有独立dependency；
-profile/risk改变不重算物理几何；
-正式版删除feature名字/解释/log，保留整数id/table。

这落实了“每个动作分数容易调整，同时必须高性能”，没有把权重写死进物理函数。

## 5. Strategy 与 Risk 一致性

-StrategySelector每真实root一次，节点只读ProfileId；
-阶段按剩余改变终局能力，不按固定frame带；
-ForcedWin、committed Hard、ForcedLossRecovery高于普通strategy；
-baseRisk由root strategy选择，节点effective risk仍由DD6 stateRiskClass纯表；
-opponent risk preference改变nominal q/opponentFit，不在线修改我方risk table；
-FALLBACK只缩SearchProfile，不切成更冒险的隐藏profile。

因此“动态策略/动态风险”与“一局内不调整我方基础策略参数”同时成立：动态的是选择的profile/state class，固定的是表和weights。

## 6. OpponentModel 一致性

模型先确认机会，再评价选择：未观察到FIRE不能在fire机会只是POSSIBLE时记作保守。fast响应局中切换，slow保持长期基线，confidence决定混合。

对手风险向量包括attack、position contest、terminal trade、resource、information gamble、skill和retreat；开火概率是提交FIRE command的概率，成功发弹由Fast按每world active bullet/fire lock决定。技能使用概率与stun/teleport ChanceOutcome概率分开。

正式版无日志：开发event解释/SQLite/报告全部剥离，固定TypedArray模型仍正常更新。

## 7. 技能一致性

当前RuleCorpus的公开技能表被策略descriptor引用：shield25/4/2 hits、freeze29/2、stun20/6、overload32/10、cloak35/6、poison20/4、teleport40及locks、boost26/6。

-我方skill构建时专门化一个emitter；
-敌方skill在root公开分类，节点只处理实际id；
-未知stun/teleport概率进入DD6 interval/universal support；
-poison/freeze/boost empty repoll、teleport reveal等相关branch仍unsupported/incomplete；poison非空队列相对cadence已exact；
-skill score/Plan不能从action support或Proof覆盖中删除动作。

外部simulator旧常量没有通过descriptor重新进入生产。

## 8. Plan冲突关闭

原设计有两个容易冲突的“Plan”：

1. DD5 SourcePlan——已存在实体的物理trajectory/blast；
2. DD7 Shot/Bomb/SkillPlan——为什么继续某个意图。

现在owner完全分离。每个FIRE/BOMB先有小PlanSketch，只有finalist/实际动作建立PersistentPlan。实体创建后Plan绑定generation并引用SourcePlan；overload各member独立失效，group直到全部结束。

Bomb接近爆炸时的硬逃生来自PhysicalState/Hazard，不是Plan“升级为硬”。因此Plan丢失、淘汰、改分或失效都不会丢安全事实。`OI-ARCH-008`关闭。

## 9. 跨文档冲突审计

| 主题 | 潜在冲突 | DD7处置 | 当前权威 |
|---|---|---|---|
| evaluator point与Value bound | score被当true value | POINT_ONLY/verified horizon envelope分离 | Evaluation + DD6 Value |
| strategy与search | strategy直接发动作 | 只输出profile，动作仍经Minimax/Policy | Strategy contract |
|动态策略与固定我方参数 | 在线改weights | profile动态、table/weights整局固定 | Strategy/Evaluation |
|对手fire概率与物理开火 | P_fire当projectile事实 | command choice与execution分开 | Opponent + Fast |
|对手risk与我方risk | 对方激进让我们自动risk+N |只改nominal q/opponentFit | Opponent + Risk |
| skill descriptor与Fast | 八技能复制transition | descriptor生成引用handler | Skill + Fast |
| hidden threat与Hard | possible grass shot当必死 | soft feature/robust，不写committed | Evaluation + Hazard |
| Plan与SourcePlan |意图拥有物理实体 | generation引用、owner分离 | Plan + Hazard |
| BombPlan硬约束 | Plan失效导致不逃 | Hard来自committed bomb | Plan + Hazard |
|每action完整Plan成本 |大量FIRE造成对象/trajectory复制 | fixed PlanSketch + finalist persistent | Plan contract |

未发现要求回退DD1–DD6的冲突。`search-semantics.md`中的“Plan升级硬约束”旧表述已改为committed physical hazard。

## 10. 未关闭但不阻塞DD8

- feature weights、Strategy score/margin/dwell、opponent alpha/threshold、risk class具体表：R3，只用DD9 Discovery/Calibration校准，Frozen/Forward禁止调参；
-TableEvaluator vs GeneratedEvaluator、feature cache净收益：DD8 benchmark；
-own-skill bundle组合、descriptor bytes和死代码消除：DD8 build；
-Plan/cache capacity、replacement、cross-frame inventory：DD8；
-OpponentModel通用历史prior是否有净收益：DD9 A/B，默认可禁用；
-`OI-ARCH-014`等待production strip/离线schema在DD9验证后关闭；
-平台剩余RuleVariant继续使相关skill/action incomplete。

所有数值未决都有neutral/incomplete/benchmark行为，不会改变物理规则或strict结论。

## 11. DD8准入

DD8可以开始，因为：

1. 每类缓存候选现在有明确owner、semantic key、value和dependency；
2. Strategy/Eval/Opponent/Plan的版本已能进入ValueSearchKey而不污染DecisionHash；
3. normal/degraded/fallback可共享同一Fast/Hard/Proof，仅缩soft工作；
4. root pipeline已有可分批检查的函数/复合/全景成本点；
5. own-skill specialization与production strip边界明确；
6. Reference/replay/log/历史prior可从正式bundle剥离；
7. source/minified、cache-off/on、Table/Generated均有同语义oracle。

DD8必须先建立唯一Cache Inventory/key matrix，再冻结RuntimeController和fallback，最后冻结production build/manifest；不能先用1.5秒开关掩盖stale cache或不完整Hard。
