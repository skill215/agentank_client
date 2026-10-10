# BP310：轻量完整层执行适配器

## 实施

ThinLayerExecutor一次构造事务工作区、提交slab、固定scheduler及预绑定方法。执行路径不再每层生成包装函数、Set、字符串键、候选矩阵报告或失败witness对象；复用单个层结果对象。apply包装使用固定六参数，不收集rest数组。保留完整state/hash恢复检查。

正常完成、预算耗尽、准入拒绝、支持不足均返回最后完整层；未知异常先恢复方法与根状态再原样抛出。重复run复用相同缓冲区、结果和绑定函数。详细报告由外部diagnostic转换生成，不在轻量核心计时内。

## 验证与实测

- 18个固定根×三模式54次，对BP292的矩阵、动作、评分、完成深度、apply量、胜负和restore零差异。
- BP305冻结的16个场景，双方同样开启格架与预算准入；各侧预热3次、五批每批3次，240+240次计时。
- 丰富诊断执行器806.91ms，轻量563.56ms，总耗时减少30.16%。P95：9.774→6.876ms，下降29.64%。
- 比较最后提交矩阵、nominal值、动作域、exact标志、深度及对应搜索计数，均一致；承载对局双方完整动作流保持一致。
- 新增UT覆盖预算与准入出口、未知异常恢复、结果和方法复用。全部minimax UT结果见本轮测试日志。

## 边界

这里比较的是**丰富开发诊断路径与轻量开发路径**，不是当前production近似搜索又提升30%。两者计时区别包含报告/统计移出核心，这是预期收益，不能把比值外推到平台整局。

执行器没有显式逐层对象分配；仍使用持久Symbol异常实现递归预算退出。未进行V8堆分配采样，不能保证整个JS运行时严格零分配。尚未完成production构建/沙箱接线。

production tree仍为 `019352b765a19385e2c86b34096944af6f60e799d885abe92f50e5267e82b7eb`。生产默认近似搜索没有被换成完整层搜索；此替换可能改变动作及胜率，不能作为纯性能改动直接上线。

下一步应结束单个开发组件细化，进行整局影子接线：默认动作仍由现有搜索给出，记录轻量完整层的成本、完成深度及动作分歧；若进入ACTIVE对照，须单独评估整局收益/退化，不能把更深等同更优。

## 证据

- `artifacts/native-causal-audit/bp310-thin-executor.json`
- `artifacts/native-causal-audit/bp310-thin-benchmark.json`

```sh
node tools/agentank/diagnostics/native-complete-layer-poc.js artifacts/native-causal-audit/bp280-root-oracle36.json artifacts/native-causal-audit/<新唯一结果>.json --work-budget 4096 --max-depth 3 --sample-per-outcome 6 --source-transition-from 4a5056ae736d5d4cc1bd3f397837c4cc2660ba516dc6e580e17760c2fbbdadba --thin-layer-executor
node tools/agentank/diagnostics/lattice-search-benchmark.js artifacts/native-causal-audit/<新唯一基准>.json artifacts/native-causal-audit/bp302-production-lattice-final.json --online-admission --thin-comparison
```

未调用任何官方平台写接口。
