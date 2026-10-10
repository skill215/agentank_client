# BP304：下一层预算准入离线影子实验

## 规则（未调参）

仅在已有两个完整层的工作量后，估计下一层：

`estimate = ceil(lastCompletedWork² / previousCompletedWork)`。

若估计超过剩余apply预算，则影子判定不启动下一层。没有两个完整层时保持原行为。不使用下一层结果、胜负、耗时或风险标签作为预测输入；下一层结果只用于事后评分。这是增长率点估计，不是成本上界，更不是Hard或Proof。

未扫描倍数、阈值或针对单个根特判。预算保持4096 apply，生产仍未接入这个准入器。

## 开发集结果

使用BP303的18根既有记录，未重新对战：

- 总工作量：31,675 → 20,465，预计减少11,210次apply（35.39%）。
- 未提交层工作量：17,133 → 5,923，减少65.43%。
- 4次预算中断中事前挡住3次，漏掉1次。
- 误拒绝已完成层：0；已完成深度丢失：0（仅限这18根）。
- 不拒绝规则支持不足的层，四个支持不足根仍如实保留原结果。

保留的浪费包括一次低估后的预算中断3817次apply，以及支持不完整的2106次apply。没有以事后已知“支持不足”为由伪装成在线可节省工作。

## 限制

这些根已经被反复分析，不是盲测。不能据此宣称35%真实耗时收益、零误拒绝保证、胜率上升，或对未来局面都适用。也不能仅依据成本预测把Incomplete升级为Safe。

下一步将公式冻结，在未参与BP291–304的匹配场景上采样，观察完整层覆盖、误拒绝可完成层、预算中断漏判和节省工作量。按match/scenario隔离，而非只换同一局的帧。若误拒绝明显，不在已读验证集上调阈值重验。尚无独立验证前不接入production。

## 工具与测试

工具：`tools/agentank/diagnostics/layer-admission-shadow.js`。

结果：`artifacts/native-causal-audit/bp304-layer-admission-shadow.json`；绑定BP303输入SHA与生产tree。只保存紧凑预测记录，无replay。

新增3项UT：边界/整数校验、未来结局不能改变准入决定（并显式记录误拒绝）、成本低估及规则支持不足的分类。统计实现使用实际停止状态，而非把“刚好用完预算”等同中断。

```sh
node tools/agentank/diagnostics/layer-admission-shadow.js artifacts/native-causal-audit/bp303-depth-calibration.json artifacts/native-causal-audit/<新的影子结果>.json
node --test --test-isolation=none test/minimax-core/layer-admission-shadow.test.js
```

生产源码、深度、fallback、评分和动作所有权均未修改；没有任何平台写操作。
