# HP13：Information 区间所有权 Shadow 验证

## 结论

HP13 没有恢复近似 InformationSearch 的动作所有权。固定 16 场景的 Shadow 证据表明，
当前递归搜索虽然经常给出不同的点估计排序，但没有产生任何可证明的区间支配：

- 1,282 次 InformationSearch，全部不完整；
- 6,070 个动作全部只能表示为 `[-32000, 32000]`；
- 点估计第一名与实际动作不同 666 次；
- 满足 `candidate.lower > incumbent.upper` 的动作 0 次。

因此，把这些点估计重新接回 Risk、StageMatrix 或 Proposal 所有权会恢复已被 HP10/HP12
禁止的不可靠语义。HP12 的 consumer-aware 调度继续作为 production 默认。

## 新增合同

诊断工具新增 `InformationDominanceIntervals`：

```text
orderingEstimate 只用于排列工作顺序
lower / upper     才能形成所有权证据
candidate.lower > incumbent.upper 才允许严格替换
```

不完整搜索即使返回很高的标量，也保持全范围；相等、lower 对 lower、搜索“完成一轮”均不算
严格支配。该实现位于工具目录，不改变 production source、bundle 或运行时内存。

同时新增 `InformationIntervalOwnershipProbe`，记录：

- 完整/不完整搜索次数；
- full-range/resolved 动作数；
- 点估计分歧和严格支配提案；
- 导致区间失效的重叠原因集合。

## 固定样本结果

命令：

```bash
./tools/runtime-schedule-poc.sh \
  --profiles CURRENT,LEGACY_INFORMATION_EVIDENCE \
  --role DISCOVERY --scenarios 16 \
  --capture-information-support-probe true \
  --capture-information-interval-ownership-probe true \
  --output /tmp/hp13-information-interval-shadow.json
```

旧 Information 路径的支持损失为：

| 原因 | 次数 |
|---|---:|
| INPUT_SUPPORT | 1,282 |
| OBSERVATION_POLICY | 1,282 |
| ENEMY_COLUMNS | 1,215 |
| WORK_INTERRUPTED | 5 |
| WORLD_SELECTION / WORLD_MASS / DIRECTION / RESTORE | 0 |

重叠 mask 为：

- 67 次：输入支持 + Observation policy；
- 1,210 次：再加敌方响应列裁剪；
- 5 次：再加 work 中断。

这里的 `OBSERVATION_POLICY` 是结构问题：深层 Physical continuation 会在每个隐藏世界里
独立选择后续动作；在 ObservationSplit 前，这不是 InformationState 可执行的共同策略，
所以不能成为 lower bound。

对照整局结果仍是小样本中性：CURRENT 为 3/28/1，旧 Information 为 2/28/2，正向和负向
转换各 1。全部 Hard、dominated、restore 和热分配不变量为 0。该结果只用于判断所有权证据，
不作为胜率结论。

## 验收

- 新增区间合同 UT 4/4 通过；
- diagnostics 全套通过；
- Minimax、GR0、IMP5 保持通过；
- `git diff --check` 通过；
- production 源码未因 HP13 改变，`after-hp12` 标定仍有效。

## 下一步

不继续给旧 Information 标量补权重。下一步是 HP14：把 Information 搜索拆为两个明确产品：

1. `OrderingEstimate`：只有存在剩余预算时才运行，永不拥有动作；
2. `CommonPolicyInterval`：显式建立 ObservationSplit 和共同后续动作，只有非全范围区间才运行
   严格支配消费者。

在 HP14 接 production 前，先做小地图 exhaustive oracle 和固定 root Shadow；如果仍然不能产生
非全范围 lower/upper，就继续保持关闭，把预算留给 Physical Minimax。
