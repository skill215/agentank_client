# DecisionQualityArena：先诊断决策质量，再重构 Minimax 外围

## 目的

当前阶段暂停继续增加 Minimax 深度、节点和局部启发式。性能优化已经证明能让更多搜索完成，但尚未证明完成的搜索会选择更好的动作。

`DecisionQualityArena` 是诊断工具，不是新的生产控制器。它回答四个独立问题：

1. 根候选或多帧 option 是否缺失；
2. 相同候选集合内，V2 搜索值是否把动作排反；
3. Risk 是否删除了更好的动作；
4. 搜索与 Risk 都没有排错时，最终仲裁是否改错。

## 实验语义

每个历史物理 root 对每个 Hard 允许动作强制一次首动作。首动作之后重置控制器私有历史，并运行以下响应矩阵：

```text
自己的续写策略 × 对手响应策略
V2 / V3         × V2 / V3
```

这里 V3 只代表结构化 V1 策略族，不是正确答案。评价同时保留两类 oracle：

- `same-policy oracle`：自己的后续固定为 V2，只比较首动作；
- `portfolio oracle`：允许在 V2/V3 后续中选择对对手响应最鲁棒的一种，用于发现续写/Plan 缺口。

每个策略先取对手策略中的最坏结果，再比较胜负、最坏星差、总胜负单位和总星差。runtime 胜负不进入评价。

root 不按“最后若干帧”单一抽样，而按 `Information search / Physical search / committed hazard / tactical contact without search / strategic navigation` 分层抽样，避免终局导航帧淹没真正的搜索帧。

## 分层归因

固定归因顺序：

```text
Risk threshold removal
→ Risk Pareto removal
→ Search value inversion
→ Final arbitration
→ Continuation policy gap
→ Candidate / option coverage gap
```

归因是诊断证据，不直接取得动作所有权。特别是 `RESET_SUFFIX` 会重置控制器历史，因此不能当作严格 Proof 或官方胜率。

## 执行

```bash
./tools/decision-quality-arena.sh verify \
  --input config/engine-v2/decision-quality-baseline.json

./tools/decision-quality-arena.sh run \
  --role DISCOVERY \
  --scenarios 8 \
  --roots-per-loss 2 \
  --root-stride 16
```

默认输出位于 `/tmp`。可用 `DECISION_QUALITY_LABELS` 和 `DECISION_QUALITY_REPORT` 指定路径。报告不保存完整 replay。

## 后续执行门

1. 先用历史 root 生成首份分层 regret 报告；
2. 若 `SEARCH_VALUE_INVERSION` 占主要部分，先重建整数 leaf value vector；
3. 若 `CONTINUATION_POLICY_GAP` 或 `CANDIDATE_OPTION_COVERAGE_GAP` 占主要部分，先增加 response-aware option；
4. 若 Risk 删除占主要部分，修 Risk 所有权；
5. 若最终仲裁占主要部分，重建 Proposal/控制所有权；
6. 只有决策候选冻结后，才重新进行深度与预算标定。

禁止通过提高 FIRE 固定分、放宽 Hard、继续提高节点预算或直接跑全量 arena 来替代该归因流程。
