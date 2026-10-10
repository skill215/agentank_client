# BP322：当前nominal权重与同域均匀权重影子对照

## 结果与结论

固定16场景32局修复版轨迹，2,179个搜索根：

- 2,167根的root评分发生变化。
- 127根（5.83%）的动作所有者提案改变。
- I52 frame48仍选择右转；2oo frame39仍选择FIRE。**均匀权重没有恢复两个已证退化根的GO选择。**
- 实际对战继续由当前权重控制，双方动作流及结果与BP317完全一致；不是ACTIVE胜率试验。

BP320证明概率校准较差，但本轮否定“只要把nominal换成均匀就能消除这两次错误选择”的假设。不能将全部选择问题归到OpponentModel，更不能因为均匀预测误差较低就直接上线。

## 实验隔离

影子搜索仅将opponentWeight改为固定1000，覆盖根和递归层；保留当前blend、chance规则、动作生成/剪枝、深度、预算、遍历顺序、归约修复、终局和启发效用。

每根核验己方domain、敌方domain及nodes一致。影子搜索使用隔离hazard和组件快照，恢复后运行实际搜索；实际动作流是最终无漂移验证。

动作提案比较复用真实owner.allowedRow、intent调整和better比较器；当前评分重建出的提案必须等于production提案/保持incumbent。均匀评分只用于影子排名，不提交intent、不通过emit输出。统计不等同于最终FinalGate之后的动作。

响应残余仍存在：同域均匀不是完整概率分布，不补算被剪动作，也不产生新的Hard/Proof证书。

## 性能与范围

当前search局部总计2301.51ms，影子2366.44ms（约+2.82%）；固定先影子后实际的顺序、隔离缓存和包装器影响计时，不是五批匹配输入性能标定，也不是官方3秒证据。production未改，不新增生产内存。

新增UT覆盖owner成员资格、intent调整、真实tie-break和输入不变。32局的timeout/error/root restore failure断言均通过。未跑新候选ACTIVE，未调用平台。

## 下一步

保持nominal固定，独立比较：现有混合标量、最坏值优先、最坏/期望分离的Pareto/约束选择。先在同根重建每动作最坏与期望分量，并确认各分量的支持质量；不能把普通有限深度worst值称作全局安全证明。

这一步要回答的是“什么证据允许高期望收益覆盖较稳动作”，而非寻找能调回两个样本的概率常量。通过同根分析后再预注册小型ACTIVE，检查正反转换；当前没有新默认策略。

入口：`tools/agentank/diagnostics/uniform-weight-shadow.js <新目录>`。
产物：`artifacts/native-causal-audit/bp322-uniform-shadow/`，manifest、overview、roots.ndjson.gz。
production tree仍为`285f9863227d6af3638bed74e008f0260fd25440034d95eec5e3f8cac44d9120`。
