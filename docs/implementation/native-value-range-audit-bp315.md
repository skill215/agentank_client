# BP315：搜索值域与归约哨兵审计

## 确认的实现缺陷

直接调用生产NativeBasePolicySearch的worstReply、policyValue，仅用合成子节点隔离归约逻辑，复现以下结果：

| 子节点值 | 归约 | 当前结果 | 正确结果 |
| --- | --- | ---: | ---: |
| 100000,100000 | MIN/期望混合20% | 45600 | 100000 |
| 60000,100000 | MIN/期望混合20% | 41600 | 64000 |
| -100000,-60000 | MAX | -32000 | -60000 |

VALUE_MAX=32000使MIN初始值比所有合法子节点还低；VALUE_MIN=-32000使MAX初始值比所有合法子节点还高。该值随后被当成实际最坏/最好值传播。它不是有意的风险折扣或战略取舍。

这些测试证明数学归约有错，不证明真实对局的发生次数或胜率损失。尚未以这些案例解释全部V2退化。

## 已审计的范围

- specialized terminalUtility：单方击毁±100000；同归于尽星多100000、星少-100000、同星-60000。这里只记录现行策略效用，不修改平局语义。
- specialized policy-leaf.evaluate：总分截断至±25000。
- search.leaf：截断之后再叠加pathScore和部分重复路径返还，所以最终叶值不等于±25000。
- 当前native-root的historyEvaluator为null；可注入接口仍不能被当成统一有限界。
- applied path增量在当前specialized配置关闭；普通scoreTransition及superko仍参与路径分。
- rootScore/rootCellScore等使用Int32Array。改变整数数组初始化常量与改变标量归约初始值不是同一件事。

同类标量初始化还位于root prepare的最坏响应归约；compact版本的worst-own-chance分支也使用该哨兵。它们需要后续分别建立测试。不能将仅测试了两个方法说成整个调用链已修复。

## 本轮实验与UT

`tools/agentank/diagnostics/search-value-range-audit.js`执行真实生产方法；实验版本仅在内存重绑定VALUE_MIN/MAX为负/正Infinity，不改production文件。

四项UT覆盖两个已知缺陷、49组合法幅度组合×3个blend、普通值与空域回退。普通范围结果不变，空域仍回退pairedLeaf。已知缺陷断言用于保留审计证据，明确不是认可错误行为；正式修复应把生产路径断言迁移到正确合同。

不应全局将VALUE_MIN/MAX替换为Infinity：写入Int32Array会转换为0，破坏未计算槽语义。也不应只换成±100000作为永远有效的全局边界，路径及扩展评估合同仍未闭合。

## 下一步：先修归约，再接区间

1. 对标量MIN/MAX采用首个有效子节点初始化，保留空域回退；不依赖猜测值域，不改整数数组未计算标记。
2. 同时覆盖deep MIN、deep MAX、root归约、可配置own-chance；验证nominal tie-break与列顺序不变。
3. 保留本轮错误证据，新增正式oracle合同；按原生成链同步readable/compact/specialized，完整UT及source生成一致性必须通过。
4. 在既有16场景影子根统计改分和改选数量，然后才考虑ACTIVE对战。不得直接声称胜率提升。
5. 未知转移区间仍需独立值域/无界表示设计；修复哨兵并不能让-22000等未知启发分变成严格界。

本轮生产代码、风险参数、战略、搜索预算均未修改，未调用平台接口。
