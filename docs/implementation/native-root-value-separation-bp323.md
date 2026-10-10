# BP323：根最坏值与期望收益分离

## 结果

固定16场景32局，仅重放原production策略。对成功搜索且owner拥有至少一个允许候选的2,139根，额外重建最坏值优先的影子提案。BP320/BP322的2,179为搜索根，不能把本轮较小的owner候选分母误认为少跑了40根。

- 525/2,139（24.54%）个提案改变。
- 两处已验证退化均从新动作改回GO。
- 86次FIRE提案改为其它动作，15次其它提案改为FIRE，净少71次。这是同根提案，不是ACTIVE实际射击次数。
- 2,116个影子选中行仍带exactBlock，不是安全/胜利证书。
- 当前选择在纯(worst,expected)二维上被支配215次；此比较忽略intent目标进度，因此不能直接把215当成完整风险向量支配bug。
- 32局双方动作流和结果保持不变，生产源码未修改。

## 选择合同

保持原动作域、owner.allowedRow、搜索预算、深度、递归nominal权重和blend。读取现有rootCellScore，在保留敌方响应域上重建：

1. worst = 各cell最小值；
2. expected = 原nominal权重下的整数期望；
3. 影子提案先比较worst，再比较expected，二者相同时才用原owner比较器（含intent/nominal/tie规则）。

每行重新计算现有blended值并断言与production rootScore精确相等；用原比较器重建当前提案并断言与production一致。

这不是纯递归max-min消融：深层cell内部仍使用当前混合值。本轮只改变根如何使用已有证据，同时将intent退到worst/expected之后；不能将结果说成只改了概率或只测了纯minimax。

## 两根对照

| 根/动作 | worst | expected | 当前最终比较值 |
| --- | ---: | ---: | ---: |
| I52 GO | 40 | 4613 | 1424 |
| I52 右转 | -103 | 8809 | 2303 |
| 2oo GO | 15641 | 23079 | 18033 |
| 2oo FIRE | 7062 | 81870 | 31270 |

I52的GO与右转都在二维Pareto前沿；2oo的GO与FIRE亦然。因此只添加(worst,expected)支配过滤不会解决这两次选择，需要明确允许牺牲多少worst来交换期望收益。

BP318已证明在这两个固定续局里GO更好；本轮只说明新根比较合同会选GO，不能推出所有改选都更好。

## 下一步与禁止事项

先预注册这一个最坏值优先候选，固定16场景做ACTIVE对照，统计胜负转移、击毁、FIRE转化以及原胜局劣化。不调参数、不仅重测两个失败样本；若攻击收益或总得分退化，保留负证据，不直接成为默认。

均匀权重不与这一轮同时更改。完整响应残余仍单独报告，不把不完整worst假装成真实全局下界，也不将“最坏优先”推广成Hard禁令。

## 工具与证据

入口：`tools/agentank/diagnostics/root-value-separation.js <新目录>`。
产物：`artifacts/native-causal-audit/bp323-root-value-separation/`，manifest、overview、roots.ndjson.gz。
两项新UT验证终局幅度/期望重建和“更低worst、更高期望”不等于被支配；32局运行断言timeout/error/root restore failure均为0。
production tree保持`285f9863227d6af3638bed74e008f0260fd25440034d95eec5e3f8cac44d9120`，无平台调用。
