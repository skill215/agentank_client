# BP309：固定层记录与预算控制

开发侧新增FixedLayerScheduler，固定4层work/status数组（20字节）、4项证据引用槽、一次绑定的spend方法与一次创建的预算Symbol。正常run不新建attempt数组、层对象、结果对象或预算闭包，直接返回自身；报告转换在单独diagnostic方法中分配。

预算仍通过抛出持久Symbol退出当前递归：没有为每次中断构造Error/stack，但没有证明JS运行时抛出行为绝对不分配。未知异常原样传播，不能误吞为预算耗尽。生产递归尚未迁移为显式status传播。

五类出口：COMPLETED、INCOMPLETE_SUPPORT、BUDGET_INTERRUPTED、ADMISSION_REJECTED、未知异常。准入拒绝发生在层执行前，保留上一次完整提交。

## 验证

- 26种预算×5种支持失败深度×2种准入模式，共260组，固定核心与旧completeLayers oracle返回结果一致。
- 额外测试未知异常传播、重入拒绝、下次调用重置、预算边界和缓冲区引用保持。
- 18根、三种模式54次，采用事务工作区+提交slab+固定控制后，矩阵、动作、评分、深度、展开量、胜负、restore对BP292零差异。
- 全部minimax UT 318/318通过。

结果 `artifacts/native-causal-audit/bp309-fixed-control.json`。生产tree仍为 `019352b765a19385e2c86b34096944af6f60e799d885abe92f50e5267e82b7eb`。

## 不能过度宣称

固定控制核心已消除上述显式逐层分配，但实际开发适配器仍构造每层callback、包装方法、evidence/Set/string及诊断对象，runDiagnostic亦分配。尚非整条搜索路径零热分配，也未测本轮速度收益；默认production没有使用该调度器。

下一步应一次完成“瘦执行适配器”：预绑定方法，把搜索完整性写入固定字段，去掉执行路径上的详细诊断，仅在外部采集；继续以现有丰富诊断版作oracle。整条路径闭合后统一标定，不再只优化单个记录字段。若要取消异常退出，必须先为递归各层加入预算状态传播并验证所有apply/undo出口，不能只改顶层catch。

```sh
node tools/agentank/diagnostics/native-complete-layer-poc.js artifacts/native-causal-audit/bp280-root-oracle36.json artifacts/native-causal-audit/<新唯一结果>.json --work-budget 4096 --max-depth 3 --sample-per-outcome 6 --source-transition-from 4a5056ae736d5d4cc1bd3f397837c4cc2660ba516dc6e580e17760c2fbbdadba --transaction-workspace --fixed-layer-control
npm run test:minimax-core
```

没有官方simulate、publish或challenge。
