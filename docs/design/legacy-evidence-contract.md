# v1 遗产证据与双向反事实合同

## 1. 目标与边界

v1 的代码、分析文档和真实平台对局是新坦克的重要证据源，但不是新架构的实现基础。本合同规定如何把这些积累转换为：

- 可复现的规则 fixture；
- 死亡、逃生、击杀和性能窗口；
- Hard、Proof、Risk、Eval 和 OpponentModel 的候选证据；
- v1/v2 行为回归、反事实检查点和完整对局基准；
- 不进入生产 bundle 的离线分析产物。

核心边界：

- v1 动作不是 gold label；v2 不以模仿 v1 为目标。
- 历史上某动作导致死亡，只是一个反证 witness，不自动等于 `HARD_REJECT_PROVEN`。
- 分叉后的历史未来已经失效，不能继续把实际后续动作当作唯一真实未来。
- v1 分析文档提供假设和证据索引；严格规则必须回到官方来源或原始平台 replay/simulation 验证。
- v1 完整实现、replay parser、JSON、日志和离线模型不得进入正式搜索或 fallback。
- 一局内仍只更新敌方参数和 confidence，不因历史样本改变我方固定 feature weights 或策略参数。

## 2. 冻结快照基线与滚动扩展

不可变快照 `LEGACY-244-20260715.1` 包含：

- 244 个唯一平台对局；
- 173 胜、71 负；
- 10,996 个 replay frame；
- 10,752 个可比较决策帧；
- 23 个 v1 code hash。

当前入口：

- v1 迭代与失败分析：[../../MINIMAX_ANALYSIS.md](../../MINIMAX_ANALYSIS.md)
- 244 局历史回归报告：[../../battle-records/historical-regression-v24-published-244/REPORT.md](../../battle-records/historical-regression-v24-published-244/REPORT.md)
- 聚合分析：[../../battle-records/all-244-20260715-1627-cst/analysis.json](../../battle-records/all-244-20260715-1627-cst/analysis.json)
- 失败索引：[../../battle-records/all-244-20260715-1627-cst/failures.csv](../../battle-records/all-244-20260715-1627-cst/failures.csv)
- v24 行为基线：[../../battle-baselines/v24-all-244.json](../../battle-baselines/v24-all-244.json)

这些数字只属于该不可变快照，不写死在搜索代码，也不代表当前总局数。新增对局不得递增或覆盖该快照；它们追加到 [rolling-corpus-contract.md](rolling-corpus-contract.md) 定义的 MatchLedger，并由新的 CorpusHead/CorpusSnapshot 指纹引用。上述 244 局永久保留为冻结回归集。

## 3. 三种遗产来源

### 3.1 v1 分析文档

分析文档用于发现：

- 已定位的失败因果链；
- 曾经有效的修复机制；
- 平台规则候选；
- 技能、隐藏信息和终局的未决假设；
- 性能热点与 runtime 失败；
- 已被后续版本修复、复发或推翻的历史结论。

分析文字本身不能支持严格 Hard/Proof。任何规则性结论必须关联原始 match/frame 和可执行 fixture。

### 3.2 原始平台 replay

原始 replay 提供实际事件和终局结果。它可以：

- 证明某个实际动作—回应序列发生过；
- 为动作或强制胜利声明提供反例；
- 校准 ReferenceKernel 的事件转换；
- 生成历史检查点、状态协调和观察回归；
- 提取局内对手行为机会与选择。

Replay 通常是事件序列，不保证等于当时完整 `onIdle` 输入。任何重建字段必须记录来源与 confidence，不能把推断字段伪装成观察事实。

### 3.3 v1 实现

v1 只通过离线 `LegacyPolicyAdapter` 使用，用于：

- 同一观察输入下的行为对比；
- 旧版本之间的行为回归；
- 作为完整对局 league 对手；
- 把已实现技能处理转换为待验证行为合同和 fixture 候选；
- 发现新设计遗漏的低成本战术机制。

禁止把 v1 的 Monte Carlo、对象状态、概率猜测、硬 guard 或完整 action selector 链接进 v2。线上 fallback 必须继续使用 v2 同一 RulesKernel 和缩减深度 Minimax。

## 4. LegacyFindingRegistry

每条历史分析结论必须结构化：

```text
LegacyFinding {
  findingId
  claim
  type
  sourceDocument
  sourceSection
  matchIds[]
  frameRanges[]
  codeHashes[]
  fixtureIds[]
  evidenceStatus
  reconstructionConfidence
  ruleAssumptionMask
  affectedModules
  fixedInVersions[]
  contradictedBy[]
  supersededBy
}
```

`type` 至少包括：

- `RULE_EVIDENCE`：平台规则候选；
- `BUG_HYPOTHESIS`：实现或决策缺陷；
- `POSITIVE_MECHANISM`：需要保护的成功行为；
- `PERFORMANCE_OBSERVATION`：耗时、分配或 fallback 现象；
- `MODEL_CALIBRATION`：风险、belief 或对手模型样本。

`evidenceStatus` 至少包括：

- `DOCUMENT_ONLY`
- `REPLAY_LOCATED`
- `TRACE_REPRODUCED`
- `REFERENCE_CONFIRMED`
- `PLATFORM_CONFIRMED`
- `CONTRADICTED`
- `SUPERSEDED`

只有 RuleRegistry 的证据等级允许时，finding 才能生成严格规则。`DOCUMENT_ONLY` 和 `TRACE_REPRODUCED` 最多影响离线排序、场景覆盖和风险候选。

### 4.1 首批 finding 提取队列

第一批结构化工作按现有 v1 分析优先覆盖：

- 不可见 projectile 被遗忘、错误转向和规避计划中断；
- immediate muzzle、inflight bullet、grass shot、cloak shot 和 bomb deadline；
- 同星/星差下物理死亡与终局互换判断；
- 128 帧、timeout 和累计 runtime 失败；
- overload 两颗独立 projectile 的生成几何、ID 和生命周期；
- 隐藏威胁一步风险饱和但缺少两步生存区分；
- 成功的立即开火、飞行弹击杀、眩晕补枪、bomb 击杀与安全逃生。

该队列只决定 fixture 和窗口提取优先级，不预设结论。每项必须同时寻找失败样本和相近条件的正向样本。

## 5. 双轨状态重建

每场 replay 必须同时产生两个轨道，并对我方、敌方分别构建观察边界。

### 5.1 TruthTrack

`TruthTrack` 尽可能重建完整物理事件：

- 双方位置、方向、状态和已执行命令；
- 所有已确认 projectile/bomb 的 owner、轨迹和生命周期；
- 地形变化、技能效果和终局事件；
- replay 明确提供的隐藏真值。

它只供 Oracle、因果定位和结果核对使用。

### 5.2 ObservedTrack(side)

`ObservedTrack(OUR_SIDE)` 与 `ObservedTrack(ENEMY_SIDE)` 分别只包含该侧在当帧合法可见或可从历史观察严格推导的事实，用于重建对应 `InformationState`。

禁止：

- 用 TruthTrack 中的草丛、cloak 或视锥外实体帮助被测 policy 选动作；
- 把事后知道的 projectile owner、敌方命令或随机结果写入当时 InformationState；
- 让双向模拟的任一侧读取另一侧私有 observation。

每个字段标记：

```text
OBSERVED | DETERMINISTIC_INFERRED | PROBABILISTIC_INFERRED | UNKNOWN
```

严格 Proof fixture 只能依赖前两类；后两类进入 HiddenWorld、RuleVariant 或软分析。

## 6. 失败与成功窗口

### 6.1 动态失败窗口

倒数 4 帧是子弹事故的默认展示窗口，不是统一算法边界。每个失败样本至少标记：

```text
failureOriginFrame
lastAvoidableDecisionFrame
pointOfNoReturnFrame
terminalFrame
```

- `failureOriginFrame`：最早形成该失败链的可识别决策。
- `lastAvoidableDecisionFrame`：最后一个仍存在候选非输动作的决策帧。
- `pointOfNoReturnFrame`：从该状态开始已证明或在当前模型下无法再避免失败。
- `terminalFrame`：实际死亡、timeout、runtime 判负或其他终局帧。

窗口向前长度由危险 deadline 决定：projectile 通常覆盖 1–4 帧，bomb 至少覆盖完整引信与逃生链，128 帧/星差/runtime 失败允许追踪到更早的战略起点。

失败分类至少包括：

- `COMMITTED_HAZARD_MISS`
- `IMMEDIATE_ENEMY_RESPONSE`
- `HIDDEN_THREAT`
- `TERMINAL_TRADE_ERROR`
- `PLAN_BREAK`
- `RULE_MODEL_MISMATCH`
- `RUNTIME_FAILURE`
- `RECONSTRUCTION_UNKNOWN`

每个窗口可保存：

- `RefutationWitness`：历史动作如何被一个合法回应击败；
- `EscapeWitness`：一个替代动作及其成立条件；
- `CoverageCertificate`：若声称严格可避免或不可避免，记录完整量词覆盖。

### 6.2 正向窗口

必须从胜局和成功逃生中同时提取：

- `KillWindow`
- `EscapeWindow`
- `BombEscapeWindow`
- `SkillValueWindow`
- `TerminalTradeWindow`
- `StarDeadlineWindow`
- `PerformanceHotWindow`

每个负样本尽可能匹配地图拓扑、技能、星差、危险类型和 deadline 接近的正样本，防止 Hard/Risk 调整只会减少死亡，却破坏开火、抢星和终局转换能力。

## 7. 双向反事实模拟

历史检查点必须支持交换受控方。既分析“v2 能否避免我方历史死亡”，也分析“历史敌方能否避免其死亡”。后者用于识别：

- 我方攻击是否是严格强制胜利；
- 对手只是漏掉了明显逃生动作；
- v1 的击杀依赖特定风险偏好还是对所有回应都成立；
- 哪些进攻位置在更强对手面前会失效。

### 7.1 对手侧信息与策略重建

`ReplayOpponentModelBuilder` 从事件驱动机会中提取：

- 有效开火机会与实际开火；
- 拿星/阻止拿星机会与选择；
- 移动距离、转向、追击和撤退；
- 技能有效窗口与使用；
- 风险暴露后继续进攻或退出。

它生成该场离线 `TraceOpponentProfile` 和置信度。无法由 replay 唯一确定的命令标记 `UNKNOWN_ACTION`，不能强补标签。

`TraceOpponentProfile` 只用于该场反事实诊断和总体离线校准。生产代码不保存命名对手特例；真实对局仍从通用先验开始，并由本局事件动态更新 OpponentModel。

### 7.2 运行模式

`BidirectionalCounterfactualRunner` 至少支持：

1. `FACTUAL_REPRODUCTION`：复现真实前缀，验证重建和 ReferenceKernel。
2. `OUR_DEVIATION`：改变我方动作，短前缀内测试历史敌方回应，之后改用对手模型或搜索。
3. `ENEMY_DEVIATION`：保持我方历史/legacy policy，搜索敌方逃生、反击或阻断动作。
4. `BOTH_SEARCH`：双方从各自 InformationState 使用独立 policy 或受限矩阵求解。
5. `ADVERSARIAL_SURVIVAL`：对被分析一方寻找共同动作，并对所有合法敌方策略、HiddenWorld 和 chance 做最坏覆盖。
6. `POLICY_EXPLOITATION`：对 TraceOpponentProfile 的高概率行为寻找最佳响应，只产生软风险/价值证据。

### 7.3 分叉边界

在 checkpoint 前可以重放真实事件。checkpoint 后：

- 若联合状态和命令前缀仍与历史完全一致，可继续消费真实事件；
- 任一动作、位置、实体、观察或命令队列发生分叉，原历史后缀立即失效；
- 分叉后的敌方动作来自 `LegacyPolicyAdapter`、`TraceOpponentProfile`、脚本 policy 或 ReferenceKernel best response；
- 分叉后的物理和终局只由冻结 RuleVariant 下的 ReferenceKernel/FastKernel 产生；
- 实际历史敌方下一步可作为合法反例，但不能代表全部回应，也不能无条件跨越分叉复用。

### 7.4 可避免性标签

每个死亡检查点输出分层结论：

- `TRACE_AVOIDABLE`：对已复现的实际下一回应存在逃生动作；只是一条反事实 witness。
- `MODEL_AVOIDABLE`：对 TraceOpponentProfile 或一般 OpponentModel 有高价值逃生；只影响 Risk/Eval。
- `ROBUST_AVOIDABLE`：存在同一 InformationState 可提交动作，对给定 horizon 内所有合法回应、HiddenWorld 和 chance 均非输。
- `STRICT_UNAVOIDABLE`：在冻结规则和明确 horizon 下直接使用 DD6 ForcedLoss 量词；同时节点必须存在一个单一且 observation-consistent 的敌方 response policy 同时覆盖全部我方 row，不能逐 row 各挑反制。HiddenWorld、chance 和观察后继完整覆盖并最终导向 TerminalResolver 的 LOSS；已提交危险对所有双方动作均 LOSS 时可使用更强的 InevitableLossCertificate。
- `UNKNOWN`：规则、观察重建、深度、时间或覆盖不足。

只有后两类允许写入 Proof fixture。`TRACE_AVOIDABLE` 或 `MODEL_AVOIDABLE` 不得把另一动作升级为硬安全，也不得把历史动作升级为硬失败。

交换视角时使用同一标签和量词，不因样本中的 winner/loser 身份改变证明标准。

## 8. 历史证据到设计模块的升级门

| 历史结果 | 可进入 | 禁止进入 |
|---|---|---|
| 单条实际死亡链 | ACTION_REFUTED、Risk/Eval fixture | HARD_REJECT_PROVEN、ForcedLoss |
| 完整规则下 RobustAvoidable | Proof/ReverseViability 回归 | 未确认规则的生产 Proof |
| StrictUnavoidable + 完整证书 | ForcedLoss/Hard 候选 | 绕过 TerminalResolver |
| 敌方可逃脱 KillWindow | 攻击 Risk、Opponent best response | 直接删除 FIRE |
| 重复平台物理现象 | RuleRegistry 候选 | 不经原始 fixture 升级规则 |
| v1 成功机制 | 正向回归、动作排序候选 | v1 动作 gold label |
| runtime/timeout 样本 | Benchmark 分布、fallback 校准 | 用本地耗时替代平台耗时 |

升级流程：

```text
analysis finding
  -> raw replay location
  -> dual-track reconstruction
  -> factual trace reproduction
  -> minimal fixture / counterfactual checkpoint
  -> ReferenceKernel coverage
  -> RuleRegistry or benchmark gate
  -> generated production rule/table only when eligible
```

## 9. 数据划分与防过拟合

具体不可变版本、相关组算法、角色计数和hash以 [legacy-corpus-manifest.md](legacy-corpus-manifest.md) 与 [dd9-legacy-corpus-manifest.json](dd9-legacy-corpus-manifest.json) 为准；本节保留使用原则。

禁止随机拆分相邻 frame。数据必须按 match 分组，并考虑 opponent、map、skill、codeHash 和时间：

- `discovery`：定位问题、生成假设；
- `calibration`：风险、belief 和通用对手先验；
- `frozen-regression`：固定历史窗口，不参与调参；
- `forward-validation`：后续新平台对局，只用于最终验证。

同一 match 的所有窗口只能进入一个集合。相邻版本或同一对手的高度相关对局应成组分配。胜负、技能、隐藏威胁、炸弹、overload、终局和 runtime 都必须有覆盖。

最终胜负不能独自充当每帧标签。反事实动作标签来自 ReferenceKernel 的 horizon 结果、CoverageCertificate 和明确的不确定性等级。

## 10. 性能与生产隔离

以下组件全部属于离线冷层：

- replay 下载、解析和双轨重建；
- LegacyFindingRegistry；
- Death/Positive Window 提取；
- LegacyPolicyAdapter；
- ReplayOpponentModelBuilder；
- BidirectionalCounterfactualRunner；
- 外部模拟器和 league harness；
- CSV/JSON 报告和日志。

正式坦克禁止：

- 在 10,752 个历史帧中做相似状态搜索；
- 加载 replay、match id、命名对手参数或分析字符串；
- 调用 v1 或外部模拟器；
- 为历史模式增加无界 Map、对象或分支。

若离线统计确实提升泛化能力，只允许蒸馏为小型整数 LUT、动作排序常量或通用先验。生成物必须：

- 有独立版本和 corpus fingerprint；
- 只影响 Risk、ExpectedValue 或 action ordering；
- 不影响 HardGateStatus、PossibilityMask 或 Proof 完整性；
- 通过 source/minified 差分、bundle bytes 和全景 Benchmark；
- 能被关闭并完成 A/B；
- 当前局事件能覆盖通用对手先验。

## 11. 最小工具接口

```text
HistoricalReplayAdapter.load(matchId) -> RawReplay
DualTrackReconstructor.build(rawReplay, ruleVariant)
  -> { truthTrack, ourObservedTrack, enemyObservedTrack, confidence }

WindowExtractor.extract(tracks)
  -> FailureWindow[] + PositiveWindow[]

LegacyPolicyAdapter.decide(version, observedRoot) -> LegacyActionProgram
ReplayOpponentModelBuilder.fit(observedTrack, events) -> TraceOpponentProfile

BidirectionalCounterfactualRunner.run(
  checkpoint,
  controlledSide,
  ourPolicy,
  enemyPolicy,
  ruleVariant,
  horizon
) -> CounterfactualResult
```

所有 adapter 输出 canonical integer action/event/state code。对象友好实现只存在于测试工具；FastKernel 差分入口消费相同 fixture 的紧凑生成物。

## 12. 必须报告的指标

- factual trace reproduction rate；
- reconstruction unknown/confidence 分布；
- failure/positive window 数量和技能覆盖；
- last avoidable frame 与 point-of-no-return 距离；
- TRACE/MODEL/ROBUST/STRICT/UNKNOWN 分布；
- 历史死亡逃脱率与正向击杀保留率；
- 敌方逃脱后原 v1 攻击失效率；
- v1/v2 action disagreement，不把一致率当成质量指标；
- Hard/Proof false positive 与 ACTION_REFUTED 数量；
- Reference/Fast checkpoint 差分；
- 每检查点节点数、耗时和批量吞吐；
- 生成整数表的 bytes、线上 lookup 成本和 A/B 净收益。
