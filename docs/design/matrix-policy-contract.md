# DD6 关键节点矩阵与 Policy 合同

状态：DD6 规范合同，2026-07-15。冻结同时行动 pure 包络、关键节点选择、受限矩阵/Double Oracle、整数 regret、public-belief 受限求解和 mixed-policy 输出。

关联：`DEC-0002`、`DEC-0007`、`DEC-0033`、`DEC-0040`、`DEC-0041`；[value-search-contract.md](value-search-contract.md)、[action-result-abi.md](action-result-abi.md)、[information-state-storage-contract.md](information-state-storage-contract.md)。

## 1. 为什么只在关键节点求矩阵

所有同时行动节点都先计算 pure interval；只有以下任一条件成立才建立 restricted matrix：

- 根节点；
- pureLower/pureUpper gap 大于 profile tolerance 且可能改变根 policy；
- RPS/互相克制/对枪等检测到非纯鞍点；
- ForcedWin/唯一安全动作尚未决定，mixed policy 可改善 security；
- Active Plan 与 best response形成关键冲突；
-上层 dependency明确要求收紧该 child。

深层普通节点返回 pure interval。SearchProfile 只控制关键节点额度、矩阵容量和 iteration；不改变同一个 matrix cell 的物理/风险语义。

## 2. Cell 和 StageMatrix ABI

```text
StageMatrixRecord
  state/valueSearch signatures
  ourActionSetSignature
  enemyActionSetSignature
  ourRestrictedStart/count
  enemyRestrictedStart/count
  cellStart/count
  iteration/expansionCount
  lower/upper/gap
  ourPolicyHandle/enemyPolicyScratch
  completeness flags

MatrixCell
  ourActionKeyLo/Hi
  enemyActionKeyLo/Hi or enemyPolicyPrefixKey
  lower/upper
  expectedLower/upper
  robustLower/upper
  boundKind
  resultHandle/flags
```

cell value 是 [risk-backup-contract.md](risk-backup-contract.md) 已按 nature/hidden 递归聚合后的 interval；MatrixSolver 不再次对 child 做 risk backup。

## 3. Pure 包络与鞍点

```text
pureLower = max_a min_b L[a,b]
pureUpper = min_b max_a U[a,b]
```

存在单一 row `a*` 和 column `b*`，并有 complete dependency 使：

```text
min_b L[a*,b] == max_a U[a,b*]
```

时得到纯鞍点，输出 deterministic policy。只比较当前 materialized cells 不足以证明鞍点；未扫描 action必须有 Hard/equivalence/dominance/upper certificate。

## 4. 受限动作集初始化

初始我方/敌方集合按稳定 ActionKey 顺序合并去重：

- previous depth/TT/PV action；
- pure lower row 与 pure upper witness；
- ImmediateProof/Hard 相关 action；
-每个硬安全战术 family至少一个代表；
- Active Plan continue/cancel；
- cheap feature upper 最优；
-对手模型最高概率回应；
-历史先验只可提供 ordering，不可成为唯一代表。

初始集不是最终 top-K。所有合法 action仍保留在完整 action arena，best-response scan可重新加入。

## 5. Double Oracle 的严格区间

设当前受限集合 `A'⊆A`、`B'⊆B`，求得平均策略 `p`、`q`：

```text
stageLower(p) = min_{b in B} sum_{a in A'} p[a] * L[a,b]
stageUpper(q) = max_{a in A} sum_{b in B'} q[b] * U[a,b]
gap = stageUpper - stageLower
```

lower 扫描完整敌方 action set；upper 扫描完整我方 action set。扫描中尚未 materialize 的 cell按其 sound interval求值或保留 wide bound，不能假设为零。

每轮：

1. 在 `A'×B'` 上运行固定 batch 整数 regret solver；
2. 对平均我方策略做完整敌方 best response scan，收紧 stageLower；
3. 对平均敌方策略做完整我方 best response scan，收紧 stageUpper；
4. 将能严格改善 bound/gap 的 best response加入受限集；
5. 若无新 action但 gap非零，继续 solver batch或返回 approximate interval；
6. 容量/时间不足发布当前 sound interval，不丢弃已完成策略。

`stageLower==stageUpper` 只有两侧完整 scan、依赖 cell complete、外扩量化 residual为零/已计入时才 exact。

## 6. 整数 Regret Solver

production 首选 regret matching+：

```text
regret[a]       Int32/Int53-safe scalar array
strategySum[a]  Uint32/Int53-safe accumulator
weightSum       Uint32/Int53-safe
currentStrategy ProbabilityT scale 10000
```

每 iteration 对双方执行：

```text
positiveRegretSum = sum(max(regret,0))
if positiveRegretSum == 0:
  uniform over legal restricted actions, stable remainder by ActionKey
else:
  probability = outward/stable integer normalization

compute action utilities from interval policy selected by solver mode
regret = max(0, regret + actionUtility - policyUtility)
strategySum += iterationWeight * currentStrategy
```

最终输出 average strategy，不输出最后 iteration strategy。若 interval cells 非 exact，solver 分别维护 pessimistic lower game 与 optimistic upper game，或使用 interval best-response验证；不得在单一 midpoint game 上生成 sound gap。

累加器的最坏值由 manifest公式验证小于 `Number.MAX_SAFE_INTEGER`；到达生成阈值时按公因数/固定右移重标，双方和 source/minified使用相同 deterministic规则。

固定 iteration 数只产生可复现近似，不产生 exact/complete。2×2 闭式/枚举 solver可以作为构建专门化，但必须通过同一 outward interval comparator。

## 7. Risk-transformed 敌方层

敌方 ε-contamination 使用一个等价变换后的 matrix：

对每个我方 pure row `a`：

```text
nominalRow[a] = sum_b qNominal[b] * natureRobustCell[a,b]
riskCell[a,b] = lambdaEnemy * nominalRow[a]
                + (10000-lambdaEnemy) * natureRobustCell[a,b]
```

MatrixSolver 只对 `riskCell` 求一次 zero-sum value：

```text
max_p min_b sum_a p[a] * riskCell[a,b]
= max_p [lambdaEnemy * E_qNominal(value)
         + (1-lambdaEnemy) * min_b valueAgainst(b)]
```

因此 nominal 对手与最坏回应没有被先混一次、根部再混一次。lambda、外扩公式和未知概率行为由 Risk 合同拥有。

## 8. InformationState/Public-Belief 受限求解

完全物理矩阵的 column 是 EnemyAction；多敌方 information set时 column 是响应策略前缀：

```text
betaPrefix = [(enemyInfoSetId, ActionKey), ...]
```

惰性展开规则：

- 只在访问到某 enemy information set时选择/绑定 action；
-同一 prefix 中重复 infoSet必须使用同一 ActionKey；
-不同 infoSet可独立选择；
- prefix cache key包含 partition version、已绑定 pair和待展开 cursor；
-反例短路后无需 materialize其余笛卡尔积；
-完整性证书必须证明所有仍可改变 bound的响应前缀已扫描。

受限 public-belief regret：

- regret key=`informationSetId + ActionKey`；
- belief reach与player reach分离；
-使用 counterfactual reach更新；
-不 sample world/chance；
-输出每个 information set平均策略和根可提交 policy；
- depth leaf continuation basis只能给 Value，不给 Proof；
-一个 decision-equivalent class时立即降级 Physical matrix。

## 9. Policy 输出

根 policy写入唯一 PolicyArena：

- probability scale=10000；
-最大余数法量化，remainder按 ActionKey字典序；
-0概率不写；总和必须10000；
-deterministic也是单 entry/10000；
-ForcedWin proven动作、唯一 Hard-allow动作和 ForcedLossRecovery deterministic，不随机；
-mixed只在根验证后推进一次 XORSHIFT32_V1；
-cache保存 PolicyKey和entries，不保存易失 PolicyHandle/ActionRef。

受限 solver approximate policy必须带 gap和policyFlags；emitter可使用最后完整 policy，但不能把 approximate标为 equilibrium exact。

## 10. Root safe floor 与 expected tie-break

矩阵根先求递归 robust objective的 certified `safeFloor`，再从满足：

```text
candidate.robustLower >= safeFloor
```

的 policy中最大化 nominal expected lower/estimate。DD6 V1 的 `allowedExploitLoss=0`；risk参数只通过递归 lambda表控制，不再生成第二个根风险预算。

若没有候选被完整证明满足 floor，返回生成 safeFloor的baseline policy。Expected tie-break不能降低已认证 robust floor，不能重新构造 RiskMatrix，也不能使用对手名字/单局日志做硬约束。

## 11. 性能与容量

- matrix/cell/regret/policy scratch全部 TypedArray SoA，按 depth slot复用；
-只 materialize受限行列和BR需要的cells；
-对固定 policy的BR scan按ActionKey稳定遍历，可用cell缓存但miss重算；
- touched list+generation清理，不全表 memset；
-每个 solver batch固定 iteration数，batch边界检查外层中断flag；
- root与关键节点额度由SearchProfile，不在节点读wall clock；
- matrix capacity不足返回当前interval/gap，禁止裁action后宣称完整；
- cache与warm start只能改善速度，不改变初始zero-regret运行的语义结果。

## 12. 必须测试

- RPS输出近1/3分布，pure interval包含0；
- Matching Pennies值/策略镜像；
- dominated-support trap不会被初始top-K永久删除；
- restricted lower/full enemy BR与restricted upper/full our BR方向正确；
- midpoint regret不能冒充interval gap；
- fixed-point量化不产生伪gap=0；
- action-dependent chance/hidden support逐cell独立；
-同enemy info set策略一致、不同info set可分叉；
-中断/容量不足发布sound interval与last complete policy；
-safeFloor tie-break不降低robust lower；
- deterministic/mixed PRNG、source/minified和cache-off/on可复现。

## 13. 冻结结论

根 regret matching 已扩展为“关键节点受限矩阵求解”，但完整 action set始终可通过best response重新进入。矩阵只求一次递归 risk-transformed game；根 expected利用只是零损失safe-floor内的tie-break，不再叠加第二套风险公式。
