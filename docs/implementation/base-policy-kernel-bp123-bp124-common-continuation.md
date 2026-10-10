# BP123–BP124：共同宿主续写弱正向，仍不足以拥有动作

## 为什么要重做反事实合同

BP121的候选搜索在根之后持续执行`ATTACK_APPROACH`，BP122却只覆盖一个primitive；下一callback若没有
新证书就恢复Production。搜索证明依赖了一条没有实际提交的未来Plan。这与历史BP42的合同缺口相同，
必须先修正，不能靠增加事件分或加深搜索掩盖。

BP123改为：candidate只在根选择route-proven ATTACK动作；根之后candidate和incumbent都使用同一
BasePolicy representative。这样比较的是“只改变第一动作”的可执行反事实，不再假设未来持续攻击策略。

## BP123 Shadow结果

| 项目 | 数量 |
|---|---:|
| 策略尝试 / 无共同域 | 465 / 218 |
| 完整 / 不完整 | 211 / 36 |
| incumbent更好 / 相等 / candidate更好 | 38 / 109 / 64 |
| candidate优势GO / 左转 / 右转 | 2 / 23 / 39 |
| incumbent / candidate节点 | 11,041 / 10,443 |
| 最大节点 / restore / 热分配 | 256 / 0 / 0 |

BP121的分支专用攻击续写只有32个优势；共同宿主续写得到64个，且双方搜索成本接近。说明“虚构Plan”
确实是合同错误，但不是此前全部优势的唯一来源。

## BP124 ACTIVE结果

45个在线证书全部经过Hard和FinalGate后覆盖，FinalGate拒绝为0。

| 指标 | CURRENT | ACTIVE | 变化 |
|---|---:|---:|---:|
| 胜 / 负 / 平 | 2 / 28 / 2 | 3 / 28 / 1 | +1 / 0 / -1 |
| 分析得分 | 9.38% | 10.94% | +1.56pp |
| 我方星 / 对方星 | 7 / 47 | 6 / 52 | -1 / +5 |
| 我方crash | 13 | 16 | +3 |
| FIRE | 151 | 156 | +5 |

胜负转移同时包含一个`LOSS→WIN`和一个`DRAW→LOSS`。正例
`mat_2PpuRfHvk51Codc5f` seat 1在第50帧左转改右转，把星数败局转成第111帧击毁对手；负例
`mat_I52zYeSqz1RCC3Vqs` seat 0得到三次局部优势，却把同星平局变成0:2星败局。

共同续写因此比BP122的分支专用续写更可信，但仍未达到动作所有者预注册的+3pp；星差和crash也明显
恶化。Hard、Risk支配、root restore、timeout和热分配全为0，退化属于有限时域价值与整局战略价值不一致。

## 决定

- 保留共同宿主续写，作为首动作反事实的正确Shadow verifier；
- 保留语义ATTACK候选生成和稀疏成对Minimax；
- 关闭BP124 owner，不读取Holdout，不在固定16上扫描margin/depth；
- 下一步把BP123的64个证书根固化成紧凑反事实语料，对同一可观察状态分别保存nonloss、击毁、星差和
  失败类型，并显式展开EnemyPolicy与独立ChanceOutcome。只有新的区间验证器通过后才再次ACTIVE。

机器摘要：
`config/engine-v3/base-policy-kernel-bp123-bp124-common-continuation-evidence.json`。
