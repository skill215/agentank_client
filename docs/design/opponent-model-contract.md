# DD7 OpponentModel 与风险喜好合同

状态：DD7 规范合同，2026-07-16。冻结事件驱动 opportunity/choice、fast/slow估计、confidence、对手风险喜好、开火/技能/动作名义概率和当前局更新边界。

关联：`DEC-0016`、`DEC-0017`、`DEC-0019`、`DEC-0056`、`DEC-0057`；`OI-R3-002`；[risk-backup-contract.md](risk-backup-contract.md)、[observation-reconciliation-contract.md](observation-reconciliation-contract.md)、[legacy-evidence-contract.md](legacy-evidence-contract.md)。

## 1. 唯一用途

OpponentModel 输出名义分布和软特征：

```text
P(enemy ActionKey | enemyInformationClass, sharedFeatureClass)
opponentRiskPreference + confidence
styleShift flags
```

它只进入ExpectedValue、DD6 enemy ε-contamination的nominal部分、action ordering和Strategy opponentFit。它不进入：

- PhysicalState/RulesKernel；
- Possibility support或HiddenWorld删除；
- SubmissionLegality/ExecutionStatus；
- HardGate/Terminal/Proof/Coverage；
- enemy action support的合法性判定。

## 2. Opportunity 先于 Choice

所有倾向按“有效选择/确认机会”归一化，不能直接按事件次数：

```text
OpportunityEvent
  eventClass
  frame/phase
  enemyInformationClass
  contextClass
  eligibility = CONFIRMED | POSSIBLE | BLOCKED
  choiceRelation = CHOSEN | NOT_CHOSEN | AMBIGUOUS
  evidenceCapabilityMask
```

只有side-legal observation可建立事件。`CONFIRMED`机会进入分母；`POSSIBLE`只更新区间/confidence，不当作未选择；`BLOCKED`不评价偏好。

敌方不可见、command未公开或singular bullet关联歧义时保存relation，不用TruthTrack贪心猜choice。

## 3. 事件 families

```text
FIRE_WHEN_EFFECTIVE
BOMB_WHEN_EFFECTIVE
STAR_COLLECT / STAR_DENY / STAR_CONCEDE
ADVANCE / HOLD / RETREAT / CHASE
POSITION_CONTEST
TURN_NECESSARY / TURN_EXTRA
SKILL_WHEN_EFFECTIVE
RESOURCE_COMMIT_WHEN_EXPOSED
TERMINAL_TRADE_ACCEPT
GRASS_OR_CLOAK_AMBUSH
```

事件由canonical action/observation/geometry派生，不扫描日志文本。移动距离、转向次数、拿星、开火、bomb、skill等用户指定指标均通过这些family记录。

## 4. Fast/Slow 定点估计

每个`(eventClass,contextClass)`保存：

```text
fastEstimate       0..10000
slowEstimate       0..10000
opportunityMass    Uint32/安全整数
ambiguityMass
confidence         0..10000
lastUpdateFrame
```

对确认机会，target=CHOSEN?10000:0：

```text
estimate' = estimate
          + roundSigned(alpha * (target-estimate) / 10000)
```

fast/slow使用构建表中的不同alpha。AMBIGUOUS按可行choice上下界扩展，不用0或5000默认。confidence由有效opportunity mass、ambiguity、recency和fast/slow一致性LUT生成；具体alpha/阈值是R3参数，只由DD9 Discovery/Calibration选择，Frozen/Forward只读验证。

风格变化：

```text
abs(fastEstimate-slowEstimate) >= shiftThreshold
AND fastConfidence >= threshold
```

触发后只提高fast混合权和`opponentModelEpoch`，不清空slow先验、不修改我方weights。

## 5. 对手风险喜好函数

OpponentRiskPreference不是单一“开火率”，而是固定多维向量：

```text
attackCommitment
positionContest
terminalTradeAcceptance
resourceSpend
informationGamble
skillAggression
retreatPreference              // 反向维度
```

每维由相关 confirmed opportunity/choice propensity归一化到0–10000。总风险喜好：

```text
riskPreference = normalizeWeighted(
  dimensionPropensity - conservativeCounterDimensions)
```

输出`riskPreference 0..100`、每维值和confidence。权重/归一化表构建期固定；低confidence返回宽interval，不强行单值。

该函数回答“对方在有机会时通常愿不愿承担交换/暴露/资源风险”。它不修改我方baseRisk；它通过nominal enemy action分布让DD6 robust solver在保留worst contamination的同时利用对手习惯。

## 6. 开火概率

### 6.1 条件特征

```text
fire opportunity confirmed/possible
line/impact/escape class
distance/turn requirement
star/terminal urgency
enemy exposed/hidden belief class
own projectile slot/fire lock state as enemy can know
shield/skill context
recent fast/slow fire propensity
opponent risk preference/confidence
```

### 6.2 定点模型

```text
fireLogit = intercept
          + contextWeightLUT[feature classes]
          + propensityAdjustment
          + riskPreferenceAdjustment

rawFireWeight = expLUT(clamp(fireLogit))
```

与其他合法EnemyAction raw weight一起用最大余数法归一化到10000。模型不直接调用float sigmoid/exp；离线拟合后量化LUT并验证最大误差。

`P_fire`表示敌方提交FIRE command的名义概率，不等于成功创建projectile概率。FIRE在部分HiddenWorld因active bullet/lock无效时，command仍作为共同EnemyAction，物理成功/无效由FastKernel逐world决定。

## 7. 技能与其他动作概率

- enemy skill type进入场地后公开，模型只为该skill action family估计usage；
-机会必须同时满足公开cooldown/capability和side-legal target信息；
-stun/teleport的规则ChanceOutcome概率不由OpponentModel预测；
-skill action probability与其后chance support分开；
-BOMB/FIRE/GO/TURN/HOLD/skill各有context raw weight，最终同一enemy information set归一化；
-高基数teleport target可先family概率、再在合法target nominal分布内分配，Proof仍全覆盖support。

## 8. Information partition

概率查询签名：

```text
buildEnemyNominalPolicy(
  informationStateOffset,
  enemyInformationSetId,
  enemyActionSetOffset,
  opponentModelEpoch,
  outProbabilityOffset) -> status
```

同一enemy information set使用同一名义策略；不同set可按各自side-legal observation class不同。查询不得读取真实world label或我方私有信息。

## 9. 当前局与历史先验

一局内：

-只更新对手估计、confidence和epoch；
-我方Feature/Strategy/Risk基础表不在线训练；
-一次search冻结epoch，中途事件只供下一root；
-epoch只在数值发生可见变化/事件batch提交时增加，避免每frame无效cache失效。

历史244局可离线蒸馏通用整数prior，要求corpus/version/feature schema和train/calibration/frozen分离。正式包不得包含对手名字、match id、replay或命名特例；当前局证据必须能够覆盖prior。

## 10. 无日志正式版

开发/本地harness可输出OpportunityEvent、参数轨迹和prediction calibration。正式build：

-保留固定模型state和update函数；
-剥离字符串event名、日志、SQLite/回放adapter和统计报告；
-不依赖console/文件/网络；
-诊断开关关闭不能改变epoch、概率或action ordering。

## 11. Unknown 与 confidence

- opportunity POSSIBLE：不记作NOT_CHOSEN；
- choice ambiguous：更新上下界/ambiguity mass；
-样本少：blend slow/general prior并降低confidence；
-style shift未确认：fast/slow加权，不硬切；
-action support incomplete：OpponentModel不能补support，Value保持incomplete；
-概率无法归一化/容量不足：返回nominal interval/neutral prior标志，robust worst仍由DD6覆盖；
-任何模型失败不改变Hard/Proof。

## 12. 性能合同

- event family/context数量构建期固定，state为TypedArray SoA；
- root reconciliation后按新canonical events增量更新，O(new events + fixed opportunity checks)；
-不回扫match history；
-每个enemy information set/action set概率生成O(actionCount)，feature class用整数bit/LUT；
-fast/slow/confidence每参数O(1)；
-一次search冻结只读epoch，无原子/锁/clone；
-正式版不计算未启用event family；
-模型bytes、update/query P95进入DD8 manifest/benchmark。

## 13. 必须测试

- opportunity-normalized与raw event count差异；
- POSSIBLE/AMBIGUOUS不被当NOT_CHOSEN；
-fast响应风格切换、slow保持长期基线；
-risk preference多维归一化与confidence；
-fire command probability与成功射弹概率分离；
-same enemy info set同policy、different set可不同；
-probability总和10000、稳定remainder/source-minified一致；
-stun/teleport chance不混入opponent probability；
-epoch freeze/下一root提交；
-历史prior/日志剥离不改变正式结果；
-模型任意输出不改变Hard/Proof/possibility。

## 14. 冻结结论

对手风险喜好已经成为可计算的多维opportunity/choice函数，开火/技能/移动概率由fast/slow、context和confidence生成。模型随局中事件动态变化，但只改变nominal分布；我方策略参数不在线漂移，最坏风险仍由DD6 robust backup负责。
