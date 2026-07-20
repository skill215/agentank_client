# DD7 StrategySelector 合同

状态：DD7 规范合同，2026-07-16。冻结主策略、modifier、强制覆盖、阶段判定、整数选择分、hysteresis、Risk/Eval/Search profile输出和动态切换边界。

关联：`DEC-0004`、`DEC-0008`、`DEC-0016`、`DEC-0056`；[evaluation-contract.md](evaluation-contract.md)、[risk-backup-contract.md](risk-backup-contract.md)、[terminal-proof-algebra.md](terminal-proof-algebra.md)。

## 1. 输出而不是动作

StrategySelector 每个真实root运行一次，输出冻结profile bundle：

```text
primaryStrategyId
modifierMask
EvalProfileId
RiskProfileId/baseRisk
SearchProfileHintId
strategyGeneration
reasonFlags
minimumDwellUntilFrame
```

它不直接返回ActionKey，不跳过Minimax，不写Hard/Proof/Physics。搜索节点只读取profile id和纯`stateRiskClass`/endgame modifier表；不能在每个node重新运行完整selector。

## 2. 全局强制层

按优先级：

```text
FORCED_WIN_MODE
  assumption-free ForcedWin proven -> deterministic winning action/policy

HARD_SURVIVAL_MODE
  committed hazard/唯一Hard-allow action -> 必须规避，普通strategy暂停

FORCED_LOSS_RECOVERY
  全动作proven/policy reject -> 延迟/改善terminal，不伪装安全

NORMAL_STRATEGY
  只有此层比较primary strategies
```

强制层可立即打断dwell/hysteresis，但必须记录原策略供危险解除后重新评估；不能把上一帧策略直接恢复而跳过root selector。

## 3. Primary strategies

```text
STAR_CONTROL
KILL_PRESSURE
POSITION_CONTROL
PRESERVE_LEAD
COMEBACK
```

| Strategy | 进入含义 | 禁止简化 |
|---|---|---|
| STAR_CONTROL | COLLECT/DENY/CONCEDE中对最终胜率贡献最大 | 只取星最短路 |
| KILL_PRESSURE | 有purpose的击杀、逼位、资源交换能提高robust value | 见敌就FIRE |
| POSITION_CONTROL | 提高安全future action options、射线和地图控制 | 固定占中心 |
| PRESERVE_LEAD | 领先可在剩余机会内锁定或保持 | 早期微弱领先就龟缩 |
| COMEBACK | 只剩有限可逆转窗口，需要高expected权重 | 同星/第1帧自动激进 |

## 4. Modifiers

modifier可叠加，但不另建search算法：

```text
EVADE_COMMITTED
INFORMATION_CONTROL
SKILL_WINDOW
TERMINAL_URGENCY
RESOURCE_RECOVERY
PLAN_CONTINUITY
```

`EVADE_COMMITTED`来自DD5 fact，不受strategy score压制；其余只改变Eval/Risk/Search profile和ordering。

## 5. 阶段不是固定帧段

selector先计算`OutcomeChangeCapacity`：

```text
remaining own/enemy action opportunities
star collect/deny ETA与可能respawn
可形成terminal kill/trade的窗口
技能ready/active窗口
committed deadlines与reversibility
frame-limit star/runtime relation
```

阶段分类：

```text
OPEN      多条可逆路线
SHAPING   位置/资源会显著影响后续
DECISIVE  少数动作可改变终局
LOCKED    一方可保持/逆转能力接近零
```

`platformFrame`只是输入之一，不能用固定`0–40/41–90/...`替代上述能力判断。

## 6. 策略整数评分

每个候选strategy保存：

```text
strategyScore =
  phaseFit
  + objectiveUrgency
  + mapFit
  + opponentFit
  + ownSkillFit + enemySkillCounterFit
  + predictedRobustGain
  + informationFit
  - resourceCost
  - computeCost
  - switchCost
```

所有项来自固定root features，范围/scale在StrategyTable声明。`predictedRobustGain`使用cheap DD6 bound/上帧stable result，不运行第二次完整search。unknown term返回interval；候选只有在其lower超过当前策略upper+switch margin时才能强制切换，否则保持/补算。

## 7. Hysteresis 与动态切换

Persistent StrategyState：

```text
currentPrimary/modifiers
selectedAtFrame
minimumDwellUntilFrame
lastScoreLower/Upper[5]
lastSwitchReason
strategyGeneration
```

普通切换要求：

```text
challengerLower >= currentUpper + switchMargin[current][challenger]
AND frame >= minimumDwellUntilFrame
```

例外：ForcedWin、committed Hard、terminal relation突变、真实skill/event/observation使当前profile capability无效。对手模型仅因一个choice变化不直接切换；必须经过confidence/score interval。

动态变化是root-to-root的profile选择，不是一局内在线改weights。我方StrategyTable/Eval weights/Risk tables整局固定；局中只更新state、对手参数和选择的profile id。

## 8. RiskProfile 选择

`baseRisk`由primary + root阶段/领先/可逆性表产生，范围0–100。节点内由DD6 `stateRiskClass`查三维lambda；selector不直接写lambda。

原则：

- PRESERVE_LEAD/LOCKED通常选择更低baseRisk；
- COMEBACK/DECISIVE可更高，但risk=100仍保留污染；
- opponent confidence低不能提高我方risk，只会使nominal分布更宽/权重有效下降；
-对手风险喜好影响`opponentFit`和nominal q，不修改我方固定risk table；
-强制Hard/Proof完全不读baseRisk。

具体baseRisk值由DD9 Discovery/Calibration选择，再由Frozen/Forward只读验证，不在合同猜定。

## 9. SearchProfile hint

selector只能表达工作优先级：

- STAR_CONTROL：objective/terminal deadline nodes优先；
- KILL_PRESSURE：ImmediateProof/trajectory/escape matrix优先；
- POSITION_CONTROL：更广pure action scan；
- PRESERVE_LEAD：Proof Nonloss/robust lower优先；
- COMEBACK：逆转action family/expected differentiation优先。

实际node/depth/time额度由DD8 RuntimeController。selector不得因computeCost高而删除唯一Hard-safe/ForcedWin action，也不得改变已声明bound语义。

## 10. Skill/opponent/map接口

- own/enemy skill从整数descriptor读取capability/窗口，不读取字符串；
- opponent model提供propensity/confidence interval，不提供物理合法性；
-地图只用Topology/MapClass/feature blocks，不按map名写特例；
-历史先验最多进入通用opponent prior或离线校准，不按match/opponent选择strategy；
-未知skill rule使相关strategy term incomplete，不默认某技能强/弱。

## 11. 性能合同

- root每callback计算一次，候选primary固定5个；
- root feature vector共享，不为每strategy重复path/trajectory；
-score为固定长度整数dot/lookup，O(strategyCount * activeTerms)；
-Persistent state为TypedArray/固定scalar，无对象history；
-节点只读profile ids，不调用selector；
-正式版保留reasonFlags整数，不保留字符串/log；
-strategy generation只在实际bundle变化时增加，避免无谓ValueCache失效。

## 12. Unknown/fallback

- score interval重叠：保持当前strategy，避免抖动；
-当前strategy capability失效：在合法候选中选最大保守lower；
-selector capacity/internal failure：使用构建期neutral profile + DD5 Hard + DD6 pure bounds；
-FALLBACK不重新选择更冒险strategy，只缩SearchProfile；
-EMERGENCY仍使用Hard-safe emergency action，strategy仅作tie-break。

## 13. 必须测试

- primary五类进入/禁止简化cases；
-阶段按OutcomeChangeCapacity而非固定frame；
-hysteresis/dwell防止相邻帧抖动；
-ForcedWin/Hard立即覆盖并在解除后重新评估；
-对手单事件不越confidence切换；
-局中weights/table不变，只有profile/model epoch变化；
-baseRisk/stateRiskClass职责分离；
-unknown term interval不默认0；
-source/minified、cache-off/on、重复root selector一致；
-selector故障不绕过Hard/Terminal。

## 14. 冻结结论

策略会随阶段、对手、技能和真实事件动态切换，但切换发生在root profile层并有margin/dwell；搜索节点仍运行同一Fast/Proof/Value/Risk语义。策略是软目标选择，不是新的规则或动作捷径。
