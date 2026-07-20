# DD7 Evaluation 与可调评分合同

状态：DD7 规范合同，2026-07-16。冻结软特征注册表、整数范围、成本层、依赖、缓存、表驱动/生成式 A/B 和 point/envelope 边界；具体权重只由Discovery/Calibration选择，DD9 Frozen/Forward只验证。

关联：`DEC-0010`、`DEC-0016`、`DEC-0024`、`DEC-0052`、`DEC-0056`；`OI-R3-006`；[value-search-contract.md](value-search-contract.md)、[cache-contracts.md](cache-contracts.md)。

## 1. Evaluation 能做什么

Evaluator 只输出：

```text
rawFeatureVector
orderingScore
horizonPointEstimate
optional verified horizon envelope
featureCompleteness/cost
```

它可以影响 Value、Risk 的 nominal部分、动作排序、受限矩阵初始集、Strategy和Plan。它不能：

- 写 PhysicalState、Possibility support 或 opponent facts；
- 产生/覆盖 HardGateStatus、TerminalOutcome、ProofStatus；
- 把敌方“可能开火”改成 committed projectile；
- 用历史 match id/对手名字选择规则；
- 用一个高分跳过 DD5 action HardGate；
- 把普通 point estimate 写成 terminal-game lower/upper。

## 2. FeatureRegistry ABI

V1 最多64个生产特征；超出必须升级 mask ABI，不能静默复用bit：

```text
FeatureDescriptor
  featureId                      Uint8
  familyId                       Uint8
  valueMin/valueMax              Int16/Int32
  defaultScale                   Uint16
  costTier                       Uint8
  stateDependencyMaskLo/Hi       Uint32
  actionDependencyMaskLo/Hi      Uint32
  externalDependencyMask         Uint32
  cachePolicyCode                Uint8
  computeHandlerCode             Uint8
  envelopeEligibilityCode        Uint8
  unknownBehaviorCode            Uint8
  featureVersion                 Uint16/Uint32
```

每个feature必须声明单位、perspective、符号方向、范围、最坏循环、读取owner、是否可按ActionKey缓存和unknown行为。缺descriptor或实测越界使Evaluator incomplete；禁止clamp后假装正确。

## 3. 规范 feature families

V1 family固定，具体feature id由生成表分配：

| Family | 代表输入/含义 | 主要依赖 |
|---|---|---|
| TERMINAL_PROGRESS | 星差、runtime不利、最后有效行动、逆转/锁定能力 | terminal/objective |
| STAR_CONTROL | 我/敌ETA、collect/deny/concede、respawn soft model | topology/star/belief |
| SURVIVABILITY | committed slack、可逆性、安全后继数量、shield/resource | hazard/capability |
| COMBAT_PRESSURE | direct hit窗口、firing lane、enemy escape options、trade value | trajectory/worlds |
| POSITION_CONTROL | mobility、future action options、choke、cover、中心不是固定目标 | topology/terrain |
| INFORMATION | visibility recovery、belief entropy proxy、sweep coverage、concealment | possibility/observation |
| RESOURCE | bullet slot、bomb/skill cooldown、shield charge、future opportunity cost | entity/skill/deadline |
| PLAN | plan progress、continuity、switch/cancel cost、purpose fulfillment | plan/dependencies |
| OPPONENT_EXPECTED | opponent action/skill propensity下的nominal收益 | model epoch |
| COMPUTE_COST | action family展开、world/trajectory/matrix预计成本 | search profile/capacity |

Hard facts可以作为feature输入，但feature输出不能反向成为fact。例如`committedSlack`来自DeadlineKernel；Evaluator只奖励更大slack，不决定“是否必死”。

## 4. 草、cloak 与不可见威胁

隐藏风险使用三类软特征，全部基于 InformationState support：

```text
PossibleShotExposure
  某cell/time在多少possible enemy pose/action下形成射线；risk=0可由robust backup取worst。

BeliefSweepCoverage
  FIRE/BOMB覆盖的possible tank/path/grass mass、denial和可观察反馈。

InformationControl
  重获视野、缩小observation relation、远离高密度隐身位置、阻断possible route。
```

不得因“往草里开枪没有看到命中”删除world，除非冻结观察规则保证该结果必然可见。射草、路径预射和放bomb都必须有Shot/Bomb Plan purpose，并计算我方暴露、资源占用和反击风险。

## 5. 成本层与惰性计算

```text
T0 ROOT_SHARED       O(1)或一次cell bitset；所有action共享
T1 CHEAP_ACTION      O(1)或固定少量query；用于全动作初排
T2 CONDITIONAL       trajectory/path/world aggregate；只算仍可能入选action
T3 FINALIST          matrix/plan/expensive belief；只算root/关键finalists
```

执行顺序：

1. action先通过Submission/Hard；
2. 计算root shared feature blocks；
3. 对全部允许action计算T1；
4. 用尚未计算feature的最大贡献生成score upper，不可能入选者停止；
5. 每个战术family至少保留一个代表；
6. 只对survivors计算T2；
7. T3只为restricted matrix、Proof frontier或最终Plan finalists；
8. raw features写缓存，权重变化只重做dot product。

soft pruning只影响初始受限集；Double Oracle/Proof完整scan仍可重新加入动作。

## 6. 数值与打分

每个raw feature先规范化到descriptor范围，常用尺度`[-10000,+10000]`。权重使用有符号整数，accumulator保持JavaScript安全整数：

```text
scoreAcc = bias * SCORE_SCALE
         + sum(weight[featureId] * rawFeature[featureId])

orderingScore = roundOutwardOrNearest(scoreAcc / profileDivisor)
horizonPoint  = sigmoidLUT(clamp(orderingScore))
```

- 评分语义不使用float；离线训练可用float，发布时量化并验证误差；
- `profileDivisor`、LUT和所有weights进入EvalProfileVersion；
- accumulator worst case由build manifest证明小于`Number.MAX_SAFE_INTEGER`；
- saturation只允许最终显示/ABI clamp，内部overflow必须构建失败；
- probability/risk weight与feature weight不是同一个数组。

## 7. EvalProfile

```text
EvalProfile
  profileId/version
  primaryStrategyId
  modifierMask
  bias
  featureWeight[64]
  activeFeatureMaskLo/Hi
  costBudgetByTier
  sigmoidTableId
  envelopeTableId
```

一局内我方profile表/weights固定。StrategySelector只选择已有profile id，不在线更新weights。hypothetical state可切换到构建时列出的endgame/forced modifier profile，但切换规则是纯整数表并进入ValueSearchKey。

## 8. TableEvaluator 与 GeneratedEvaluator

按用户确认保留两套实现候选，语义由同一registry生成：

### TableEvaluator

- 遍历active bitset，handler表计算feature，weight数组点积；
- 调权重只换数据，诊断容易；
-分派/loop成本可能较高。

### GeneratedEvaluator

- 构建期删除零权重feature、内联固定handler/weight、合并shared query；
-按我方skill/strategy profile专门化；
-源码更大，必须过bundle门。

两者必须对同一raw feature和profile得到相同整数score/envelope。DD8以source/minified、函数/复合/全景benchmark选择；不能各自维护feature语义。

## 9. FeatureCache 边界

缓存未加权raw feature，不默认缓存最终score：

```text
key = Physics/Information signature
    + ActionKey
    + featureId/version
    + dependency versions
    + opponentModelEpoch only when declared
```

DependencyMask示例：terrain、topology、star/objective、entity set、hazard timeline、belief、observation、opponent epoch、plan generation、skill table。只失效dirty feature；profile/risk改变但物理不变时重做dot product。

Cache miss重算；collision核验compact signature；cache full不返回0。最终inventory、容量、替换由DD8。

## 10. Envelope 资格

```text
POINT_ONLY
HORIZON_ENVELOPE_VERIFIED
TERMINAL_ENVELOPE_FORBIDDEN
```

大多数feature是POINT_ONLY。只有有独立Reference exhaustive oracle、覆盖指定horizon且外扩误差已证明的组合，才可提供`HORIZON_ENVELOPE_VERIFIED`。普通feature永远不能提供terminal envelope；Terminal/Proof/Hard有自己的证书。

## 11. Unknown/incomplete

- feature输入unknown：按descriptor返回interval/skip+completeness，不默认0；
- soft feature skip可以继续，但point标`FEATURE_INCOMPLETE`；
- envelope依赖unknown则撤销envelope资格；
- opponent feature confidence低使用interval/blended prior，不当confirmed choice；
- T3预算不足保留T1/T2 point和wide Value interval；
-任何缺口不改变Hard/Proof。

## 12. 性能合同

- feature scratch为固定Int16/Int32 SoA或per-action slab；
- root shared query每callback最多一次；
- feature handler不分配对象、不读字符串、不扫描history/log；
- T1单action O(1)；T2按实际trajectory/world aggregate，必须共享已有SourcePlan/Path；
-权重点积只遍历active mask，最多64；Generated候选只执行非零项；
-时钟不在Evaluator读取；SearchController传cost budget/stop flag；
-production删除feature名称、解释文本和诊断计数，只保留整数表。

## 13. 必须测试

- 每feature边界/符号/perspective swap；
- raw范围与accumulator安全；
- Table/Generated raw vector、score、source/minified一致；
- profile只重做dot，不重算物理feature；
- dependency dirty只失效相关feature；
-草/cloak sweep不删除possibility或产生Proof；
- ordinary point不收紧terminal interval；
- T1/T2/T3中断保持合法Value interval；
- cache-off/on相同score/action ordering；
- zero-weight feature不计算且不影响Hard/Physics。

## 14. 冻结结论

评分已经拆成稳定raw feature与可替换整数profile。所有动作先过Hard，再按成本层惰性取feature；调分只改weights/点积，物理和昂贵几何可复用。表驱动与生成式可以实际A/B，但不会形成两套语义。
