# BP301：格架缓存预热五批搜索标定

## 结论

搜索入口 A/B 性能门通过，值得进入生产接线验证；本轮未开启默认格架缓存。没有增加深度、修改评分或改变动作所有权。

| 搜索模式 | OFF 总耗时 | ON 总耗时 | ON/OFF | OFF P95 | ON P95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 当前 prepare | 542.84ms | 207.62ms | 38.25% | 7.88ms | 2.59ms |
| 完整层上限3 | 6562.26ms | 2272.68ms | 34.63% | 181.23ms | 46.91ms |

当前模式各批 ON/OFF 总耗时比均低于 40%；完整层各批均低于 36%。P95为该模式全部270次搜索耗时的 nearest-rank 分位数，不是五个批次均值的分位数。每批亦保留54次样本的总耗时与P95。

当前模式18个根的平均用时均下降；完整层17个根下降，`mat_D4zc69YG9N4DygT1n` 增加约8.80%。不将聚合加速表述为每种局面均加速。

## 方法

- Node v24.16.0；生产 tree `9f0c7d75854f36ddf1b5b20d7d94091a8bf2f8a1b1bc5865c37b5293e318ca7d`。
- 沿用BP300的18个真实根，来源是原胜/平/负各6的分歧样本，不是全局随机局面。
- 每根、每模式OFF/ON各预热3次，然后5批，每批各3次；OFF/ON交替顺序。
- 两种搜索模式，每种每侧270次计时，共1080次计时搜索（另216次预热）。
- 在实际对局到达根时做内存内重复；构造、状态恢复、指纹检查、场景文件读取均不计时。
- 每次恢复相同Search/Leaf/Path/Kernel/Hard/FastState输入；hazard缓存每次回到冷根起点，只计一次搜索内的复用，不能靠重复同根的跨次缓存制造加速。
- CURRENT计时为真实`search.prepare`。完整层计时包含开发侧调度器、快照和复用统计开销；不能称为完整production controller延迟。未插桩每个细粒度函数。
- 没有与其他基准并行运行；此为本地相对性能，不能替代平台3000ms验证。

## 一致性与工作量

每次比较根矩阵、nominal值、动作域、exact标志、搜索计数；完整层另比较每层状态、工作量和证据。全部零差异。每次检查状态数组与hash恢复。结束后继续原对局，18场双方完整动作流和分析胜负与旧来源一致。

累计格架构建pose-tick节点：

- CURRENT：64,586,700 → 14,227,200。
- 完整层：761,514,300 → 123,273,900。

这些是避免重算的工作量收益，不是减少minimax展开规模。

## 内存及尚未完成的门

移除了开发侧重复地形快照/检查，直接依赖BP300生产修复。ON相对OFF增加4项格架共4,596字节（19×15图）。BP300地形快照两侧都有，不重复计为ON增量。

ON仍为实验类：保守将全部弹丸纳入格架签名，避免己方弹丸引起的horizon差异。尚未把该签名语义和4项开关接入production默认。尚未重新构建上传包、核对完整控制器内存上限、证明整局runtime或胜率改善。

下一步：小范围生产接线（签名完整性+4项缓存），跑规则oracle、默认动作差分、完整控制器内存/构建检查，然后再决定是否保持默认。不要同时增加深度或调整fallback，否则无法归因。

## 重跑与测试

结果：`artifacts/native-causal-audit/bp301-lattice-search-benchmark.json`（含全部五批样本）。

```sh
node tools/agentank/diagnostics/lattice-search-benchmark.js artifacts/native-causal-audit/<新的唯一文件名>.json
node --test test/minimax-core/lattice-search-benchmark.test.js test/minimax-core/audited-lattice-cache.test.js test/minimax-core/hazard-terrain-identity.test.js
```

脚本拒绝覆盖结果、校验BP300源码指纹，结束时再次检查源码未变化。新增UT覆盖snapshot恢复对象/别名、P95定义和批次分母。没有官方平台写操作。
