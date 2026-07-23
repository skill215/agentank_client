# 搜索与决策语义

DD7 同步状态：Strategy/Evaluation/Opponent/Skill/Plan分别由 [strategy-selector-contract.md](strategy-selector-contract.md)、[evaluation-contract.md](evaluation-contract.md)、[opponent-model-contract.md](opponent-model-contract.md)、[skill-state-machine-contract.md](skill-state-machine-contract.md)、[plan-contract.md](plan-contract.md) 冻结；Terminal/Hard由DD1/DD5规范化，Value/Matrix/Proof/Risk由DD6四合同冻结。Result/Policy/整数编码由 [action-result-abi.md](action-result-abi.md) 统一，物理布局由 [dd3-frozen-abi.md](dd3-frozen-abi.md) 冻结。

## 1. 决策目标

搜索最终优化我方获胜效用。真实决策节点使用 InformationState；PhysicalState 只表示其中一个完整物理世界或 singleton fast path：

    WinUtility = 2 * EstimatedWinProbability - 10000

范围：

- -10000：确定失败。
- 0：约 50% 获胜概率。
- +10000：确定胜利。

终局结果直接取边界值。非终局状态通过整数特征点积和 sigmoid 查表映射为预计胜率。

## 2. 动作搜索结果

每个我方动作保存：

- HardGateStatus
- ProofStatus
- WorstValue
- ExpectedValue
- RobustValue
- LowerValue / UpperValue
- BoundKind

### 2.1 HardGateStatus

- HARD_ALLOW
- HARD_REJECT_PROVEN
- HARD_REJECT_POLICY
- HARD_INCOMPLETE

`HARD_REJECT_PROVEN` 只由已提交危险、严格确认并由当前 RULESET_VERSION 冻结的规则和不可逆终局失败决定。`HARD_REJECT_POLICY` 是显式保守 TerminalPolicy，不具 Proof 资格；`HARD_INCOMPLETE` 表示规则或容量不足。敌方尚未提交的可能开火不能直接升级为硬拒绝；外部模拟器候选规则也不能生成严格拒绝。

历史 replay 中某动作随后死亡，只能提供该动作的一条 `ACTION_REFUTED` witness。除非 ReferenceKernel 在冻结规则下完成所有动作、敌方回应、HiddenWorld、chance 和终局量词覆盖，否则不得从历史结果直接生成 `HARD_REJECT_PROVEN` 或 `FORCED_LOSS_PROVEN`。

### 2.2 ProofStatus

- FORCED_WIN_PROVEN
- FORCED_NONLOSS_PROVEN
- FORCED_LOSS_PROVEN
- ACTION_REFUTED
- UNKNOWN

UNKNOWN 包括深度、时间、容量、隐藏信息、未解决 RuleVariant 或规则不完整。UNKNOWN 不能解释为没有胜利路线。

### 2.3 Worst/Expected

- WorstValue：所有仍可能 HiddenWorld、敌方回应和 chance support 的最坏结果。
- ExpectedValue：按 belief、对手模型和 chance 概率加权的期望结果。

### 2.4 BoundKind

- EXACT_COMPLETE
- LOWER_COMPLETE
- UPPER_COMPLETE
- INTERVAL_COMPLETE
- APPROXIMATE_WITH_GAP
- HEURISTIC_ONLY
- INCOMPLETE

深层 pure Minimax 在同时行动节点默认只产生 lower/upper。只有 pureLower 与 pureUpper 相等、或受限矩阵求解达到严格完成条件时，才能产生 EXACT_COMPLETE。

EXACT_COMPLETE 表示在指定 horizon、规则假设和 evaluator 合同下求解完整，不等于终局 ForcedWin 证明；只有 ProofStatus 能表达强制胜负。

选择顺序：

1. 已证明 ForcedWin。
2. 排除 `HARD_REJECT_PROVEN` 与 `HARD_REJECT_POLICY`；`HARD_INCOMPLETE` 进入显式保守 fallback，不参加普通软比较。
3. 对剩余动作执行风险融合。
4. 全部动作均被硬拒绝时进入 ForcedLossRecovery；它可比较失败时序，但不得把候选改标为安全。

## 3. 终局、死亡和失败

统一 TerminalResolver 必须先于倒推判断：

    resolveTerminal(state) -> TerminalResolutionStatus + TerminalOutcome

严格区分：

- PhysicalDeathChain：我方坦克会被击毁。
- TerminalLossChain：状态最终判我方失败。

物理击毁可能属于有利互换，因此不能直接硬过滤。只有从 `RESOLVED + LOSS` 终局倒推得到的失败链可以生成 `HARD_REJECT_PROVEN`。

## 4. OutcomeRetrograde

胜负倒推共享状态转换和缓存：

- PROVEN_WIN
- PROVEN_NONLOSS
- UNKNOWN
- PROVEN_LOSS

强制胜利在 InformationState 上定义：

    存在一个当前 information set 内共同的我方动作，
    对所有与敌方 information partition 一致的响应策略 beta、
    所有 PossibilityMask 中仍可能 PhysicalState、
    所有非空 chance support，
    先按我方真实 observation signature 合并后继，
    每个后继 InformationState 均为 WIN 或 PROVEN_WIN。

搜索优先寻找胜利反证最少的动作。任一敌方回应推翻证明时立即放弃该动作。

一个回应只能把当前动作标记为 ACTION_REFUTED。只有所有我方共同可提交命令都被反驳，才能证明当前 InformationState 在给定目标和 horizon 下不存在强制胜利。

失败倒推只能从 TerminalResolver 的 LOSS 开始。未证明胜利不等于已证明失败。

离线历史窗口使用四个不同边界：

- `failureOriginFrame`：最早可识别的失败链起点；
- `lastAvoidableDecisionFrame`：最后仍存在候选非输动作的决策帧；
- `pointOfNoReturnFrame`：从这里开始已经证明或在当前模型下无法避免失败；
- `terminalFrame`：实际死亡、timeout 或终局判负帧。

倒数 4 帧只是 projectile 事故的默认观察窗口。bomb、终局、星差和 runtime 失败必须按 deadline 向前扩展。历史窗口、双轨重建和双向反事实的完整合同见 [legacy-evidence-contract.md](legacy-evidence-contract.md)。

## 5. HardViable、RobustViable 与风险

- HardViableSet：只考虑已提交并确定的危险，属于绝对动作门。
- RobustViableSet：考虑所有敌方合法回应和可能状态，供 risk=0 与证明使用。
- ExpectedRisk：使用对手、belief 和 chance 概率，供风险策略使用。

动作分类：

- HARD_REJECT_PROVEN
- RISKY
- ROBUST_SAFE

敌方尚未开火但可能反击属于 RISKY；敌方子弹已经存在且形成不可逆不利终局才属于硬失败。

## 6. EnemyAction、HiddenWorld、ChanceOutcome

三种不确定性必须保留独立量词：

- EnemyAction：战略对手选择；单敌方 information set 时是 ActionRef/ActionKey，多个敌方 information set 共存时是映射 `beta: enemyInformationSetId -> ActionKey`，进入 min、敌方 mixed strategy 或 best response；
- HiddenWorld：当前 InformationState 中我方不可区分的可能 PhysicalState，Proof 全覆盖，Expected 使用 belief；
- ChanceOutcome：联合动作后的随机规则结果，Proof 覆盖非空 support，Expected 使用条件概率。

内部可以使用 packed joint outcome code 加速 `applyJointPhysical`，但 EnemyAction、HiddenWorld、ChanceOutcome 不能共享概率数组、覆盖标志或缓存版本。

不展开无关完整笛卡尔积。HiddenWorld 先按是否会改变合法动作、物理结果或观察结果做等价分组；chance 只在具体 `(PhysicalState, ourAction, enemyAction)` 下枚举。

例如 teleport 目标只需区分：

- 目标被隐藏敌人/敌弹占据；
- 目标未被占据。

Physical successor 必须按我方实际 `observationSignature` 合并成后继 InformationState。产生相同观察的隐藏世界不能在下一层分别选择我方动作。

敌方 possible worlds 同样按其实际观察构成 `enemyInformationPartition`。不同敌方 information set 可以选择不同动作；同一敌方 information set 必须复用同一动作。Proof 对所有一致 `beta` 做 AND，使用前缀 DFS、反例短路和缓存，不能 materialize 全部策略笛卡尔积。

### 6.1 规则不确定性不是第四种量词

外部模拟器与平台在 phase、技能概率或 projectile 几何上的分歧使用开发期 `RuleVariantMask`，不加入 EnemyAction、HiddenWorld、ChanceOutcome：

- EnemyAction 表示对手能选择的命令；
- HiddenWorld 表示同一已知规则下我方无法观察的事实；
- ChanceOutcome 表示已知规则声明的随机结果；
- RuleVariant 表示我们尚未确定平台究竟使用哪条规则。

Reference harness 可对每个 variant 独立求值形成跨规则区间。正式 Minimax 只运行构建时冻结的单一 RULESET_VERSION；若严格结论仍依赖未确认 variant，Proof=UNKNOWN，不能把某个外部模拟器实现当成 nominal chance。

例如：DD4 已确认 overload 第二颗 projectile 的生成几何，因此几何不是 RuleVariant；当第二弹因观察接口不可见时，其位置才属于 HiddenWorld。teleport 合法相邻落点是 ChanceOutcome，但“是否均匀”在确认前是概率规则不确定性。

## 7. 风险公式

风险范围0–100。RiskProfile为 `ChanceOutcome -> HiddenWorld -> EnemyAction` 三个独立维度提供0–9900 expected weight，并按确定性 `stateRiskClass` 查表动态变化。risk=0三维取worst；risk=100每维最多相信99% nominal，仍保留污染。

单维算子统一为：

    rho(X) = lambda * NominalExpected(X)
             + (10000-lambda) * Worst(X)

按10000定点外扩取整。先对每个world内的conditional chance递归rho，再对完整HiddenWorld support递归rho，最后通过等价risk-transformed matrix处理EnemyAction。observation先分区，避免hidden world分别选择后续动作。

RiskProfile/`stateRiskClass`/table version/OpponentModelEpoch进入ValueSearchKey，不进入DecisionHash/Proof。根只在baseline `robustLower` 的零损失safe floor内用expected做tie-break，不再次对robustValue混合；对手risk偏好只改变nominal action distribution，不修改我方RiskProfile。

## 8. 同时行动阶段矩阵与受限求解

对 `HARD_ALLOW` 我方动作 `a` 与敌方动作 `b` 先建立chance/hidden递归风险矩阵：

    C[a,b] = HiddenRho(ChanceRho(successors))

再按第 7 节构造：

    M[a,b] = RiskMatrix(C, P_enemy, enemyLambda)

每个 cell 内部分别处理 HiddenWorld、conditional ChanceOutcome 和后继 ObservationPartition。

### 8.1 pure 快速上下界

每个 cell 同时保存 `MLower/MUpper`。深层首先计算：

    pureLower = max_a min_b MLower[a,b]
    pureUpper = min_b max_a MUpper[a,b]

- pureLower == pureUpper，且所有仍可能改变相关 row minimum 或 column maximum 的 cell 都有同 horizon、无启发式剪枝的 cutoff-eligible 完整界：返回 EXACT_COMPLETE，并保存 compact dependency certificate；
- 数值相等但任一依赖 cell 为 HEURISTIC_ONLY/INCOMPLETE：保留原较弱 BoundKind，不能升级；
- pureLower < pureUpper：真实混合博弈值位于区间内，pure 结果不能作为最终精确值；
- 时间不足时可传播区间，不能把 pureLower 或 pureUpper 写成 exact TT value。

### 8.2 关键节点受限矩阵

根节点和战术关键深层节点在 pure 界不相等时运行受限矩阵求解。关键条件至少包括：

- 候选根动作排序可能因 mixed value 改变；
- 立即 FIRE/BOMB/SKILL/终局回应形成非纯鞍点；
- pure gap 超过 profile threshold；
- 当前节点位于 PV 或 Proof 邻近 closure。

初始受限动作来自 PV/TT、上下界最优动作、Active Plan 和每个硬安全战术类别的代表。之后由双方对当前 mixed strategy 的 best response 加入动作，不能以固定纯评分 top 2–4 作为最终支持集。

整数 regret solver 输出双方平均策略，并使用 lower/upper matrix 分别计算安全界：

    stageLower = min_b value(MLower, ourAverageStrategy, b)
    stageUpper = max_a value(MUpper, a, enemyAverageStrategy)
    exploitabilityGap = stageUpper - stageLower

矩阵期望、风险混合和策略量化都必须做外扩区间运算：lower 向负无穷取整，upper 向正无穷取整，策略归一化残差进入两端。固定迭代次数只是一项预算，不代表求解完成。全部 best-response scan 完成且外扩后的 `stageLower == stageUpper` 才能标记 EXACT_COMPLETE；gap 在 tolerance 内标记 APPROXIMATE_WITH_GAP；其他中断返回显式区间。

上述普通阶段矩阵只在 singleton fast path，或双方在下一公共观察前各自只有一个 information set 时直接适用。隐藏信息产生多个后续 information set 时，行列代表受限 information-set policy，并由 `solveRestrictedInfoGame` 保持同一 information set 内动作一致性；不能把各 HiddenWorld 的局部最佳动作直接放进普通矩阵。

根节点负责从最终我方平均策略抽样。ForcedWin、唯一安全动作和强制规避不随机；RNG 只用于最终根动作抽样，不进入物理规则、belief 或搜索节点。

## 9. 同时行动的惰性矩阵

- 双方动作列表只生成一次。
- 按我方动作逐行搜索。
- 敌方最可能推翻证明或造成最坏结果的回应优先。
- 某行上界不可能超过当前最佳下界时停止该行。
- ProofSearch 不使用概率剪枝。
- 当前受限矩阵只按需补全仍保留的矩阵格；best-response scan 可将未选动作重新加入。

ValueSearch 对 chance partial expansion 的界。若 expectedPartial 保存未除以 10000 的 weighted sum：

    expectedLower =
      (expectedPartial + remainingProbability * MIN_VALUE) / 10000

    expectedUpper =
      (expectedPartial + remainingProbability * MAX_VALUE) / 10000

如果 expectedPartial 已归一化，则必须使用对应的同尺度公式，禁止混用。再与当前 worst、三维 risk weights 及阶段矩阵 pure/mixed bounds 合成 rowLower/rowUpper。

## 10. Proof 与 Value 共享

ValueSearch 节点记录：

- allRepliesCovered
- allChanceCovered
- allPossibleWorldsCovered
- allObservationPartitionsCovered
- allOurActionFamiliesCovered
- usedHeuristicPruning
- proofOutcome

只有 InformationState 上全部量词完整覆盖且没有概率/启发式剪枝时，ValueSearch 才能写入严格 ProofCache。接近强制胜利但仍 UNKNOWN 的动作由专用 AND/OR ProofSearch 或 DFPN frontier 补全。

软价值可以使用证明结果；软搜索结果不能冒充证明。

## 11. 动作生成和排序

普通动作使用 action code 数组。teleport 等高基数动作使用 ActionFamily bitset。

我方固定技能 action family 由构建期专用 emitter 产生。敌方公开 skill type 在根回调转换成 `enemySkillId`，每节点只查询对应 descriptor；不得枚举八种技能身份，也不得把技能身份加入 belief。

我方顺序：

1. TT/PV 最佳动作。
2. ForcedWin 候选。
3. 唯一硬安全动作。
4. Active Plan 安全继续。
5. 立即击毁、拿星、阻止终局失败。
6. 廉价策略排序。

敌方顺序：

1. 推翻证明或造成硬失败的回应。
2. 高威胁 FIRE/BOMB/SKILL。
3. 阻止拿星/逃生。
4. 对手模型高概率动作。

小动作列表使用固定数组插入排序或构建期确认的更快实现。

廉价候选缩减使用特征上界与战术类别保留。ProofSearch 不依赖软 top-K。ValueSearch 的软 top-K 只能建立初始受限矩阵，未选动作仍须能通过 Double Oracle best-response scan 重新进入。

软评分管线：

1. HardGateStatus 过滤。
2. 廉价基础特征。
3. 基于尚未计算特征最大贡献的评分上界。
4. 每个战术类别至少保留一个代表动作。
5. 对剩余候选计算 ActionETA、射线、belief 和对手回应等昂贵特征。
6. 只有最终 Minimax 候选建立完整 Plan。
7. 缓存未加权特征；策略/risk 改变只重做整数点积。

每个 EvalProfile 提供 FeatureDependencyMask。权重为零且不影响硬规则的特征不计算。

## 12. TacticalClosure

深度上限存在尚未解决的强制事件时，不直接评分。TacticalClosure 只展开：

- 必须规避；
- 立即命中/阻挡；
- 护盾/保命技能；
- 即将爆炸；
- 最后拿星；
- 直接改变终局。

已提交实体计算到完整生命周期。TacticalClosure 有独立节点上限；不完整时 Proof=UNKNOWN，Value 使用保守界。

## 13. DeadlineKernel

共享子弹、炸弹、终局、技能和拿星 deadline：

    slack = deadlineFrame - earliestArrival

输出 earliestArrival、latestSafeDeparture、slack、firstAction 和 proofStatus。

对枪能否躲闪由命中 deadline 与最早安全退出时间精确比较，不使用固定距离阈值。

### 13.1 Per-successor Escape Quality（Phase 0+）

在根级 `solve` 之后，可对任意 successor pose `(cell, direction)` 评估：

- `SUCCESSOR_PROOF`：`PROVEN_DEAD` / `UNKNOWN` / `PROVEN_VIABLE`
- `stillExposedAtDeadline`：committed 炸弹 footprint 或敌弹 hit-timeline（布尔，非 soft mass）
- `slack`：相对当前 deadline 的 per-pose slack
- `viableNextActionCount`：下一步 GO/TURN 落在 `viableTick2` 的分支数
- `coverageComplete`：`hazard.complete && narrowProofComplete`

这些字段供 Escape Quality 字典序使用，**不得**与已写入 Safety 的
`committedPressure` 分段值重复计分。批接口：`evaluateSuccessorActions`。

## 14. 迭代加深

- 保留最后完整深度。
- 启动下一层前根据上一层节点、剪枝和命中率估算成本。
- 预计无法完成时改做 Proof 补全、TacticalClosure、次优动作比较或当前关键阶段矩阵精化。
- 节点预算为主，固定节点批次检查真实时间。
- 深度计联合决策，frame 计真实时间。

## 15. Strategy 与 risk

根节点选择一个 primary strategy：

- STAR_CONTROL
- KILL_PRESSURE
- POSITION_CONTROL
- PRESERVE_LEAD
- COMEBACK

EVADE、信息控制和技能窗口是 modifier。ForcedWin 与 ForcedLossRecovery 是全局模式。

主策略合同：

- STAR_CONTROL：比较 COLLECT、DENY、CONCEDE，不只取最短拿星路径。
- KILL_PRESSURE：只允许有明确目的的攻击。
- POSITION_CONTROL：最大化安全的未来动作选择，不等同于固定占中心。
- PRESERVE_LEAD：只在领先可守住或可锁定时启用，早期领先不自动转被动。
- COMEBACK：在最后可影响结果的窗口提高逆转优先级；同星不从第 1 帧自动进入。

阶段按“剩余改变结果能力”判断，不按固定帧带。完整选择器采用可解释整数分：

    phase fit
    + urgency
    + map
    + opponent
    + skill
    + predicted win gain
    - switch cost
    - compute cost

真实帧之间使用切换 margin、最短驻留和 hysteresis；ForcedWin、确定危险和终局硬事件可立即覆盖。

完整 StrategySelector 每真实根运行一次；搜索节点只通过预生成 EvalProfile 做明确阶段切换。

baseRisk 每真实根完整计算一次并冻结RiskProfileId。节点内只允许根据hypothetical state的星差、最后行动窗口、可逆性和置信度查固定表得到effectiveRisk；RiskProfile/stateRiskClass/risk table version与SearchSemanticProfile必须进入ValueSearchKey。runtime mode只选择SearchBudgetProfile；若它切换Eval/horizon/basis，则由对应semantic id/depth显式区分，不能把预算mode本身当值语义。

我方 feature weights 和策略参数一局内固定，只允许离线调参。局中只更新敌方参数与 confidence。历史对手先验是可选冷启动信息，当前局证据必须能够覆盖它。

## 15.1 ShotPlan

任何 FIRE 候选必须绑定固定小型 ShotPlanSketch；只有 root finalist/实际选择才 materialize 跨帧 PersistentShotPlan。没有 purpose sketch 就不生成 FIRE，但不得为全部候选复制 trajectory/path。

Shot purpose：

- DIRECT_KILL
- INTERCEPT
- ZONE_DENIAL
- TERRAIN_BREAK
- BELIEF_SWEEP

ShotPlan 至少保存：

- target/target set；
- projectile arrival frame；
- estimated win/hit probability；
- blocked cells；
- bullet slot cost；
- counter-risk；
- escape deadline/route；
- confidence；
- purpose。

BELIEF_SWEEP 用于草、cloak 区域和可能路径：

    SweepValue =
      covered belief probability * hit utility
      + information gain
      + displacement/denial utility
      - exposure risk
      - resource cost

未确认敌方位置时，BELIEF_SWEEP 永远不能单独支持 ForcedWin。没有可观察反应只在结果必然可见时才能删除 Possibility 状态。

## 15.2 BombPlan

任何 BOMB 候选必须包含：

- placement cell；
- explosion frame；
- blast cells；
- physical escape routes；
- interference/deadline；
- kill/denial/terrain coverage；
- skill synergy；
- raw features 与 confidence。

没有物理自逃路线且 TerminalResolver/倒推证明为 LOSS 时才是 `HARD_REJECT_PROVEN`；若终局仍未知则是 `HARD_INCOMPLETE`。炸弹接近爆炸 deadline 时，硬约束来自已提交 bomb 的 PhysicalState/Hazard closure，不是软 Plan 自行升级；即使 Plan 被淘汰也不能丢失约束。

## 15.3 Plan 连贯性

- ShotPlan 通常是软承诺。
- BombPlan 在逃生 deadline 附近是硬承诺。
- 新 ForcedWin、确定威胁或真实观察不一致可以打断任何 Plan。
- Active Plan 每帧重新验证 entity generation、terrain version、deadline 和 HardGateStatus。
- Plan 是意图，不是跨帧命令队列。

## 16. OpponentModel

事件驱动更新：

- 拿星机会与选择；
- 有效开火机会与选择；
- 移动距离；
- 非必要转向；
- 技能有效窗口与使用；
- 追击、撤退和位置控制。

所有指标按“实际选择 / 有效机会”归一化。每个参数维护 fast/slow estimate 与 confidence，用于检测局中风格切换。

一次搜索内冻结模型。模型提供 EnemyAction 名义概率并进入 RiskMatrix，同时影响 ExpectedValue 和动作排序；它不影响 HardGateStatus、PossibilityMask 或证明规则。

历史对局可在离线阶段生成 `TraceOpponentProfile`，用于重放该场对手倾向、寻找最佳响应和校准通用先验。它不能作为命名对手特例进入正式包，也不能将实际历史回应视为全部合法回应。当前对局的事件证据必须能够覆盖任何离线通用先验。

## 17. Hidden belief

- PossibilityMask：所有物理可能状态，永不因低概率删除。
- ProbabilityBelief：top-K 精细状态 + residual mass。
- OpponentBeliefOfMe：敌方不可见我方时的轻量二阶可见性模型。
- EnemyCommandBelief：敌方可能的未执行队列摘要。

四者与公开物理事实共同形成 InformationState。InformationState 内我方共同动作必须应用到所有不可区分 HiddenWorld；只有联合转换产生不同且实际可观察的 observation signature 后，未来我方策略才能分叉。

没有观察到试探攻击结果时，只有规则保证结果必然可观察，才能从 PossibilityMask 删除状态；其他情况只调整概率。

隐藏影响的动作合法性：

- CONFIRMED_LEGAL
- POSSIBLY_ILLEGAL
- CONFIRMED_ILLEGAL

POSSIBLY_ILLEGAL 留在风险层，Proof 覆盖成功与失败。

隐藏信息控制是所有主策略的 modifier，奖励重获视野、封锁可能路径和信息增益，不创建独立 SEARCH 主策略。

当前 game.star 是精确事实；未来星星生成使用独立 StarSpawnModel。未被平台验证的未来生成只能进入 ExpectedValue，不能进入 ForcedWin 或 `HARD_REJECT_PROVEN`。

敌方开火能力使用三值：

- CONFIRMED_BLOCKED：已确认仍有活跃普通弹，FIRE 命令不能产生新弹。
- CONFIRMED_AVAILABLE：所有可能活跃弹均已失效且状态允许。
- POSSIBLY_AVAILABLE：不可见弹是否仍存在不确定。

OpponentModel 预测敌方是否提交 FIRE；RulesKernel 根据上述物理状态判断命令是否真正产生子弹。Proof 对 POSSIBLY_AVAILABLE 覆盖成功与无效两类结果。

## 18. Endgame

EndgameSolver 根据“最后有效行动时间”进入，而不是固定在某个普通策略帧数。

当前保守 TerminalPolicy：

- frameLimit 暂定 128。
- 我方落后：LOSS。
- 同星：按我方 runtime 更高视为 LOSS。
- 领先互换和同帧事件由 TerminalResolver 判断。
- 未确认的 phase 顺序返回 UNKNOWN。

进入 fallback 后仍运行缩减版 EndgameSolver。

## 19. ForcedLossRecovery

全部动作明确失败时：

1. 搜索 UNKNOWN escape。
2. 尝试将单方面失败变成有利互换。
3. 尝试改变星差或终局结果。
4. 延迟失败并增加对手犯错空间。
5. 返回当前证明下最小损失动作。

此模式允许已被 `HARD_REJECT_PROVEN` 或 `HARD_REJECT_POLICY` 的候选在失败集合内部比较，但不能伪装成安全动作；`HARD_INCOMPLETE` 必须保持独立。
