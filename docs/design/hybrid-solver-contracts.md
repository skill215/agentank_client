# 混合搜索求解器详细合同

DD6 同步状态：本文保留混合求解总览；细节分别以 [value-search-contract.md](value-search-contract.md)、[matrix-policy-contract.md](matrix-policy-contract.md)、[proof-search-contract.md](proof-search-contract.md) 和 [risk-backup-contract.md](risk-backup-contract.md) 为权威。对称 Terminal/Hard 由 DD1 覆盖，Result/Policy/PRNG 由 [action-result-abi.md](action-result-abi.md) 覆盖；`OI-ARCH-009` 已由单一递归 robust objective + 零损失 safe-floor tie-break 关闭。

## 1. 文档地位与目标

本文是搜索算法的规范性合同。其他文档定义数据布局、模块接口、缓存和 Benchmark；发生语义冲突时，以本文对节点类型、量词、结果边界和完整性的定义为准。

目标是在单线程、同步 `onIdle`、整局 3 秒 runtime 约束下组合以下算法，而不是用一种算法勉强处理所有问题：

- 已提交危险：确定性安全可达性与倒推；
- 强制胜负：InformationState 上的 AND/OR Proof 与有界 DFPN；
- 完全可观察同时行动：阶段矩阵、序列化上下界和 Double Oracle；
- 隐藏信息：Public Belief / Information Set 上的受限 regret solving；
- chance：条件概率、Star 类期望界剪枝；
- 风险：递归的 epsilon-contamination 鲁棒备份；
- 对手利用：不突破安全基线的约束优化。

正式引擎不运行 MCTS、MCCFR 或 rollout。本文提到的 regret solving 使用确定性遍历受限公共信念子树。

## 2. 游戏模型与节点类型

规范类型定义：

    SearchState = PhysicalState | InformationState

实现用整数 `stateKind` 与 Arena `stateOffset` 传递 tagged union，不创建 SearchState wrapper 对象。

### 2.1 PhysicalState

`PhysicalState` 描述一个完整物理世界：

- frame、地形和终局字段；
- 双方坦克、方向、状态、技能与命令摘要；
- 所有已存在 projectile/bomb/effect；
- 该世界中确定的隐藏实体位置；
- 影响后继转换的规则版本。

它只用于 RulesKernel 转换、完全可观察搜索分支、chance outcome 和 ReferenceKernel。真实决策不能读取运行时未向我方公开的 PhysicalState 字段。

### 2.2 InformationState

真实决策节点必须是 `InformationState`：

    commonPhysicalSignature
    exactWorldSupport
    residualSupport
    probabilityBelief
    residualBelief
    ourObservationHistorySignature
    enemyInformationPartition
    commonCommandActionRelation
    ruleCapabilityAssumptionMask

`exactWorldSupport + residualSupport` 无损表示所有仍物理可能的世界，不因低概率删除。`probabilityBelief` 只用于 Expected/Robust Value，不参与严格 Proof 的可能性删减。`commonCommandActionRelation` 表示在当前观察下可统一提交的 ActionProgram 及其逐 world 执行结果；某个命令只在部分世界实际成功时仍保留，成功/失败进入 HiddenWorld outcome，而不是提前删除。

当 exactWorldSupport 只有一个 world、无 residual，且双方相关私有信息都不影响当前及搜索窗口内的合法动作和转换时，InformationState 可降级为 singleton fast path。

### 2.3 ObservationPartition

联合动作和 chance 展开后，先得到 Physical successor，再按我方实际可观察的结果分组：

    observationSignature = observeForUs(physicalSuccessor)

产生相同 observationSignature 的世界必须合并为同一个后继 InformationState。只有观察不同，未来我方策略才允许分叉。

禁止按真实隐藏世界直接递归后分别选择我方动作；这会产生 strategy fusion。

### 2.4 三种不确定性不能合并量词

- `EnemyAction`：战略对手选择；完全可观察节点是单一动作，多个敌方 information set 共存时是按 information set 指派动作的响应策略，进入 min 或敌方混合策略；
- `HiddenWorld`：当前信息集中的可能世界，Proof 全覆盖，Value 使用 belief；
- `ChanceOutcome`：RulesKernel 随机结果，Proof 覆盖 support，Value 使用条件概率或概率区间。

三者可以在物理转换中形成联合 outcome code，但在搜索语义、概率、缓存和完整性证书中必须保留独立维度。

规则实现不确定性使用开发期 `RuleVariantMask`，不是第四种运行时量词。Reference harness 可以对候选规则分别运行并取跨变体 interval；正式 Minimax 只消费冻结的 RULESET_VERSION。只要严格结论依赖未解决变体，`noUnknownRule=false` 且 ProofStatus=UNKNOWN。

## 3. 结果类型

### 3.1 HardGateStatus

- `HARD_ALLOW`
- `HARD_REJECT_PROVEN`
- `HARD_REJECT_POLICY`
- `HARD_INCOMPLETE`

`HARD_REJECT_PROVEN` 只能由已经提交的物理事实、严格确认的规则和不含未来敌方自由选择的倒推链产生。显式保守政策使用 `HARD_REJECT_POLICY`；规则或容量不完整使用 `HARD_INCOMPLETE`，两者都不能生成严格 Proof。

EXTERNAL_SIM_MATCH 不属于严格确认规则。模拟器候选 phase、概率、几何或观察行为不能直接生成 `HARD_REJECT_PROVEN`、ProofStatus 或 exact terminal value。

### 3.2 ProofStatus

- `FORCED_WIN_PROVEN`
- `FORCED_NONLOSS_PROVEN`
- `FORCED_LOSS_PROVEN`
- `ACTION_REFUTED`
- `UNKNOWN`

`ACTION_REFUTED` 只反驳一个动作，不能缓存为“整个状态没有强制胜利”。`UNKNOWN` 不能解释成 DISPROVEN。

### 3.3 BoundKind

- `EXACT_COMPLETE`
- `LOWER_COMPLETE`
- `UPPER_COMPLETE`
- `INTERVAL_COMPLETE`
- `APPROXIMATE_WITH_GAP`
- `HEURISTIC_ONLY`
- `INCOMPLETE`

只有 `EXACT_COMPLETE`、`LOWER_COMPLETE`、`UPPER_COMPLETE` 可参与严格 cutoff。`INTERVAL_COMPLETE` 可传播区间但不能当成单值。其余结果只能用于排序、时间管理和 fallback。

`EXACT_COMPLETE` 只表示指定 horizon、规则假设和 evaluator 合同下的 Value 求解完整，不代表终局 ForcedWin；强制胜负只能由 ProofStatus 与 coverage certificate 表达。

### 3.4 SearchResult 数值字段

每个节点结果至少包含：

    resultStatus
    hardGateStatus
    proofStatus
    boundKind
    terminalResolutionStatus
    terminalOutcome
    incompleteReason
    lowerValue
    upperValue
    worstValue
    expectedValue
    robustValue
    bestActionRef
    bestActionKeyLo/Hi
    policyHandle
    coverageHandle
    assumptionMaskLo/Hi
    solverKind
    completedDecisionDepth
    completedFrameHorizon

所有值采用 WinUtility -10000–10000。`lowerValue <= upperValue` 是强制一致性条件。

## 4. 顶层求解流程

每次真实根按固定顺序执行：

1. 建立 ObservedRoot 并协调 TrackedState。
2. 构造根 InformationState 和低成本 emergency action。
3. CommittedSafetyKernel 计算 HardViableSet。
4. 对满足触发条件的动作运行 ImmediateProof。
5. 选择并冻结本次搜索的 RiskProfile、OpponentModelEpoch、EvalProfile 和 SearchProfile。
6. 迭代加深运行 `solveInformationState`。
7. 根节点在安全约束下计算最终 mixed policy；ForcedWin 或唯一硬安全动作不随机。
8. 验证 action 来源与根 generation 后提交。

节点调度：

    solveInformationState(infoState):
      if terminal/unknown rule: resolve terminal interval
      if proof mode: solveProofState
      if singleton fast path: solvePhysicalStage
      if hidden information is decision-relevant: solveRestrictedInfoGame
      otherwise: aggregate equivalent worlds and solvePhysicalStage

## 5. 同时行动阶段

### 5.1 阶段矩阵

对我方动作 `a`、敌方动作 `b`：

    C[a,b] = evaluateJointCell(state, a, b)

`evaluateJointCell` 内部枚举条件 HiddenWorld/chance outcomes、递归求后继值并执行 nature robust backup。然后使用本节点冻结的 OpponentModel 名义概率和 enemyExpectedWeight 构造 `M = RiskMatrix(C)`。敌方动作、隐藏世界和 chance 不能共享一个概率列或覆盖标志。

### 5.2 序列化快速上下界

每个 cell 保存 `MLower/MUpper`。先计算：

    pureLower = max_a min_b MLower[a,b]
    pureUpper = min_b max_a MUpper[a,b]

如果 `pureLower == pureUpper`，且所有仍可能改变任一相关 row minimum 或 column maximum 的 cell 都具有同 horizon、无启发式剪枝的 cutoff-eligible 完整界，节点返回 `EXACT_COMPLETE`，不运行混合矩阵求解。实现必须生成 compact dependency certificate；只要任一依赖 cell 是 HEURISTIC_ONLY/INCOMPLETE，数值相等也只能继承较弱 BoundKind。

如果不相等：

- pureLower 是我方先承诺纯动作后的保守下界；
- pureUpper 是假设我方观察敌方动作后回应的乐观上界；
- 二者不能任选一个冒充节点真实值。

### 5.3 Double Oracle

矩阵求解不以“纯评分前 2–4 名”作为最终动作集合。受限矩阵初始动作可来自：

- PV/TT action；
- immediate tactical action；
- 每个硬安全战术类别的代表；
- 当前 Active Plan；
- cheap lower/upper 最优动作。

每轮：

1. 求当前受限矩阵的双方平均 mixed strategy；
2. 在完整我方动作集中计算对敌方 mixed strategy 的 best response；
3. 在完整敌方动作集中计算对我方 mixed strategy 的 best response；
4. 将能改进界的动作加入受限矩阵；
5. 更新 lower、upper 和 exploitability gap；
6. 无新 best response 时结束扩展；最终 BoundKind 仍由完整性和 gap 决定。

动作只有在以下条件之一成立时才能永久剪掉：

- Hard-invalid；
- 与另一动作在全部相关世界、敌方回应和 chance 下物理等价；
- 由完整矩阵界证明被纯策略或混合策略支配；
- 不属于 ProofSearch 当前目标的合法 ActionFamily。

### 5.4 小矩阵求解器

首版使用固定容量整数 regret solver，但输出平均策略而不是最后一次策略。每轮后可低频计算：

    stageLower = min_b Expected(MLower, ourAverageStrategy, b)
    stageUpper = max_a Expected(MUpper, a, enemyAverageStrategy)
    exploitabilityGap = stageUpper - stageLower

概率乘加和策略归一化使用区间外扩取整：所有 lower 除法向负无穷取整，所有 upper 除法向正无穷取整，并把策略量化残差计入两端。不得用普通整数截断后的“伪 gap=0”生成 exact。

停止条件：

- 外扩后的 `stageLower == stageUpper`、全部 best-response scan 完成且依赖 cell complete：定点合同下 exact；
- `gap <= profileTolerance`：`APPROXIMATE_WITH_GAP`；
- 时间/节点耗尽：返回当前 `[stageLower, stageUpper]`；
- 固定迭代数本身不能产生 complete 标志。

2x2 等可由构建期选择专用闭式/枚举求解器；通用 solver 仍须输出同一上下界合同。

## 6. Chance 与 Star 界

### 6.1 条件概率

概率接口必须是：

    enumerateChance(state, ourAction, enemyAction, outCodes, outProbabilities)

概率按当前联合动作严格归一化到 10000。不存在一个可供全部矩阵行共享的根 `P[scenario]`。

### 6.2 部分展开界

若 `weightedSum` 保存尚未除以 10000 的整数累加器：

    expectedLower =
      (weightedSum + remainingProbability * MIN_VALUE) / 10000

    expectedUpper =
      (weightedSum + remainingProbability * MAX_VALUE) / 10000

若使用已归一化 partial value，则必须使用对应缩放公式；两种表示不能混用。

通过父节点 alpha/beta、阶段矩阵 lower/upper 判断剩余 chance outcome 是否仍可能改变结果。ProofSearch 不使用概率剪枝，对所有非空 support 完整覆盖。

### 6.3 概率 UNKNOWN

- support 已确认、概率未知：Proof 可全覆盖；Value 返回概率不确定集上的 expected interval；
- support 也未知：Proof 与 Value 均携带 UNKNOWN_RULE，不能生成严格上下界；
- residual belief 不允许压成一个虚构物理后继；必须保留其 min/max contribution。

## 7. InformationState 求解

### 7.1 动作一致性

在同一个我方 information set 中只生成一次我方动作列表。一个动作必须同时应用到该集合内所有可能世界；世界中特有的执行成功/失败进入 outcome，不允许提前泄露世界信息。

`enemyInformationPartition` 把 possible worlds 分成敌方不可区分的 information set。同一个敌方 information set 中，敌方策略必须一致；不同敌方 information set 可以选择不同动作。存在多个敌方 information set 时，`EnemyAction` 表示响应策略 `beta: enemyInformationSetId -> ActionKey`，不能在所有世界强迫敌方共用一个动作，也不能允许同一敌方 information set 在不同世界分别选动作。

### 7.2 受限 Public-Belief Game

只有隐藏信息会改变以下任一项目时才启动：

- 动作合法性；
- projectile/bomb/skill 物理结果；
- 我方下一观察；
- terminal/proof；
- 根动作排序超过 profile threshold。

求解器使用确定性遍历的受限 CFR/regret update：

- regret 绑定 informationSetId + ActionKey；
- reach probability 与 belief probability 分离；
- 更新使用 counterfactual reach；
- 输出平均策略；
- 不使用随机 world sampling；
- 迭代、信息集和 world expansion 均有固定上限。

正式实现前，ReferenceKernel 必须用小型隐藏场景穷举验证无 strategy fusion。

### 7.3 深度叶 continuation vector

隐藏信息深度叶不能只返回一个与策略无关的 scalar value。每个 EvalProfile 生成小型 continuation basis，例如：

    AGGRESSIVE_FIRE
    STAR_RUSH
    POSITION_HOLD
    AMBUSH
    DELAY
    SKILL_BURST

叶子保存对这些对手 continuation policy 的值向量或严格上下界。受限信息集求解允许敌方在 continuation basis 中选择回应。

continuation basis 是求解抽象，不能生成 ForcedWin；只有完整物理/信息覆盖的 ProofSearch 能生成证明。

### 7.4 Singleton 降级

当所有 decision-relevant hidden variables 收敛为单一等价类时，立即释放当前受限信息集 scratch，转入 `solvePhysicalStage`。这是一项强制性能优化。

## 8. 强制胜负与 DFPN

### 8.1 InformationState 上的量词

强制胜利递归定义：

    exists our common action a
      for every enemy response policy beta
        where beta assigns one legal action to each enemy information set
        successors = {
          applyJointPhysical(w, a, beta(enemyInfoSetOf(w)), c)
          for every possible hidden world w
          and every non-empty conditional chance outcome c
        }
        partition successors by our actual observation
        every successor InformationState is terminal WIN or proven WIN

Proof 实现按敌方 information partition 惰性枚举 `beta`，遇到反例立即短路，并用部分策略前缀缓存；禁止预先 materialize 全部笛卡尔积。singleton/单敌方 information set 时，`beta` 退化为普通 `enemyAction`。

敌方一个回应可产生 `ACTION_REFUTED`；只有所有我方合法动作都被反驳，才能证明当前状态不存在该深度/目标下的强制胜利。

### 8.2 Proof 调度

- ReverseViability：已提交危险的低成本宽阶段倒推；
- ImmediateProof：短 horizon、直接击毁/拿星/终局的深度优先 AND/OR；
- DFPN Completion：对接近证明的 UNKNOWN frontier，按 proof/disproof number 补全；
- ValueSearch 只有携带完整 coverage certificate 才能向 ProofCache 写入结果。

### 8.3 CoverageCertificate

证书至少记录：

    allOurActionFamiliesCovered
    allEnemyResponsePoliciesCovered
    allPossibleWorldsCovered
    allChanceSupportCovered
    allObservationPartitionsCovered
    noHeuristicPruning
    noCapacityTruncation
    noUnknownRule
    terminalPolicyVersion
    proofHorizon

任一字段不满足，ProofStatus 必须为 UNKNOWN。

## 9. 递归鲁棒风险

RiskProfile 对 `ChanceOutcome -> HiddenWorld -> EnemyAction` 三个独立维度递归应用 ε-contamination。每维 expected weight 为 0–9900，risk=0 全部取 worst，risk=100 仍至少保留 1% contamination。技能只通过这三种量词或 stateRiskClass/feature 表达，不建立第四种 scenario 量词。

节点先按 observation partition 得到可合法分叉的 child InformationState，再按 chance、hidden、enemy 的规范顺序做 outward integer backup。StageMatrix 只求一次 risk-transformed game，根不得再对 robustValue 混合。

`stateRiskClass` 是 SearchState 的确定性整数纯函数；RiskProfileId、class、table version 和 OpponentModelEpoch 进入 ValueSearchKey，不进入 DecisionHash/Proof。risk、nominal probability 永远不能删除 possibility、升级 Hard/Proof 或改写 Terminal。

## 10. 对手模型与安全利用

OpponentModel 只形成名义概率：

    P(enemyAction | enemyInformationClass, sharedObservationFeatureSignature)

概率用于 ExpectedValue、动作排序和 safe exploitation objective。对手参数不进入 Proof 或 HardGateStatus。

根节点先求递归 risk objective 的 certified `safeFloor`，然后只在：

    candidate.robustLower >= safeFloor

的 policy 中最大化 nominal expected。DD6 V1 的 `allowedExploitLoss=0`；不从同一个 risk 参数再派生第二个根损失预算。若受限求解未完成或模型 confidence 过低，返回生成 safeFloor 的 baseline policy。

当前公式表达的是 worst/expected 权重，不代表“获胜概率至少 99%”。若未来需要概率保证，必须增加独立 chance constraint，不能复用 risk 数值冒充。

历史 replay 的实际敌方动作只能作为一个合法反例或 `TraceOpponentProfile` 样本。搜索动作一旦与历史分叉，原 replay 后缀不再是有效 transition；之后必须由 ReferenceKernel、冻结的 policy adapter 或 best response 产生。离线双向反事实使用与正式搜索相同的 InformationState 动作一致性和 AND/OR 量词，详见 [legacy-evidence-contract.md](legacy-evidence-contract.md)。

## 11. 时间、中断和 fallback

每个求解器都必须是 anytime 且可中断：

- Physical stage：保留已完成动作行及合法上下界；
- Double Oracle：保留受限矩阵、双方平均策略和当前 gap；
- Info solver：保留最后完整 regret iteration；
- Chance：保留 weighted partial 与 remaining bounds；
- DFPN：保留 proof/disproof frontier，但只有证书完整的结论可输出 Proof；
- iterative deepening：只发布最后完整 decision depth。

进入 DEGRADED/FALLBACK 后允许减少：

- decision depth；
- Double Oracle 扩展轮数；
- matrix tolerance；
- hidden top-K 精度与 continuation basis 数量；
-昂贵软特征。

不允许减少：

- committed entity 完整生命周期；
- HardGateStatus 动作级验证；
- Proof 已声明覆盖的维度；
- terminal phase；
- root action 来源验证。

## 12. 缓存分层

- `PHYSICAL_VALUE_TT`：完整PhysicalState stage value，不是transition patch；
- `INFORMATION_VALUE_TT`：ValueSearchKey与双方information partition下的Value interval；
- `PROOF_CACHE`：DecisionHash、proof goal、horizon与strict coverage；
- `STAGE_MATRIX_CACHE`：ValueSearchKey、双方action-set signature、matrix cells和gap；
- `CHANCE_CACHE`：physical signature + joint action + chance/rule version；
- `REGRET_WARM_CACHE`：只复用完全相同public-belief subgame与continuation basis的warm start，默认关闭且不能冒充exact value。

其余PATH/FEATURE/BELIEF/ENTITY_PLAN/optional TRANSITION及完整key以 [cache-inventory.md](cache-inventory.md) 为唯一清单。

ProofCache 命中除 hash 外必须执行紧凑 canonical signature 核对。普通软 TT 可接受双/多 uint32 hash 的概率碰撞策略，但不得把未核对 hash 命中升级为严格 Proof。

## 13. 性能合同

优先级：

1. singleton fast path 不携带 CFR 循环开销；
2. pureLower == pureUpper 且 dependency certificate 完整时不创建/清理 regret 矩阵；否则只保留显式区间；
3. Double Oracle 只 materialize 当前受限行列；
4. chance outcomes 按改变界的能力排序并使用 partial bounds；
5. observation partition 使用直接寻址 accumulator + touched list；
6. InformationState canonicalization 不使用字符串、Map 或对象图；
7.所有 solver scratch 按深度/根预分配；
8. continuation vector 长度由 build profile 固定；
9. gap/clock 只在固定 iteration batch 棭查；
10. 缓存只有 Benchmark 证明净收益才进入生产构建。
11. RuleVariant 枚举、外部 replay event 对象和 simulator clone 只存在于测试工具，不进入生产节点循环。

## 14. 必须通过的算法测试

- Rock-Paper-Scissors：深层纯上下界不相等，matrix solver 输出近似 1/3 分布；
- Matching Pennies：根和深层混合值一致；
- dominated support trap：纯评分较低但属于均衡 support 的动作不能被 top-K 删除；
- action-dependent teleport chance：不同行使用不同条件概率；
- strategy fusion trap：两个不可区分世界需要同一动作，禁止分别选择；
- observation split：只有产生不同可观察结果时后继策略才分叉；
- residual belief：低概率 residual 仍影响 Worst/Proof；
- proof refutation：ACTION_REFUTED 不能写成 state DISPROVEN；
- unknown terminal phase：只能返回 interval/UNKNOWN；
- risk recursion：同一 RiskProfile 在重复搜索中值和 policy 完全一致；
- safe exploitation：OpponentModel 改善期望时仍不突破配置的 worst baseline；
-中断一致性：任意 batch 中断都保持 lower <= true <= upper；
- Fast/Reference：所有 solver 的 action distribution、bounds、proof 和 observation partition 对齐。
- rule-variant separation：候选平台规则不能污染 HiddenWorld/Chance 编码，未确认变体不能生成 Proof；
- external simulator conflict：poison 25/20、300/128 帧等已知冲突必须由证据层级拦截，不能进入 FastKernel。

## 15. 算法依据

- [Alpha-Beta Pruning for Games with Simultaneous Moves](https://ojs.aaai.org/index.php/AAAI/article/view/8148)
- [Using Double-Oracle Method and Serialized Alpha-Beta Search](https://www.ijcai.org/Proceedings/13/Papers/018.pdf)
- [Regret Minimization in Games with Incomplete Information](https://papers.nips.cc/paper/3306-regret-minimization-in-games-with-incomplete-information.pdf)
- [Depth-Limited Solving for Imperfect-Information Games](https://papers.nips.cc/paper_files/paper/2018/hash/34306d99c63613fad5b2a140398c0420-Abstract.html)
- [The *-minimax Search Procedure for Trees Containing Chance Nodes](https://doi.org/10.1016/S0004-3702(83)80015-0)
- [Proof-Number Search and Transpositions](https://doi.org/10.3233/ICG-1994-17203)
- [Robust Dynamic Programming](https://doi.org/10.1287/moor.1040.0129)
- [Dynamically Consistent Alpha-Maxmin Expected Utility](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2562354)
- [Safe and Robust Subgame Exploitation](https://proceedings.mlr.press/v235/ge24b.html)

上述论文提供算法语义和正确性依据；具体 TypedArray、整数 solver、容量、阈值及 runtime profile 必须由本项目 ReferenceKernel 和平台 Benchmark 决定。
