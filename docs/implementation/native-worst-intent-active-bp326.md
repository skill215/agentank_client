# BP326：保留intent的最坏值优先 ACTIVE

## 结论

**NEGATIVE，不进入production。** 固定16场景、换位32局，WORST_INTENT为16胜15负1平，综合得分51.5625%，低于当前默认62.5%。BP325识别的intent混杂真实存在，但消除该混杂没有恢复整体收益。不能把修复首次分歧等同于修复整局。

本轮仅调整根比较为 `(worst + bonus, expected + bonus)`，bonus复用当前 `backed - blend`，不调150分intent，不改递归cell、敌方权重、搜索深度、预算、owner候选集合、Hard或最终门。默认诊断模式仍保留BP324的tie-only语义。

## 对战结果

| 指标 | 当前默认 BP317 | intent后置 BP324 | 保留intent BP326 |
| --- | ---: | ---: | ---: |
| 胜/负/平 | 20/12/0 | 15/14/3 | 16/15/1 |
| 综合得分 | 62.5% | 51.5625% | 51.5625% |
| 单方击毁胜局 | 13 | 9 | 7 |
| 单方被击毁负局 | 8 | 7 | 7 |
| FIRE次数 | 172 | 85 | 110 |
| 星差 | +2 | -8 | +5 |

相对当前默认：保留12个胜局、7胜转负、1胜转平、4负转胜、8负不变。净损失3.5个得分，下降10.9375个百分点。

相对BP324：4负转胜，但2胜转负、1胜转平、3平转负，总得分持平。不是等价行为，也不能因此说两架构数学等价。

原6个退化胜局中，仅JjG seat0恢复胜利，另外5局仍负。首次动作差异已推迟至动作流索引14–33（零基callback索引，不是官方frame）；说明早期intent路线恢复后，后续最坏值排序仍会改变整局。I52、2oo仍负，原目标帧已不保证同状态，不能把离线根选择当作本轮实际救援。

## 机制解释与边界

沿新轨迹有2,507个owner根、331次替代。2,479个替代候选带非零exactBlock：这里的最坏值是有限响应域、递归混合、可能中断的战术估计，不是严格安全证明。

结果支持拒绝“把该估计全局升级为最终动作优先级”这个改法。它没有证明minimax无效，也不能仅凭FIRE下降认定直接禁火是全部原因：路线、转向、时机和后续敌方响应同样改变。星差改善而单方击毁下降，与用户希望增强战斗能力的目标不一致。

下一步不再扫描intent或风险权重，也不扩大这个负收益候选。先对本轮7个胜转负与4个负转胜的首次分歧做同根证据审计：攻击机会是否被普通最坏位置值压制，最差响应是否有完整支持，候选的攻击purpose与开火后自逃是否可验证。用正反两类约束一个有限覆盖条件；在没有区分证据前，保留当前默认，不引入新的全局排序。

## 复现与证据

Minimax完整UT以 `node --test --test-isolation=none test/minimax-core/*.test.js` 运行，355/355通过。

```sh
node tools/agentank/diagnostics/root-value-separation.js \
  artifacts/native-causal-audit/bp326-worst-intent-active --active --worst-intent
node --test --test-isolation=none test/minimax-core/root-value-separation.test.js test/minimax-core/intent-factor-audit.test.js
```

输出目录不可覆盖。manifest、overview、压缩逐局与首分歧样本共30,244字节，无完整replay。7项定向UT通过，包含新2项primary-intent合同测试。32局error、timeout、root restore均为0；未把这些指标冒充未测量的完整Hard/Proof证书。

production tree SHA-256前后均为 `285f9863227d6af3638bed74e008f0260fd25440034d95eec5e3f8cac44d9120`。不修改production默认，不调用平台，不提交或推送。该开发集反复使用，不作独立显著性结论；本地整局耗时受局长及诊断开销影响，不作平台性能结论。
