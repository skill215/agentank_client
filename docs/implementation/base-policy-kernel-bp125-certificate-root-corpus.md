# BP125：64个策略证书根全部可重放，但标量优势不是全局优势

## 证据固化

BP123原先只有每局16条普通样本，后出现的严格证书可能丢失。BP125增加独立、固定容量的
TypedArray certificate slab，只在candidate严格支配incumbent时记录：

- 帧与FastState双32位哈希；
- incumbent/candidate行、动作和参数；
- 两侧有限时域值；
- ObjectiveEpoch generation、target signature/generation；
- root control mode。

对象只在赛后summary中创建，热路径不分配。固定16场景重新运行得到64 strict dominance等于
64 certificate roots，容量溢出为0；Shadow与CURRENT整局行为保持一致。

每个根随后从第0帧分别重放incumbent和candidate。只有帧、双哈希、动作可执行性全部匹配才接受。
128条分支全部命中，64条incumbent终局逐字段复现原比赛，没有近似状态或重建后的伪根。

## 历史EnemyPolicy与历史Chance下的结果

| 维度 | incumbent | candidate | 差值 |
|---|---:|---:|---:|
| 非败局 | 7 | 6 | -1 |
| 击毁对手 | 0 | 2 | +2 |
| 自身单方死亡 | 16 | 16 | 0 |
| 累计星差 | -114 | -116 | -2 |

终局转换为：

- 56个败局仍败；
- 1个败转胜；
- 3个平局仍平；
- 2个平转败；
- 1个平转胜；
- 1个胜局仍胜。

所以深度2标量证书确实找到了两个击毁机会，但同时丢掉一个非败局并恶化星差。把终局压成一个局部
scalar后，“更多击毁”和“更少非败局”可以互相抵消；这种值即使在有限树中严格更大，也不能直接
证明动作对整局更优。这与BP124只有+1.56pp且星差恶化的在线结果一致。

## 量词边界和决定

本阶段固定BasePolicy为V2 production observable policy，EnemyPolicy为V3 historical controller，
ChanceOutcome为historical star stream。它证明的是精确历史控制器轨迹上的首动作反事实，不是对
敌方策略和随机出星的鲁棒优势。

- 保留共同续写Minimax作为Shadow verifier；
- 保留64根紧凑语料，后续不必再次跑整局才能分析这些状态；
- 拒绝有限时域scalar直接拥有动作；
- 不训练、不调margin、不运行ACTIVE、不读取Holdout。

下一步BP126先在相同64个根上独立展开ChanceOutcome，并保持exact controller history。替代
EnemyPolicy只能作为“根后重置/切换策略”的另一类证据，必须单独标记，不能伪装成精确历史。
最终资格应使用多维区间：先保证nonloss不退化，再比较death/kill和星差，而不是重新加权成一个分数。

机器摘要：
config/engine-v3/base-policy-kernel-bp125-certificate-root-corpus-evidence.json。
