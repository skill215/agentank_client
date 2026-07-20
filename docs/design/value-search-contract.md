# DD6 Value Search 与快速上下界合同

状态：DD6 规范合同，2026-07-15。冻结完全可观察/信息态 ValueSearch 的效用、区间、pure serialized search、叶子、chance/observation 组合、任意中断和性能边界。

关联：`DEC-0001`、`DEC-0002`、`DEC-0006`、`DEC-0009`、`DEC-0024`、`DEC-0033`、`DEC-0040`、`DEC-0041`、`DEC-0048`；[action-result-abi.md](action-result-abi.md)、[fast-kernel-contract.md](fast-kernel-contract.md)、[terminal-proof-algebra.md](terminal-proof-algebra.md)。

## 1. 目标与非目标

ValueSearch 回答“在冻结 horizon/profile/risk 下，当前 action/policy 的值在哪个区间”，不回答“平台终局是否已严格证明”。

```text
SearchState + SearchProfile + EvalProfile + RiskProfile + OpponentModelEpoch
-> lowerValue / upperValue
-> expectedValue / robustValue（资格满足时）
-> deterministic/mixed Policy
-> BoundKind + incomplete reason
```

非目标：

- depth-limited value 不冒充 ForcedWin/ForcedLoss；
- evaluator point estimate 不冒充 sound terminal bound；
- 不在 deep search materialize 全矩阵、完整策略笛卡尔积或 JS Node 对象；
- 不运行 Monte Carlo、rollout、MCTS 或随机 world sampling；
- 不在 solver 内修改 RiskProfile、对手模型或 wall-clock 语义。

## 2. 效用与区间

```text
VALUE_MIN = -10000
DRAW_UTILITY = 0
VALUE_MAX = +10000
VALUE_UNKNOWN = -32768 sentinel（禁止参与算术）
```

终局：WIN=`+10000`、LOSS=`-10000`、DRAW=`0`。DRAW 的数值政策不改变 TerminalOutcome，也不允许 Risk 把 LOSS 改成 DRAW。

每个有效结果满足：

```text
VALUE_MIN <= lowerValue <= upperValue <= VALUE_MAX
```

区间有两种明确语义：

1. `terminal-game interval`：对完整终局效用的 sound 包络；
2. `horizon-utility interval`：对指定 horizon + leaf contract 的完整包络。

ResultFlags 必须标出 interval semantic。只有 terminal、Proof/committed closure 或经离线验证的 feature envelope 才能收紧 terminal-game interval；普通 evaluator point 只能提供 orderingEstimate，terminal-game interval 保持 `[-10000,+10000]`。

## 3. Leaf 合同

叶子按优先级处理：

```text
1. resolved terminal               -> exact terminal value
2. strict Proof/Hard certificate   -> 对应 terminal bound/值
3. TacticalClosure complete        -> closure interval
4. verified feature envelope       -> sound lower/upper + point
5. ordinary evaluator              -> [-10000,+10000] + point estimate
6. unknown rule/support/capacity    -> widest compatible interval + incomplete
```

`orderingEstimate` 与 `lower/upper` 分离存储或只存在 evaluator scratch；不得写入 `lowerValue=point`。若 SearchProfile 选择“完成 depth-horizon deterministic evaluator game”，可以返回 `EXACT_COMPLETE` 的 horizon value，但必须带 `HORIZON_UTILITY` flag，不能写 ProofCache。

## 4. 节点备份

### 4.1 我方单决策节点

```text
lower = max_a childLower[a]
upper = max_a childUpper[a]
```

只完成部分动作时：未展开合法动作使用 `[VALUE_MIN, VALUE_MAX]`。已找到动作给出合法 state lower；节点 upper 只有在全部可能改善上界的动作已覆盖/支配证明后才能收紧。

### 4.2 敌方单决策节点

```text
lower = min_b childLower[b]
upper = min_b childUpper[b]
```

未展开敌方动作按最坏下界处理；soft top-K 只能决定先后，不能删除会改变 bound 的回应。

### 4.3 自动节点

单后继直接传播。committed projectile/bomb closure 使用 DD5 horizon，不因 decision depth 到达零而停止。

### 4.4 Chance 与隐藏世界

- support + exact probability：对 lower/upper 分别做外扩定点期望；
- support complete、probability interval：求允许概率多面体上的最小/最大期望；
- support incomplete：保持 incomplete 和保守区间；
- HiddenWorld belief 与 ChanceOutcome 独立组合，Risk 递归由 [risk-backup-contract.md](risk-backup-contract.md) 处理；
- residual support 必须通过 lossless iterator或符号 bound 纳入，不能按零质量删除。

### 4.5 Observation split

物理 children 先按我方实际 observation history 分区，再递归求每个后继 InformationState。分裂前 action 对同 information set 的所有 world一致；分裂后不同 observation branch 才可使用不同后续 policy。

## 5. 同时行动 pure 快速上下界

对联合 cell interval `C[a,b]=[L[a,b],U[a,b]]`：

```text
pureLower = max_a min_b L[a,b]
pureUpper = min_b max_a U[a,b]
```

它们是同时行动 mixed value 的合法快速包络，不是两个候选最终值。若 `pureLower < pureUpper`，深层节点可直接返回该区间，只有根/关键节点才进入受限矩阵。

`pureLower == pureUpper` 只有在以下条件全部满足时才能 exact：

- 所有可能改变 row minimum/column maximum 的 cell complete；
- action supports complete；
- joint chance/world/observation supports complete；
- cell interval 语义、horizon、risk profile 相同；
- fixed-point outward rounding 没有未计 residual；
- dependency certificate 完整。

否则相等只是数值巧合，BoundKind 继承最弱依赖。

## 6. Serialized Pure Search

深层默认不创建 StageMatrix：

```text
for our action in ordered actions:
  rowLower = VALUE_MAX
  rowUpper = VALUE_MAX
  for enemy reply in adversarial order:
    evaluate interval cell on demand
    rowLower = min(rowLower, cellLower)
    rowUpper = min(rowUpper, cellUpper)
    if rowUpper < currentBestLower: certified row cutoff
  nodeLower = max(nodeLower, rowLower)
  nodeUpperCandidate = max(nodeUpperCandidate, rowUpper)
```

为同时行动提供严格 upper 时仍须维护 column maxima 或等价 dependency frontier；不能把 `max rowUpper` 当成 `min column max U`。实现保存：

```text
rowMinLower[] / rowMinUpper[]
columnMaxLower[] / columnMaxUpper[]
unknownCellDependencyMask
```

小 action set 用固定二维 cell slab；较大 family 用惰性 cell records + row/column touched lists。动作排序不影响最终 interval semantic。

## 7. InformationState Value

### 7.1 Common action

同一我方 information set 只生成一次 action list。同一 action 在不同 world 中出现 executed/no-effect/failure，作为 outcome进入 cell；禁止按 world 删除 action 后分别最大化。

### 7.2 Enemy response policy

敌方动作按 `enemyInformationPartition` 一致：

```text
beta: enemyInformationSetId -> legal ActionKey
```

ValueSearch 惰性枚举或由受限 public-belief solver表示 beta。不得让同一 enemy information set 在不同 world 使用不同 action，也不得强迫不同 information set 共用 action。

### 7.3 启动通用信息求解器的条件

hidden variable 只有在改变合法性、物理结果、observation、terminal/proof 或 action ordering 超过 profile阈值时才进入受限 information solver。否则按 decision-equivalent class 聚合；只有一个 class 时强制降级 singleton Physical fast path。

## 8. BoundKind 与完整性

| 情况 | BoundKind |
|---|---|
| 完整 terminal/horizon scalar | `EXACT_COMPLETE` |
| 只有 sound lower 完整 | `LOWER_COMPLETE` |
| 只有 sound upper 完整 | `UPPER_COMPLETE` |
| 两端 sound 但不相等 | `INTERVAL_COMPLETE` |
| 受限 matrix 有 gap | `APPROXIMATE_WITH_GAP` |
| 只有 ordering point | `HEURISTIC_ONLY` |
| support/rule/capacity/time 未覆盖且无完整区间合同 | `INCOMPLETE` |

`INTERVAL_COMPLETE` 可以安全传播和用于 robust constraint，但不能执行 scalar alpha-beta cutoff。`APPROXIMATE_WITH_GAP` 必须保存 gap、受限 action signatures 和完整 best-response scan 标志。

## 9. Anytime 与中断

搜索显式栈的每个 frame 始终保存一个可发布区间：

- 未访问 child 初始 `[-10000,+10000]`；
- 完成一个 child 后单调收紧父 interval；
- current cell写入 ResultArena 后才更新父 dependency；
-中断发生在固定节点/iteration batch 边界；
-未完成 apply/undo 先恢复 BranchMark，再发布上一个完整 interval；
- iterative deepening 只发布最后完整 depth 的 policy，当前层可作为 ordering hint。

`nodeBudget` 的分母是当前 root 的可达子图，不是 append-only arena 中编号小于 root 的全部节点。
同一 root 前面是否构建过无关候选树不得改变 visited denominator、完成状态或 fingerprint。显式零预算
必须访问零节点；matrix 的零 iteration/expansion budget 也不得偷偷执行一次 iteration。若闭式 pure
saddle/完整 2×2 求解不需要 iteration，可以在零 iteration budget 下返回，但必须由完整 cell support
直接证明，不能读取上次复用 slab 的值。

任意中断都必须满足已声明 interval 语义的 `lower <= trueValue <= upper`；若无法保证则返回 VALUE_UNKNOWN/INCOMPLETE，而不是沿用旧 scalar。

## 10. 搜索优先级与剪枝

动作先经 DD5 HardGate。允许永久删除的动作只有：

- submission illegal；
- `HARD_REJECT_PROVEN/POLICY`（recovery 另行保留原因）；
-完整物理等价；
-完整 dominance certificate；
-当前 Proof goal 明确不属于该 action family。

TT/PV、Plan、对手概率、feature score 和历史先验只改变顺序/初始受限集。ProofSearch 不使用 soft top-K；ValueSearch top-K 后仍须允许 Double Oracle best response把动作重新加入。

## 11. 热路径和容量

- 显式预分配 SearchFrame SoA；无递归、对象、generator、Map/Set；
- scalar node push/pop O(1)；cell apply/undo O(actual events+deltas)；
- action lists稳定整数排序，小数组 insertion network/生成表由 benchmark 决定；
- world/response/chance/residual iterator使用 offset cursor，可暂停不裁 support；
-每个 frame只在固定 batch读取 time-controller flag，不直接 `Date.now()`；
- terminal/Hard/Proof 与 Value scratch分池；容量不足返回对应 incomplete；
- singleton path不建立 regret、public-belief 或 observation matrix scratch。

## 12. 测试矩阵

- max/min interval 单调性；
- pureLower/pureUpper 包含已知 2×2/3×3 mixed value；
-相等 pure bounds 但 incomplete dependency 不升级 exact；
- ordinary evaluator不能收紧 terminal interval；
- RPS/Matching Pennies 深层 pure interval 不被任选一端；
- action-dependent chance 概率；
- residual 低概率 world仍影响 interval；
- strategy-fusion/observation split；
- unknown rule/support/capacity/time逐层传播；
-任意 node batch中断区间仍 sound；
-不可达旧节点不消耗当前 root budget，零预算无隐式工作；
-复用 matrix slab 未逐 cell 写满时保持 `[-10000,+10000]/INCOMPLETE`；
-2×2 三值矩阵、交替 AND/OR 树和三种 Proof goal 使用独立 oracle 全穷举；
- source/minified、cache-off/on、singleton/general semantic fingerprint一致。

## 13. 冻结结论

深层 pure Minimax 的职责被收口为快速、可中断、可证明的上下界；它不再把序列化纯值当作同时行动最终值，也不把启发式 point 当作终局 bound。计算预算只决定区间宽度，不改变其语义。
