# BP135：不是星权重，而是攻击叶值与敌方响应备份组合错位

BP135在BP134的35个规则不敏感根上运行8条因果lane，并把每条lane重复放入三个隔离物理世界。所有
lane都是Shadow，不发动作；35根全部完整且跨世界一致，restore失败、热分配和行为变化均为0。FULL
逐根复现BP134，production SHA仍为
`0a8f09c3bf54e7ecd708346b08ff1133a716aa62634484b10e549968a0cbc23e`。

## Leaf消融

| lane | 候选更高 | 相等 | 候选更低 |
|---|---:|---:|---:|
| FULL | 17 | 9 | 9 |
| NO_STAR | 17 | 9 | 9 |
| NO_ORDNANCE | 19 | 9 | 7 |
| NO_ATTACK | 8 | 19 | 8 |
| NO_MOBILITY | 16 | 11 | 8 |
| NO_STATUS | 13 | 8 | 14 |
| NO_HISTORY | 16 | 9 | 10 |
| ZERO_LEAF | 0 | 34 | 1 |

`NO_STAR`零改判，所以这批反向不是“Minimax过度抢星”。`NO_ATTACK`让两个历史退化都从候选更高
降成相等，证明攻击几何是这两次假阳性的必要贡献。但它没有把两个历史改善都变成候选更高；全局删掉
攻击分量只会丢失战斗信息，仍然不能解决选择方向。

`ZERO_LEAF`使34根相等，说明方向主要来自非终局叶值，不是Hard或terminal本身。弹丸炸弹、机动、
status和history各自会改变若干根，却没有任何单一分量把两次改善和两次退化同时分开。因此不能继续用
“调一个权重直到样本变好”的方式修复。

## Backup反证

当前比较对incumbent和candidate分别取敌方最坏响应。两个历史退化在maximin和敌方响应均值下都仍为
候选更高，每个根的逐响应关系都是`6更好/0相等/1更差`。两个历史改善在maximin下都为候选更低，
但在均值下都为候选更高，逐响应分别是`4/0/3`和`4/1/2`。

这说明真实改善是response tradeoff，不是pointwise dominance。简单均值虽然找回两次改善，也保留了
两次退化，不能成为新owner。真正缺少的是同一 simultaneous stage 中的共同敌方策略量词：现在把两条
我方策略分别做maximin，相当于允许敌方对不同我方行采用不同最佳响应，再比较两个独立最小值。

## 决策

拒绝调scalar权重、全局删攻击、用均值替换minimax。保留逐敌方响应向量，下一步BP136把incumbent和
candidate放进同一个`2×N` StageMatrix，对比三类证据：逐列支配、混合均衡支持、递归风险污染后的共同
policy backup。只有完整矩阵结果可以成为后续Proposal证据；BP136仍不接管production动作。

机器证据见
`config/engine-v3/base-policy-kernel-bp135-leaf-backup-evidence.json`。
