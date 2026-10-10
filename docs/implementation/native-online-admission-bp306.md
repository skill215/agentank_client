# BP306：开发调度器在线预算准入

## 实施范围

`completeLayers` 增加可选准入钩子，只收到前两次完整层工作量及剩余预算。在调用下一层之前拒绝时返回 `ADMISSION_REJECTED`、work=0，保留上一完整层矩阵与深度。默认无钩子行为不变。

`prepareLayered` 传递该钩子；实验使用BP305冻结公式/指纹。没有修改production搜索、预算、评分、fallback或风险参数。生产tree仍为 `019352b765a19385e2c86b34096944af6f60e799d885abe92f50e5267e82b7eb`。

## 五批实测

固定BP305的16个场景，各侧每根预热3次，五批每批3次，共480次计时。两侧都使用已上线的4项格架缓存；OFF/ON在这里指**预算准入**，不是格架开关。

| 指标 | OFF | ON |
| --- | ---: | ---: |
| 累计耗时 | 1619.38ms | 1001.88ms |
| 每次搜索P50 | 3.782ms | 2.869ms |
| 每次搜索P95 | 18.790ms | 12.964ms |
| 每16根apply工作量 | 25,796 | 15,320 |

总耗时减少38.13%，P95减少31.00%。三根在下一层执行前拒绝，实际展开工作与BP305离线预测完全一致。五批总耗时均改善。

每次比较保留矩阵、nominal矩阵、动作域、exact标志、完成深度与对应提交搜索计数，零差异；工作量和停止原因预期不同，独立保存，不强求相同。所有状态数组/hash恢复检查通过。16场承载对局双方动作流与原基线一致。

## 验收与边界

相关16项UT通过，覆盖不执行被拒绝层、保留上一提交、全放行与旧调度一致、预算/支持失败和未知异常清理。

本轮证明的是开发侧完整层调度器的局部收益，不是当前生产近似搜索提升38.13%，也不是平台整局耗时下降。完整层调度器仍使用对象快照、异常预算中断及调试统计，有热分配；不能直接复制到production。

下一步是开发侧零热分配的提交/回退机制：明确需要保留的root矩阵、完整性标志和必要状态，预分配最小提交slab，验证每种中断路径都返回最后完整层。不能全量复制整个Search对象进热路径。仍先做等价和内存/性能验证，暂不改变默认动作所有权。

## 证据与重跑

结果 `artifacts/native-causal-audit/bp306-online-admission.json` 保存240+240次计时、每次展开和停止原因；生产源码指纹与BP305预测器指纹均校验。

```sh
node tools/agentank/diagnostics/lattice-search-benchmark.js artifacts/native-causal-audit/<新的唯一结果>.json artifacts/native-causal-audit/bp302-production-lattice-final.json --online-admission
node --test --test-isolation=none test/minimax-core/complete-layer-scheduler.test.js test/minimax-core/layer-admission-shadow.test.js test/minimax-core/lattice-search-benchmark.test.js
```

没有发布、官方simulate或challenge。
