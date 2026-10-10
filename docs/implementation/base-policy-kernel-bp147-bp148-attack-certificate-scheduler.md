# BP147–BP148：严格攻击证书调度与全部可干预根因果验证

日期：2026-09-01。

## 结论

BP147把BP145的476个真实严格FIRE证明根投影到ProductionRoot已经计算完成的整数/布尔信号，
并按`sourceClass × proof label`做确定性Discovery/Holdout分割。最简单的全召回证明调度条件是：

```text
ControlModeRouter.context.clearLine && selectedAction !== FIRE
```

它不拥有动作，只决定是否值得运行严格证明；Hard和BP145三规则世界AND/OR证明仍是唯一动作证书。
两个输入都已存在：`clearLine`由根控制模式缓存，`selectedAction`是当前选择结果，因此调度本身不增加
射线扫描、TypedArray或逐帧对象。

独立结果：

- Discovery：11/11可干预证书召回，调用49/240，根调用减少79.5%，证明节点减少96.2%；
- Holdout：11/11可干预证书召回，调用51/236，根调用减少78.3%，证明节点减少93.6%；
- 全部：22/22可干预证书和9/9必杀子集召回，调用100/476；
- 原两目标证明35,721节点；按调度仅1,692节点，减少95.2%；
- false negative为0，false positive为78。误触发只增加证明成本，不能产生动作所有权。

BP148对全部22个“严格证书存在、当前V2没有FIRE”的exact根执行一动作ACTIVE POC。31个可执行
goal的continuation policy条目均为0，因此ACTIVE只把根动作改成FIRE，后续继续由当前V2控制，敌方后缀
使用确定性V3。44/44 arms命中相同物理root，动作身份、Hard和restore失败均为0。

整局转换：

- `V1_WIN→V2_WIN`：5；
- `V1_WIN→DRAW`：1；
- 负向转换：0；
- 不变：16；
- 分析点：27→38，`+11`。

按来源：历史击毁根5正0负，匹配未击毁根0正0负，V2漏射根1正0负。这个结果证明“严格攻击事件
证书拥有少量根动作”是正向结构，不是全局FIRE加分，也不是Minimax点值恢复所有权。

## 性能边界与下一步

production仍未接线。诊断证明器当前为通用双目标、三规则世界实现，不能直接进入热路径。BP149必须：

1. 只保留拥有动作所需的`SAFE_THREAT_FIRE`目标；
2. 在100个调度根上，单目标总节点981、均值9、P95 21、最大27；
3. 使用一次构造、固定内存、可复用的搜索/规则世界arena；
4. 验证缩小TT与world对象复用后，100/100分类和root restore与BP145完全一致；
5. 把证明work计入runtime，预算不足返回`UNKNOWN`，不得覆盖当前动作；
6. 先运行Shadow性能/调用率，之后才允许新的ACTIVE资格。

## 证据

- `artifacts/v2-native-initiative/bp147-semantic-attack-certificate-feature-census`；
- `artifacts/v2-native-initiative/bp147-semantic-attack-certificate-scheduler-evidence`；
- `artifacts/v2-native-initiative/bp148-semantic-attack-actionable-certificate-active-poc`；
- 机器证据：`config/engine-v3/base-policy-kernel-bp147-bp148-attack-certificate-evidence.json`。

ProductionRoot SHA-256始终为
`0a8f09c3bf54e7ecd708346b08ff1133a716aa62634484b10e549968a0cbc23e`。
