# BP291–BP292：包含胜局的完整层成本标定

## 样本和边界

从已开放Discovery64的已捕获搜索分歧根中，以固定盐哈希抽取原胜、平、负各6根，每个match/seat最多一根。共18根，分别运行CURRENT、完整层正序、完整层反序。第二层和第三层各54次局面重建。

这仍是分歧根、结果均衡的诊断样本，不是随机全帧样本，不可将其结果当作全局胜率。只在所选根替换调度，后续仍用原V2。没有读取Holdout或修改生产默认。

## 同单位成本与结果

成本统一为kernel.applyFrame调用次数，不是policyValue节点，不是毫秒。

| 模式 | 18根总转换 | P50 | P95 | 单根干预续局胜/平/负 |
| --- | ---: | ---: | ---: | --- |
| CURRENT | 3319 | 171 | 257 | 6/6/6 |
| 完整层，最多depth2 | 3386 | 142 | 396 | 6/7/5 |
| 完整层，最多depth3 | 31675 | 1268 | 4096 | 5/7/6 |

depth2总工作+2.02%，但P95+54.09%。16根提交完整第二层，2根因支持不足保留第一层。出现1负→胜、1胜→平。

depth3总工作是当前9.54倍：9根提交第三层、7根保留第二层、2根保留第一层。出现1负→胜、1胜→平、1胜→负。
第三层没有给出可上线优势；更深与更强不能画等号，但也不能用这18根推导任何深度必然更差。

两组正反序18/18提交行值和动作均一致；CURRENT双方整局动作编码流与原基线一致；各模式目标根前缀和参数检查通过，状态恢复检查通过。

## 支持不足不是预算问题

depth3尝试中：4根预算中断、4根支持不足。另1根原调度目标就是depth2，并未尝试第三层。

具体支持不足：

- `mat_47l3Fw5p7tA55Hegn` seat1 frame75：第二层2次FAST_STATUS=3（UNSUPPORTED_RULE）。
- `mat_DQoobs2ny9DKnf9uy` seat0 frame59：第二层3次UNSUPPORTED_RULE。
- `mat_EqI2gfxnpT68zisaY`：第三层1次UNSUPPORTED_RULE。
- `mat_38XnRxtPKGA7AjsG8`的一侧样本：第三层2次Hard incomplete；该场景另一侧样本是预算中断，不能仅按matchId合并原因。

这些状态不是终局死亡证明。当前完整层合同正确拒绝发布整层；增加预算不能修复unsupported规则。

## 工具及测试

- `native-complete-layer-poc.js`增加`--sample-per-outcome`，记录同单位CURRENT成本及每层支持失败明细。
- `complete-layer-scheduler.js`保留失败证据，与预算中断分开。
- 确定性抽样、结果分层、每局唯一根和失败证据新增UT；相关26项UT通过。
- 开发原型仍使用快照及异常中断，尚不满足零热分配生产要求。没有用其wall time宣称性能优势。

证据：

- `artifacts/native-causal-audit/bp291-balanced-depth2-calibration.json`
- `artifacts/native-causal-audit/bp292-balanced-depth3-calibration.json`

复用命令：`node tools/agentank/diagnostics/native-complete-layer-poc.js <bp280输入> <新输出> --work-budget 4096 --max-depth 3 --sample-per-outcome 6`。

## 下一步优先级

1. 定位UNSUPPORTED_RULE和Hard incomplete具体发生于什么动作/规则/帧，不先扩大预算或改变Hard。
2. 第三层先研究规模压缩和完成成本预测，保留完整层提交合同；不用删除危险敌方响应换取虚假完整。
3. 深度2的胜→平样本和深度3新增胜→负样本进入估值审计，区分启发叶与对手模型偏差。
4. 获得支持完整、工作量可控的候选后再做整局Discovery A/B；目前不进行全局上线或全量资格对战。
