# DD9 双轨重建与双向反事实验证合同

状态：DD9 规范合同，DD10语料生命周期修订，2026-07-16。本文是 `CounterfactualResult`、分叉门、可避免性标签和离线执行管线的权威；冻结244角色以 [legacy-corpus-manifest.md](legacy-corpus-manifest.md) 为准，动态新增角色/技能provenance以 [rolling-corpus-contract.md](rolling-corpus-contract.md) 为准，Proof量词以 [proof-search-contract.md](proof-search-contract.md) 为准。

## 1. 目标与非目标

本合同把 244 局平台 replay 和后续平台局转换为四类可审计证据：

1. factual 前缀是否能被规则状态机重建；
2. 历史死亡前是否存在 trace/model/robust 层级的替代动作；
3. 交换受控方后，历史对手是否能逃脱我方击杀；
4. v2 是否保留 v1 中有效的 Kill/Escape/Skill/TerminalTrade 行为。

它不把 v1 动作当 gold label，不从历史最终胜负反推每帧动作标签，不使用 TruthTrack 帮 policy 决策，也不让 replay 后缀跨越反事实分叉。

当前文档只完成详细设计。尚无 v2 Reference/Fast/Search 实现，因此没有任何 `ROBUST_AVOIDABLE`、`STRICT_UNAVOIDABLE` 或发布通过结果可宣称已运行。

## 2. 版本与不可变输入

每次运行必须冻结：

```text
CounterfactualEngineManifest {
  schemaVersion
  runId
  legacyCorpusVersion
  splitAssignmentFingerprint
  ruleCorpusVersion
  rulesetVersion
  ruleVariantId
  terminalPolicyId
  referenceKernelHash
  fastKernelHash
  proofSearchVersion
  valueSearchVersion
  featureWeightVersion
  opponentModelVersion
  legacyAdapterVersion
  reconstructionVersion
  windowExtractorVersion
  buildHash
  localEngineId
}
```

缺少实现的 hash 写 `NOT_IMPLEMENTED`，不能省略字段。任何影响 phase、observation、support、terminal、proof 或 counterfactual policy 的变化都创建新 manifest；只改变报告排版可以复用结果内容 hash。

`requestFingerprint` 是 manifest、checkpoint、受控方、模式、policy、horizon 和所有预算字段的 canonical integer/string serialization SHA-256。缓存和结果文件只按完整 fingerprint 命中。

## 3. 总流水线

```text
immutable raw replay
  -> canonical platform events
  -> TruthTrack + ObservedTrack(OUR_SIDE) + ObservedTrack(ENEMY_SIDE)
  -> factual prefix comparison
  -> FailureWindow / PositiveWindow
  -> BidirectionalCheckpoint
  -> controlled divergence
  -> Reference/Fast transition + policy/search continuation
  -> CounterfactualResult + Coverage/Refutation/Escape witness
  -> role-aware admission into Discovery/Calibration/Frozen/Forward report
```

必须先通过当前 checkpoint 的 factual reconstruction gate，才能运行反事实。不能重建的字段保留 provenance/UNKNOWN，不用 v1 猜测填满。

## 4. 双轨字段来源

### 4.1 ProvenanceCode

每个可能影响 action/support/proof 的字段附带：

```text
OBSERVED
DETERMINISTIC_INFERRED
PROBABILISTIC_INFERRED
UNKNOWN
```

- `OBSERVED`：原始 replay/合法 side observation 直接提供；
- `DETERMINISTIC_INFERRED`：由已冻结规则和该 side 的历史观察唯一推出；
- `PROBABILISTIC_INFERRED`：存在多个合法值，仅有权重；
- `UNKNOWN`：support 或 value 都不能完整恢复。

Proof policy 只能读取其 side 的 `OBSERVED/DETERMINISTIC_INFERRED` 信息；后两类必须进入 HiddenWorld/residual/RuleVariant 或使严格覆盖 incomplete。

### 4.2 TruthTrack

`TruthTrack` 保存平台实际发生的物理/终局事件及其来源：

```text
TruthFrame {
  matchUrlId
  recordIndex
  absoluteFrame
  preStateRef
  orderedEventBegin/count
  postStateRef
  platformTerminalOutcome
  reconstructionStatus
  ruleAssumptionMask
  canonicalTraceHash
}
```

TruthTrack 只供 factual comparator、Oracle 定位和窗口标注使用。被测 policy、OpponentModel 和 StrategySelector 不得持有其 handle。

### 4.3 ObservedTrack

每局生成两个独立轨道：

```text
ObservedFrame {
  side
  matchUrlId
  recordIndex
  observationHistorySignature
  observedRootRef
  informationStateRef
  possibleWorldSupportVersion
  enemyInformationPartitionVersion
  unknownFieldMask
  provenanceSummary
}
```

`ObservedTrack(OUR_SIDE)` 和 `ObservedTrack(ENEMY_SIDE)` 分别使用该侧可见性、历史记忆和 observation phase。交换受控方时不能复用另一侧 InformationState。Truth/Observed 泄漏测试必须故意改变隐藏真值而保持 observation 相同，确认 policy/action 不变。

## 5. Window 与 Checkpoint schema

### 5.1 FailureWindow

```text
FailureWindow {
  windowId
  corpusRef
  matchUrlId
  failedSide
  failureClass
  failureOriginFrame
  lastAvoidableDecisionFrameCandidate
  pointOfNoReturnFrameCandidate
  terminalFrame
  committedHazardDeadline
  terminalReason
  frameRefs[]
  truthTrackRef
  observedTrackRefBySide[2]
  reconstructionConfidenceQ10000
  ruleAssumptionMask
  extractionEvidence
}
```

`lastAvoidable...Candidate` 和 `pointOfNoReturn...Candidate` 在窗口提取时只是待证候选。只有反事实覆盖后才写 verified 值。倒数 4 帧只是 projectile 报告视图；bomb、128 帧、timeout 和累计 runtime 必须按真实因果 deadline 向前扩展。

### 5.2 PositiveWindow

```text
PositiveWindow {
  windowId
  type                 // KILL, ESCAPE, BOMB_ESCAPE, SKILL_VALUE,
                       // TERMINAL_TRADE, STAR_DEADLINE, PERFORMANCE_HOT
  actingSide
  startFrame
  commitmentFrame
  resolutionFrame
  mechanismId
  factualActionPrograms[]
  outcome
  matchedNegativeWindowIds[]
  reconstruction fields...
}
```

任何安全、风险或评分调整都同时运行相邻正向窗口。只减少历史死亡而破坏开火、抢星、眩晕补枪或炸弹逃生，不算通过。

### 5.3 BidirectionalCheckpoint

```text
BidirectionalCheckpoint {
  checkpointId
  windowId
  recordIndex
  preDecisionPhaseId
  truthStateRef
  ourInformationStateRef
  enemyInformationStateRef
  pendingCommandRefs[2]
  activeCommittedEntityRefs[]
  factualPrefixHash
  historicalNextActionRefs[2]
  legalActionSupportVersions[2]
  world/chance/observation support versions
  reconstructionStatus
  ruleAssumptionMask
}
```

受控方在同一 checkpoint 可分别为 `OUR_SIDE` 与 `ENEMY_SIDE`；两次运行共享物理 factual prefix，但各自读取自己的 InformationState。

## 6. Factual reproduction gate

反事实前必须比较：

- ordered EventCode、owner/entity generation 和 phase；
- tank/projectile/bomb/star/terrain 后继状态；
- 双方 observation signature；
- terminal outcome/reason；
- 未知字段、RuleVariant 和 capacity completeness。

每帧状态：

```text
EXACT_MATCH
OBSERVATION_MATCH_PHYSICAL_UNKNOWN
EXPECTED_VARIANT_MISMATCH
UNRESOLVED_MISMATCH
MISSING_INPUT
```

准入：

- `FACTUAL_REPRODUCTION` 报告可包含全部状态；
- `TRACE_AVOIDABLE/MODEL_AVOIDABLE` 至少要求 checkpoint 前 action/observation/committed entity 一致，未知进入结果限制；
- `ROBUST_AVOIDABLE/STRICT_UNAVOIDABLE` 要求 checkpoint 及覆盖 horizon 内使用的规则、support、observation 和 terminal 均完整，`ruleAssumptionMask=0`；
- 任何未解决 mismatch 使严格标签 `UNKNOWN`，不能因 Reference 与 Fast 同样输出而升级。

历史动作一致率只检查 adapter/reconstruction，不是策略质量指标。

## 7. 分叉与历史后缀失效

### 7.1 Divergence predicate

历史后缀仅在以下全部相等时可继续作为 factual 输入：

```text
joint physical canonical signature
both pending command signatures
both executed ActionProgram signatures
entity handles/generations and observation signatures
rule/chance prefix signature
```

任一项不同，在该 phase 产生 `DIVERGED`。从该点开始：

- `historicalSuffixConsumedFrames` 必须保持 0；
- 平台实际下一动作只可作为一个 `TraceResponseWitness`，不可当环境真值自动执行；
- 物理、观察和 terminal 只由冻结 ReferenceKernel/FastKernel 生成；
- 后续敌方命令来自声明的 policy/search，chance 来自声明 support/seed；
- 回到与历史相同的 cell 不会重新激活旧后缀，因为因果状态和信息历史已经不同。

### 7.2 不可跨越的边界

以下任一变化必定分叉：MOVE/TURN/FIRE/BOMB/SKILL/WAIT 不同、命令执行失败不同、projectile/bomb ID 或 deadline 不同、terrain 被不同事件修改、star 收集/生成不同、观察到的隐藏实体不同、累计 runtime/terminal relation不同。

## 8. 六种运行模式

| 模式 | 控制与继续方式 | 最大证据级别 |
|---|---|---|
| FACTUAL_REPRODUCTION | 完整历史前缀，不改动作 | reconstruction/rule evidence |
| OUR_DEVIATION | 改我方；敌方用 trace witness、模型、adapter 或 search | 取决于 continuation policy |
| ENEMY_DEVIATION | 改历史敌方；我方用 exact adapter、v2 policy 或 search | 同上 |
| BOTH_SEARCH | 双方各自 InformationState，pure/matrix/value search | Value 或 strict Proof |
| ADVERSARIAL_SURVIVAL | 为受控方找共同策略，按 DD6 完整 universal support | robust/strict candidate |
| POLICY_EXPLOITATION | 对 TraceOpponentProfile/nominal policy 求最佳响应 | MODEL only |

同一结果必须记录 continuation 的 policy class：

```text
HISTORICAL_SINGLE_TRACE
EXACT_LEGACY_SOURCE
VERSION_LABEL_LEGACY_SOURCE
TRACE_OPPONENT_MODEL
SCRIPTED_POLICY
V2_POLICY
REFERENCE_BEST_RESPONSE
PROOF_SEARCH
```

只有 v20 历史 codeHash 当前有 `EXACT_LEGACY_SOURCE`。v21/v22/v24 本地 label 文件可作为独立对手，但其结果不得标为历史版本精确复现。

## 9. CounterfactualResult

```text
CounterfactualResult {
  schemaVersion
  resultId
  requestFingerprint
  engineManifestRef
  corpus/split/group refs
  checkpointId
  controlledSide
  perspective
  runMode
  policyClasses[2]
  horizonKind/endFrame

  reconstructionStatus
  ruleAssumptionMask
  divergencePhase
  factualPrefixHash
  historicalSuffixConsumedFrames

  supportComplete
  actionSupportComplete[2]
  hiddenWorldSupportComplete
  chanceSupportComplete
  observationPartitionComplete[2]
  capacityComplete
  searchComplete
  strategyConsistent[2]

  avoidabilityLabel
  robustScope
  terminalOutcomeInterval
  valueLower/valueUpper
  selectedActionPolicyRef
  proofStatus
  coverageCertificateRef
  refutationWitnessRefs[]
  escapeWitnessRefs[]
  traceResponseWitnessRefs[]

  nodes/transitions/worlds/chance/observations
  elapsedMicros
  peakArenaBytes
  cacheStatsRef
  resultHash
}
```

概率、confidence 和 rate 使用 `Q0_10000` 整数或整数分子/分母；wall-clock 统计使用整数微秒。离线报告可以渲染小数，但 canonical result 不以 float 表示语义。

## 10. 可避免性与严格标签

标签按受控方 perspective 计算，交换 sides 后定义不变：

### 10.1 TRACE_AVOIDABLE

在 factual checkpoint 对平台实际下一回应 witness，至少一个共同可提交动作在声明 horizon 内改善为非输/延后失败。它只反驳“历史动作是唯一可能”，不能证明面对其他合法回应安全。

### 10.2 MODEL_AVOIDABLE

对 `TraceOpponentProfile` 或通用 OpponentModel 的完整 nominal support，某动作的 robust/expected 值改善。它可校准 Risk/Eval/OpponentModel，不得进入 Hard/Proof。

### 10.3 ROBUST_AVOIDABLE

必须由 DD6 量词直接产生，不由胜率阈值产生：

- 存在受控方 observation-consistent 的共同 action/policy；
- 对所有合法敌方 response policy、HiddenWorld、ChanceOutcome 和 observation successor 覆盖；
- `supportComplete/capacityComplete/searchComplete/strategyConsistent` 全真；
- RuleVariant 无分歧且 `ruleAssumptionMask=0`；
- 完整终局/frame-limit horizon 得到 `FORCED_NONLOSS_PROVEN`，或 committed deadline horizon 得到明确 `SafetyCertificate`。

结果必须用 `robustScope=FULL_GAME_NONLOSS` 或 `COMMITTED_DEADLINE_SAFETY` 区分。后者不能冒充全局不会死亡。

### 10.4 STRICT_UNAVOIDABLE

严格使用 [proof-search-contract.md](proof-search-contract.md) 的 `FORCED_LOSS_PROVEN`/`InevitableLossCertificate`，不重写成逐 action 各挑一个敌方 column：

- simultaneous 节点必须存在一个单一、可提交且 observation-consistent 的敌方 response policy，同时击败受控方全部 rows；
- sequential 节点只允许 policy 使用当时已获得的 observation；
- HiddenWorld 和 ChanceOutcome 要求完整 support 的 AND 覆盖；
- full game/frame-limit 可生成 `FORCED_LOSS_PROVEN`；已提交危险在有限 deadline 内对所有双方动作均 LOSS 时可生成更强的 `InevitableLossCertificate`；
- incomplete leaf、heuristic、概率剪枝或 per-row 不同敌方 response 都返回 UNKNOWN。

`FORCED_LOSS_PROVEN` 是对手有战略强制路线，不自动等于 root action 的 Hard reject；只有更强的 InevitableLoss/committed death chain 才可进入 Hard 候选。

### 10.5 UNKNOWN 与并列证据

规则、重建、support、容量、时间或搜索闭合任一不足，主标签为 `UNKNOWN`。`ACTION_REFUTED`、`TRACE_AVOIDABLE` witness、Value 改善可以并列保存，但不能覆盖 UNKNOWN。

概率 99%、风险 0 或对手极少选择某动作都不能改变 strict 标签量词。

## 11. 双向死亡与击杀分析

每个可用死亡窗口至少运行两个 perspective：

1. 历史死亡方：寻找最后可避免决策和 point of no return；
2. 历史获胜方的对手：从被击杀方视角寻找逃生/反击，检查原 KillWindow 是否真正 forced。

结果组合：

| 我方历史死亡可避免性 | 历史敌方死亡可避免性 | 解释 |
|---|---|---|
| robust avoidable | — | v1 存在结构性死亡陷阱候选 |
| trace/model only | — | 风险/对手模型问题，不是 Hard 漏洞 |
| strict unavoidable | — | 更早窗口或战略起点才可能可改 |
| — | enemy robust avoidable | 我方击杀依赖对手失误，不是 ForcedWin |
| — | enemy strict unavoidable | 可进入正向 forced-kill fixture 候选 |

反向模拟不要求可执行历史敌方源码。缺源码时可用 replay factual prefix、双方 ObservedTrack、通用 search/best response；结果 provenance 不能写 `EXACT_LEGACY_SOURCE`。

## 12. 模块准入矩阵

| 结果 | Rule/Terminal | Hard/Hazard | Proof | Risk/Eval | Opponent | 正向回归 |
|---|---|---|---|---|---|---|
| factual exact repeated platform event | 候选，仍需 RuleRegistry 门 | fixture 候选 | 否 | 可 | 可 | 可 |
| TRACE_AVOIDABLE | 否 | 否 | 否 | 可 | 可 | 可 |
| MODEL_AVOIDABLE | 否 | 否 | 否 | 可 | 可 | 可 |
| ROBUST deadline safety | 否 | Safety fixture | SafetyCertificate | 可 | 否 | EscapeWindow |
| ROBUST full nonloss | 否 | 否 | ForcedNonloss fixture | 可 | 否 | 可 |
| STRICT ForcedLoss | 否 | 不自动进入 Hard | ForcedLoss fixture | 可 | 否 | 可 |
| InevitableLoss committed chain | 否 | Hard 候选，仍经 DD5 | Proof fixture | 可 | 否 | DeathWindow |
| UNKNOWN | 否 | 否 | 否 | 仅带限制诊断 | 否 | 不作通过 |

平台规则只能经 DD4 RuleCorpus 的来源等级升级；counterfactual runner 不能自行修改 Ruleset。

## 13. 高性能离线执行

反事实不进入 3 秒生产路径，但 244 局 × 双向 × 多 action/world 仍必须高效：

- raw replay 只解析一次，生成按 match/frame offset 的整数列式 trace；
- static map/terrain 按 `mapHash` 去重，动态实体和 event 使用紧凑数组；
- checkpoint 保存 canonical base + delta/offset，不复制完整对象图；
- factual prefix snapshot 按稳定间隔和事件点缓存，分叉后使用 DD5 BranchMark apply/undo；
- 相同 engine manifest + checkpoint + request 才可复用结果；Rule/Proof/Feature 改版按 dependency 精确失效；
- ReferenceKernel 负责 correctness oracle，批量搜索可用 FastKernel；每个 fixture 和抽样 checkpoint 先做 Reference/Fast 差分；
- 按 correlation group 确定性分片；可在离线 worker/process 间并行，但每个 result seed/order 固定且合并顺序稳定；生产 bundle 仍单线程；
- 先运行 cheap factual/window 索引，再按优先队列运行 expensive robust/strict；预算不足输出 UNKNOWN，不降格标签；
- FeatureRegistry 的 raw feature 可离线保存，使纯权重 calibration 只重算整数点积；Hard/Rule/State/Search 变化必须重新跑对应 branch，不能复用旧结论；
- cache、trace、报告均在离线目录，production strip 测试必须证明不可达。

必须分别报告 parser、reconstruction、Reference、Fast、Proof 和 report 时间；不得把离线吞吐混入生产 nodes/ms。

## 14. 测试矩阵

实现至少覆盖：

- factual prefix 完全一致与单 phase mismatch；
- 分叉后尝试消费 replay suffix 必须 assertion fail；
- TruthTrack 隐藏值变化但 ObservedTrack 相同时 action 不变；
- projectile、bomb、overload 双弹、shield 两 hit、grass/cloak、teleport；
- 同星对枪、128 帧、timeout、runTime、同时击毁；
- simultaneous per-row-different-column 陷阱不得产生 StrictUnavoidable；
- enemy information partition strategy-fusion 陷阱；
- committed deadline Safety 不升级 full ForcedNonloss；
- v20 exact adapter hash pass，v21/v22/v24 label/hash mismatch 拒绝 exact；
- perspective swap 后 WIN/LOSS、avoidability 和证书对称；
- Discovery/Calibration/Frozen/Forward 读取权限和结果污染故障注入；
- Reference/Fast result、source/minified harness 和 cache-off 差分。

## 15. 当前执行状态

| 项目 | 状态 |
|---|---|
| schema、量词、分叉和准入合同 | DESIGN_COMPLETE |
| 244 局 immutable input/split | DESIGN_COMPLETE_AND_HASHED |
| DualTrackReconstructor | NOT_IMPLEMENTED |
| WindowExtractor | NOT_IMPLEMENTED |
| BidirectionalCounterfactualRunner | NOT_IMPLEMENTED |
| v20 Exact LegacyPolicyAdapter | SOURCE_AVAILABLE_NOT_IMPLEMENTED |
| v2 Reference/Fast/Proof integration | NOT_IMPLEMENTED |
| counterfactual result corpus | NOT_RUN |
| production strip verification | NOT_RUN |

因此 DD9 可以完成详细设计阶段，但不能把任何未来 runner 结果、性能或发布门写成当前 PASS。
