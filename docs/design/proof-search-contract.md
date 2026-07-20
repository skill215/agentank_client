# DD6 InformationState Proof 与 DFPN 合同

状态：DD6 规范合同，2026-07-15。冻结 ForcedWin、ForcedNonloss、ForcedLoss、ActionRefuted 的 InformationState 量词、AND/OR 展开、observation strategy consistency、DFPN completion 和 CoverageCertificate。

关联：`DEC-0001` 至 `DEC-0005`、`DEC-0014`、`DEC-0029`、`DEC-0031`、`DEC-0041`、`DEC-0050`；[terminal-proof-algebra.md](terminal-proof-algebra.md)、[hazard-kernel-contract.md](hazard-kernel-contract.md)、[information-state-storage-contract.md](information-state-storage-contract.md)。

## 1. 四种结论不能混用

```text
FORCED_WIN_PROVEN
  存在一个遵守我方观察的 policy，使全部敌方 policy/world/chance 终局 WIN。

FORCED_NONLOSS_PROVEN
  存在一个我方 policy，使全部覆盖分支终局 WIN 或 DRAW。

FORCED_LOSS_PROVEN
  存在一个遵守敌方观察的 policy，使全部我方 policy/world/chance 终局 LOSS。

ACTION_REFUTED
  至少一个合法反例使某个 ActionKey 失败；只反驳该 action。
```

`InevitableLoss/HARD_REJECT_PROVEN` 仍是更强的“所有敌方 policy也无法阻止我方 LOSS”，由 DD1/DD5 管理。战略 ForcedLoss 可能依赖敌方主动最佳回应，不能自动升级为 Hard。

## 2. 数学量词

对 InformationState `I`：

```text
ForcedWin(I) iff
  exists observation-consistent our policy pi
  for every observation-consistent enemy policy sigma
  for every HiddenWorld w in complete support(I)
  for every ChanceOutcome c in confirmed conditional support
    TerminalOutcome(I,pi,sigma,w,c) = WIN

ForcedNonloss(I) iff same quantifiers, outcome in {WIN,DRAW}

ForcedLoss(I) iff
  exists observation-consistent enemy policy sigma
  for every observation-consistent our policy pi
  for every HiddenWorld w
  for every ChanceOutcome c
    outcome = LOSS
```

概率大小不出现在量词中。一个 support member 即使 probability=1/10000，也必须覆盖；概率未知但 support complete不阻塞 universal Proof。

## 3. Strategy consistency

### 3.1 我方

同一我方 observation history 下，所有 world 使用同一个 ActionKey。物理后继先产生，再按我方真实 observation relation分组；只有 observation不同，未来 policy才可分叉。

### 3.2 敌方

`enemyInformationPartition` 定义敌方不可区分 worlds。同一 enemy information set必须使用同一 ActionKey；不同 set可使用不同动作。敌方 response policy：

```text
beta: enemyInformationSetId -> ActionKey
```

惰性枚举 beta prefix，遇到反例短路。禁止预先构造全笛卡尔积，也禁止同一 set按真实 world选择动作。

### 3.3 Chance 和 HiddenWorld

HiddenWorld 是事实量词，ChanceOutcome 是规则随机量词；它们不共享 policy、不共享概率表，也不与 RuleVariant混合。未冻结 RuleVariant 直接使 strict Proof UNKNOWN。

## 4. 节点组合表

| Node | ForcedWin | ForcedNonloss | ForcedLoss |
|---|---|---|---|
| terminal | WIN | WIN/DRAW | LOSS |
| OUR_DECISION | OR common action | OR | AND all legal action |
| ENEMY_DECISION | AND all legal response | AND | OR response |
| SIMULTANEOUS | exists one row, all columns | same | exists one column, all rows |
| HIDDEN_WORLD | AND complete support | AND | AND complete support |
| CHANCE_RESOLUTION | AND nonempty support | AND | AND nonempty support |
| AUTOMATIC_FRAME | child | child | child |
| OBSERVATION_SPLIT | AND branches；分裂后各自 policy | same | AND branches with side partitions |

simultaneous ForcedLoss 不能写成“对每个我方 row各找一个敌方 column”；必须存在一个敌方可提交 column/response policy同时击败全部 rows。ForcedWin 对称地必须存在一个我方 row覆盖全部敌方回应。

## 5. Proof 图构造

```text
ProofNodeKey
  decisionHash
  proofGoal
  actor/nodeKind
  observationPartitionVersion
  action/response prefix signature
  horizonKind/endFrame
  ruleset/terminal policy/support versions
```

展开：

1. 检查 resolved terminal；
2. 复用 assumption-free DD5 Hard/viability certificate；
3. 生成完整合法 action family或明确 incomplete；
4. 对 simultaneous/信息态惰性生成 row、beta prefix、world、chance；
5. Fast apply，完整 committed closure，生成 observation relation；
6. 按 observation history canonicalize successor InformationState；
7. 按 goal的 AND/OR 规则挂 child；
8. branch 完成后 undo并核验 root。

重复 Physical/InformationState 只有平台确认 repetition终局规则时才能闭合；当前无此规则，cycle/transposition只复用已证明结果，不能自行判 DRAW。

## 6. ImmediateProof、AND/OR DFS 与 DFPN

### 6.1 ImmediateProof

优先处理有限且可闭合的：

- 已提交 projectile/bomb 的无逃生 terminal；
-直接必杀且对手在impact前无所有合法闪避；
-最后 record 的 forced star/runtime outcome；
-唯一拿星/阻止拿星后立即 terminal；
-技能当前已提交效果造成的有限终局链。

所有直接击杀仍运行 DD5 ReverseViability；距离阈值只排序，不证明。

### 6.2 AND/OR DFS

显式 ProofFrame 栈保存：goal、node kind、child cursor、proof/disproof aggregate、BranchMark、coverage cursor。顺序：已有反例、PV、低分支因子、deadline近、历史 refutation hint；顺序不影响量词。

### 6.3 DFPN completion

接近闭合但 DFS预算不足的 frontier进入 DFPN：

```text
OR node:  pn = min child.pn, dn = saturatedSum child.dn
AND node: pn = saturatedSum child.pn, dn = min child.dn

proven     pn=0, dn=INF
disproven  pn=INF, dn=0
unknown    pn>=1, dn>=1
```

ForcedLoss 使用其转换后的 AND/OR 图，同一公式不复制第二套代码。计数饱和到 `PN_INF`，饱和只影响选择优先级；不能因饱和生成 proof。DFPN threshold 和 frontier由固定 TypedArray存储，任意中断只保留零值已闭合结论。

## 7. Horizon

严格 Proof 只允许：

```text
HORIZON_TO_TERMINAL
HORIZON_TO_FRAME_LIMIT
HORIZON_TO_COMMITTED_DEADLINE  // 仅 Hard/InevitableLoss/Safety，不授予 full ForcedNonloss
```

非终局 depth leaf使 ForcedWin/Nonloss/Loss=UNKNOWN。`FORCED_NONLOSS_PROVEN` 要求完整游戏闭合到终局/frame limit；只证明 committed deadline前存活输出 SafetyCertificate。

## 8. CoverageCertificate

除 DD1 字段外，DD6 compact coverage 必含：

```text
proofGoal
rootDecisionSignature
ourInformationHistoryVersion
enemyInformationPartitionVersion
allOurActionFamiliesCovered
allEnemyResponsePoliciesCovered
allExactWorldsCovered
residualIteratorComplete
allChanceSupportCovered
allObservationPartitionsCovered
allTerminalBatchesComplete
noHeuristicPruning
noProbabilityPruning
noUnknownRule
noCapacityTruncation
strategyConsistent
horizonKind/endFrame
ruleset/phase/terminal versions
assumptionMask
canonicalTraceRoot
```

strict status要求所有 coverage true且 assumptionMask=0。CoverageArena不足、handle stale或compact signature核验失败时 Proof=UNKNOWN。

## 9. Proof 与 Value 的单向关系

- Proof可以把 Value terminal interval收紧到确定边界；
- Value只有在完整量词覆盖、无heuristic/probability pruning、证书完整时才能向ProofCache写严格结果；
- Value的高分、expected=10000、robust=10000或pure bounds相等都不能单独生成Proof；
- ACTION_REFUTED只以 `(DecisionHash,ActionKey,witness signature)`缓存；
-“所有当前 top-K action被反驳”不等于状态ForcedLoss。

## 10. ForcedWin 优先和根决策

根流程：

1. 对 Hard-allow且触发ImmediateProof的action尝试ForcedWin；
2. 任一 assumption-free `FORCED_WIN_PROVEN` 立即成为 deterministic policy；
3. 多个ForcedWin按最短terminal、资源保留、runtime成本等不改变胜负的稳定tie-break；
4. 无ForcedWin才进入Value/Risk matrix；
5. ForcedLoss proven但非InevitableLoss时，Value可选择对手失误时胜率更高的防守；
6. 全Hard rejected使用ForcedLossRecovery，保留原因。

## 11. UNKNOWN 与反例

以下任一项使严格目标UNKNOWN：

- rule/support/observation relation未知；
- action/world/chance/residual/response prefix容量不足；
-启发式或概率剪枝；
- continuation basis代替完整terminal；
- strategy fusion guard失败；
- cache命中未核验canonical signature；
- search/time中断前未闭合；
- USER_CONFIRMED assumption未升级。

仍可保存合法 ActionRefuted witness供排序、风险和DD9反事实，但不能作为普遍结论。

## 12. 性能合同

- ProofFrame/DFPN node/edge/response-prefix/Coverage均预分配TypedArray SoA；
-先用Hard、terminal、transposition和反例短路；
- beta prefix惰性展开，不materialize策略笛卡尔积；
- exact worlds直接迭代，residual用lossless cursor；
-相同 observation relation用direct-address accumulator+touched list分区；
- ProofCache只保存compact status/certificate fields，不保存arena handle；
- time只在固定node batch由外层控制器中断；
-容量不足UNKNOWN，不裁support；
- risk、opponent probability、evaluator、Plan score和wall clock不得被ProofKernel读取。

## 13. 必须测试

- one-row-all-columns ForcedWin；
- per-row-different-column陷阱不产生ForcedLoss；
- HiddenWorld strategy fusion trap；
- enemy partition一致性及不同set分叉；
- chance support概率未知但Proof不变；
- low-probability residual反例阻止Proof；
- observation split前共同action、分裂后独立policy；
- ACTION_REFUTED不升级state loss；
- committed deadline safety不升级ForcedNonloss；
- mutual crash terminal tiebreak；
- unknown rule/capacity/assumption导致UNKNOWN；
- DFPN/DFS结果一致，任意中断无false positive；
- source/minified/cache-off-on Proof/Coverage fingerprint一致。

## 14. 冻结结论

ForcedWin 已成为 InformationState 上真正的 AND/OR policy proof：我方与敌方都服从各自观察，world/chance完整覆盖，分裂前不融合策略。DFPN只补全同一量词图，不会把深度值、概率或单条击杀线包装成证明。
