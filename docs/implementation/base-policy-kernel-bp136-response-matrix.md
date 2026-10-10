# BP136：共同StageMatrix没有修复方向，敌方响应量词仍错位

BP136没有重跑Minimax，也没有改变production。它直接复用BP135已完成的depth3根单元格，把原动作和
候选动作作为同一个`2×N` simultaneous zero-sum stage的两行，敌方动作作为共享列，分别求原始均衡与
ε-contamination风险变换后的均衡。35根在三个移动规则世界中全部完成，结果逐根一致；热分配、restore
失败和行为变化均为0。production SHA保持
`0a8f09c3bf54e7ecd708346b08ff1133a716aa62634484b10e549968a0cbc23e`。

## 数值合同

35根中33根的全部cell已在`[-10000,10000]`内。另2根包含超出StageMatrix合同的叶值，其中一个候选
值为`-30100`。BP136没有截断这些值：同一根的两行和全部敌方列使用同一个正仿射变换。6个规则世界
实例需要整数scale，99个保持identity；归一化导致的候选/原动作同列碰撞为0。该变换适合比较共同矩阵
策略，但缩放后的低gap结果仍只算近似证据，不升级成strict Proof。

## 结果

逐列关系为：21个tradeoff、8个完全相等、4个候选逐列支配、2个原动作逐列支配。两个历史真实改善
都是tradeoff；原始均衡给候选动作的概率分别为28.70%和20.43%，风险变换后为29.04%和55.48%。

两个历史真实退化也都是tradeoff，但原始共同矩阵反而都给候选动作100%支持。风险变换只把其中一个
降到99.88%，另一个仍为100%。因此：

- 共享敌方列修复了“两个独立maximin”的形式问题，但没有修复游戏方向；
- StageMatrix support不是动作正确性证书；
- ε-contamination不能把错误叶攻击证据变成正确动作；
- BP135定位到的ATTACK叶值假阳性与敌方响应模型仍需同时拆开。

原始矩阵75/105个规则世界实例为gap 0，30个为approximate、最大gap 8；风险矩阵105个均为
approximate、最大gap 4。即使把这些极小gap全部视作已收敛，历史结论也不改变。

## 决策

拒绝让共同StageMatrix、混合policy support或风险污染结果拥有production动作。下一步应使用同一批根
做response-conditioned证据：敌方策略必须由根观察和对手模型产生共同分布，同时把“可验证攻击进展”
从ATTACK标量叶值中独立出来。新证据只有在同时排除两个历史退化且保留正向根时，才允许进入ACTIVE
POC；不能继续调scalar、risk或solver迭代数。

机器证据见
`config/engine-v3/base-policy-kernel-bp136-response-matrix-evidence.json`。
