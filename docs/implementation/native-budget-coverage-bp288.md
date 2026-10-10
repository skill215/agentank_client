# BP288：预算覆盖调度POC

## 结论

不采用直接cell均分作为生产修复。它消除根列次序偏差，但本样本实际节点增加41.96%，没有动作或结果收益。下一步采用完整浅层作为回退，再做预算受控的逐层加深POC；本轮尚未实现逐层加深。

## 实验

沿用BP280的5个已知问题根，不读取Holdout。每根运行CURRENT、反序、CELL_EQUAL及反序、SHALLOW_COMPLETE及反序，共30次整局重建、324个root cell。只在目标根改变调度，后续恢复原策略。

候选、物理规则、Risk和评分保持不变。cell均分使用floor(128/(根动作数×敌方响应数))，每cell重置节点计数；完整浅层额外把目标深度设为1。两者保留原软截断语义，因此配额不等于实际工作硬上限。

| 模式（正序） | 5根实际节点总和 | 预算叶 | 目标根变化 | 续局胜/平/负 |
| --- | ---: | ---: | --- | --- |
| CURRENT | 920 | 304 | 基线 | 0/2/3 |
| CELL_EQUAL | 1306 | 748 | 0个 | 0/2/3 |
| SHALLOW_COMPLETE | 72 | 0 | 1个 | 1/2/2 |

各模式只是同5个已选问题局的反事实，不是独立胜率评估。不能把上表解释为全局胜率或把72节点当整局性能。

CELL_EQUAL和SHALLOW_COMPLETE的正反序：5/5根逐行分数及选择一致。CURRENT反序则在Ar56 frame19改变选择并负→胜。所有运行root restore failure=0；CURRENT双方完整动作流与原基线一致，其他模式目标根双方前缀及参数一致。

浅层5根预算叶、fast incomplete、hard incomplete、noAction、top-limit叶均为0，但仍使用启发式深度叶，不是终局exact/Proof。CURRENT和CELL_EQUAL各有1次fast incomplete。

## 机制解释

每cell重置预算修复“先来的列占用其他列份额”，但递归展开仍会在耗尽后完成剩余兄弟/chance响应，各cell重复承担超额成本。均分配额之和≤128不能证明实际工作≤128。

完整浅层以较低成本提供一致时域的比较；它没有恢复另外4个样本，因此不支持把全局搜索固定为depth1。更深搜索质量、对手分布和叶评估问题仍需分开验证。

## 下一步实现边界

1. 完成depth1的整个合法矩阵，保存该层结果；不足以覆盖时显式incomplete，不能把空cell当分数。
2. 在剩余全根预算内尝试depth2、depth3；递归进入下一工作单元前检查预算并中断，状态必须恢复。
3. 仅整层完成且支持满足合同才提交该层；被中断的深层不能覆盖上一完整层的部分行。
4. 深度完成不等于终局精确；独立保存预算完整性、物理支持、深度叶与Proof状态。
5. 先做列置换、预算边界、中断恢复、完成层不混写的UT和固定根POC，再做含获胜局的Discovery对照。不能因这些失败根获益就切换生产默认。

## 交付

- 可复用命令：`node tools/agentank/diagnostics/native-search-value-audit.js <bp280输入> <新输出> --budget-poc`
- 证据：`artifacts/native-causal-audit/bp288-budget-coverage-poc.json`
- 相关UT：19/19通过。包含预算配额、整数备份、列置换与生产软截断机制。
- 未修改production源码、默认配置；未执行官方simulate/publish/challenge。
