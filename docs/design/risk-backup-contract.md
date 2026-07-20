# DD6 递归 ε-contamination Risk 合同

状态：DD6 规范合同，2026-07-15。冻结 0–100 风险参数、HiddenWorld/ChanceOutcome/EnemyAction 三维递归鲁棒备份、动态 stateRiskClass、整数外扩和根 safe-floor 关系。

关联：`DEC-0002`、`DEC-0003`、`DEC-0008`、`DEC-0016`、`DEC-0024`、`DEC-0049`；`OI-R3-001`、`OI-ARCH-009`；[matrix-policy-contract.md](matrix-policy-contract.md)、[hazard-kernel-contract.md](hazard-kernel-contract.md)、[cache-contracts.md](cache-contracts.md)。

## 1. 目标

风险只优化我方视角的终局/continuation utility：

- risk=0：每个不确定维度采用最坏支持，完全规避可见的可能损失；
- risk增大：更多依赖 nominal belief/对手行为，允许抢位置、抢先开火和技能投入；
- risk=100：每个启用维度 expected weight最多9900，仍保留至少1%的最坏污染；
- Hard/Terminal/Proof 永远在 Risk 之前，风险不能覆盖已证明失败或强制胜利。

`99%` 是鲁棒算子中的 nominal weight上限，不是“真实胜率至少99%”的统计保证。没有校准概率和置信区间时不得把它写成 chance constraint。

## 2. 三个量词、三个备份维度

```text
RISK_DIM_CHANCE_OUTCOME
RISK_DIM_HIDDEN_WORLD
RISK_DIM_ENEMY_ACTION
```

它们不能合成一个 ScenarioGroup：

- Chance：规则在固定 world/joint action下的随机 support；
- HiddenWorld：当前 observation一致的物理事实 support；
- EnemyAction：对手根据其 information partition选择的战略 action/policy。

技能不是第四种量词。技能的不确定性落在 enemy action、chance outcome或hidden state；技能资源投入、信息暴露等可作为 DD7 feature/stateRiskClass维度，但不能再包一层无语义的概率平均。

## 3. RiskProfile 表

根每次搜索冻结：

```text
baseRisk                         RiskT 0..100
RiskProfileId
riskTableVersion
stateRiskClassifierVersion
dimensionExpectedWeight[profile][stateClass][3]  ProbabilityT
```

规范初始候选：

```text
baseExpectedWeight(risk) = 99 * risk   // 0..9900
```

每个 stateClass 可通过构建期整数表保守下调各维权重，不得超过9900。对同一 stateClass，risk增加时每个 weight必须单调不减；risk=0强制三维权重均0。

具体表值属于 R3 校准，DD6 冻结的是端点、单调性、尺度和调用方式。表缺失/越界使 Value incomplete，不回退浮点默认。

## 4. 动态 stateRiskClass

节点内风险动态变化只允许纯函数：

```text
stateRiskClass = classify(
  star lead / terminal tiebreak relation,
  frames and action opportunities to terminal,
  committed deadline slack,
  action reversibility,
  observation uncertainty class,
  resource/skill commitment class)
```

分类器只读 SearchState的整数派生字段，不读当前访问顺序、当前best value、wall clock、对手名字或日志。相同 state/profile必须得到相同 class/weights。

领先且接近不可逆终局可下调expected weight；落后且只剩逆转窗口可上调到base允许范围；同星/runtime不利的保守 policy仍先由Hard/Terminal处理，不能靠risk掩盖。

## 5. 单维 ε-contamination 算子

对 support `i`、nominal probability `p_i`、child interval `[L_i,U_i]`、expected weight `lambda`：

```text
E_L = floor(sum(p_i * L_i) / 10000)
E_U = ceil (sum(p_i * U_i) / 10000)
W_L = min_i L_i
W_U = min_i U_i

rhoLower = floor((lambda * E_L + (10000-lambda) * W_L) / 10000)
rhoUpper = ceil ((lambda * E_U + (10000-lambda) * W_U) / 10000)
```

这是我方效用下的 lower-tail contamination。若 nominal probability是区间，则先在线性约束集合上求 `E_L/E_U`；若 support不完整，保留wide interval/incomplete。所有除法使用 BoundFixedMath向外取整。

算子性质：

- 单调：child变好不会使结果变差；
- translation/scale在定点范围内一致；
- lambda=0 等于support worst；
- lambda=10000 等于nominal expected，但生产表禁止达到10000；
-同一 input/table确定性；
-输出仍在 `[min L, max U]` 内。

## 6. 递归顺序与动态一致性

对我方 action `a`、敌方 response `b`：

```text
for each HiddenWorld w:
  enumerate ChanceOutcome c conditioned on (w,a,b)
  apply Fast and partition successors by actual observation
  recursively solve each successor InformationState
  chanceValue[w,a,b] = rho_chance(children)

natureCell[a,b] = rho_hidden(chanceValue over complete worlds)
```

observation partition发生在 child policy选择之前：同一 observation group复用一个 child InformationState value，避免world-specific strategy fusion。

每个节点使用 rectangular uncertainty set：各 state-action 条件分布独立受本节点 ε-contamination约束。这样 risk在递归中动态一致；禁止先把整条path概率相乘后只在根做一次worst/expected混合。

## 7. EnemyAction 风险与矩阵

OpponentModel给出每个敌方 information class 的 nominal `q[b]`。对 pure row：

```text
nominalEnemyRow[a] = sum_b q[b] * natureCell[a,b]
riskCell[a,b] = rho_enemy equivalent
              = lambdaEnemy * nominalEnemyRow[a]
                + (10000-lambdaEnemy) * natureCell[a,b]
```

外扩分别对lower/upper执行。随后 StageMatrixSolver只求一次：

```text
max_our_policy min_enemy_response E_our[riskCell]
```

该变换恰好表示“nominal enemy + ε arbitrary enemy response”的污染集合。MatrixSolver不得再次混合 q，根也不得再次对 `robustValue`应用同一风险公式。

多 enemy information set时 `b` 是 observation-consistent response policy/prefix；nominal q按partition条件生成，不能跨set共享一个动作分布。

## 8. Expected、Worst、Robust 三结果

```text
worstValue
  complete possibility/enemy/chance support上的security worst；缺覆盖为UNKNOWN。

expectedValue
  nominal hidden/chance/enemy模型下的递归期望；概率资格不足为UNKNOWN/interval。

robustValue
  本合同三维递归rho后的唯一主风险值；Result中只保存一次。
```

RiskProfile只优化 robustValue。Expected用于诊断、tie-break和DD7策略解释；Worst用于证书/safe floor。三个值不能互相回填。

## 9. Root safe exploitation：关闭重复风险

DD6 V1 使用单一主目标 + 零损失 tie-break：

1. 递归 risk solver得到 baseline policy及其 certified `safeFloor=robustLower`；
2. candidate只有 `candidate.robustLower >= safeFloor` 才可进入利用集合；
3. 集合内最大化 nominal expected lower/point，稳定tie-break；
4. 无候选可证明满足时返回 baseline；
5. `allowedExploitLoss=0`，不从同一个risk参数再派生根损失预算。

因此 RiskMatrix 与 root safe exploitation不再重复施加两套准则。未来若要允许牺牲 robust floor换expected，必须新增独立参数/decision和性质测试，不能悄悄复用0–100 risk。

## 10. 对手风险喜好

对手风险偏好估计只影响 nominal `q(enemyAction | informationClass, sharedFeatures)`：

-事件可包括有机会时是否开火、抢位、转向、拿星、技能使用和资源承诺；
-一局内动态更新对手参数/confidence；
-不改变我方 RiskProfile/feature weights；
-confidence低时 q向通用先验/宽区间回退，robust污染仍保留；
-不进入 Hard、Proof、PhysicsHash或 possibility support。

具体事件/更新公式属于 DD7 opponent-model contract。

## 11. 数值、性能与缓存

- probability/risk/value全部整数；不使用Float32/Float64；
- weighted sum最坏值和support count由manifest证明小于`Number.MAX_SAFE_INTEGER`；超界使用分块外扩累加或构建失败；
-相同support的nominal sum与worst可一次扫描同时计算；
- chance、hidden、enemy三维用固定small loop和cursor，禁止对象scenario group；
- unknown probability interval求解使用小型排序/水填充整数算法，排序key稳定；
- risk table lookup O(1)，stateRiskClass每node最多计算一次；
- ValueSearchKey必须含RiskProfileId、stateRiskClass、riskTableVersion、OpponentModelEpoch、belief version；
- DecisionHash/ProofCache禁止含risk/opponent probability；
- cache hit返回robustValue前核验上述key；cache off语义相同。

## 12. Incomplete 行为

| 缺口 | 输出 |
|---|---|
| chance support未知 | wide interval + UNKNOWN_RULE；Proof unknown |
| chance概率未知、support完整 | probability-set expected interval + robust interval |
| hidden residual未完成 | incomplete；不得裁低概率world |
| opponent q/confidence不足 | q interval/通用先验 + robust外扩；不可exact expected |
| risk table/profile缺失 | incomplete；不默认risk=0/100 |
| matrix/iteration/time不足 |当前robust interval + gap/last policy |
| Hard/Terminal incomplete |先传播，不由risk填值 |

## 13. 必须测试

- risk=0 在chance/hidden/enemy三维都等于worst；
- risk=100 每维lambda=9900上限且保留污染；
- 0..100同stateClass单调；
- stateRiskClass deterministic且领先/落后表不越base范围；
- action-dependent chance概率不共享；
- hidden/chance/enemy交换顺序会不同的fixture验证规范顺序；
- observation split禁止strategy fusion；
- probability interval/outward rounding包含高精度离线Oracle；
-嵌套rho不会在根重复；
-safe-floor expected tie-break不降低certified robust lower；
- opponent model epoch只改变Value，不改变Hard/Proof；
- source/minified/cache-off-on robust interval/policy一致。

## 14. 冻结结论

风险已经从“打分里加一个危险权重”升级为每个节点、每个条件support上的递归鲁棒算子。三种不确定性保留独立量词，动态变化由纯整数state class表控制；根只在同一robust floor内利用对手模型，彻底消除第二次风险混合。
