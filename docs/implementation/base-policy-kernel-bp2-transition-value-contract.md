# BasePolicyKernel BP2：Transition / Value 合同归因

## 结论

BP2没有继续调叶评分。它先要求根状态、生产搜索动作域、采样transition和搜索完整度逐层可比，再比较Minimax动作排序。

固定16场景结果说明V2 Minimax的主要问题不是“算法整体算反”，而是搜索合同由不一致的物理相位、动作域、叶函数和预算共同组成：

- V1 stun倒计时兼容使一步transition差异从7,007降至539（-92.31%）；
- 深层采样差异从9,073降至446（-95.08%）；
- 独立V1-shaped动作域维持根99.29%/99.81%、ply2 99.51%/99.92%的集合一致；
- production search根动作域只有512/1,549和849/1,549集合一致，仍是主要结构缺口；
- V1等价leaf/path/opponent/superko/terminal合同把完整战术动作一致率从61.71%提高到78.80%；
- 公共生产域内pairwise排序一致率为401/461；transition一致后为338/383；搜索完整后为29/32；
- 严格完整根只有12个，说明当前128节点预算下绝大部分结果仍是启发式证据，不是完整Minimax值。

## ACTIVE POC

同一固定16场景、32局：

| 模式 | 胜/负/平 | 分析得分 | FIRE | 候选总耗时 |
|---|---:|---:|---:|---:|
| 当前基线 | 2/28/2 | 9.38% | 151 | 1,241,900us |
| V1等价搜索合同 ACTIVE | 10/22/0 | 31.25% | 250 | 16,137,691us |

变化为`+21.87pp`、胜场`+8`、负场`-6`、FIRE`+99`，四项硬不变量均为0。该结果证明合同方向有实战收益，但当前实现比同场V1的9,303,132us慢约73%，不能直接进入production。

## 架构判断

下一阶段不再修改评分常量。BP3应实现一个紧凑的`PolicyLocalSearchKernel`：

1. 固定数组直接生成own/enemy V1-shaped domain，不消费ProductionRoot候选行；
2. transition、leaf、path、opponent backup和terminal使用一个版本化合同；
3. 对每个根先完成浅层完整值，再按剩余预算迭代加深；中断保留最后完整层；
4. 对动作域、节点数和每节点成本分别标定，避免把“更深”与“更正确”混在一起；
5. 只有policy-local动作经过Physical Hard和最终门后才可执行。

production root SHA-256在BP2保持`c4443ddbd2a7a651d77f1582e5b68ce3715dfc87af7cf40ac7432396def39c48`。

## 重复运行

```bash
bash tools/base-policy-kernel-bp2.sh oracle /tmp/bp2-shadow
bash tools/base-policy-kernel-bp2.sh native /tmp/bp2-active
```

`oracle`只做归因，`native`执行ACTIVE POC。两者都只跑固定16场景，不是全量资格测试。
