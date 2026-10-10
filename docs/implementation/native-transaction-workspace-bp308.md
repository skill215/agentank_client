# BP308：可复用事务基线与恢复校验

## 修改与验证

开发调度器新增可选SearchTransactionWorkspace：一次构造Search/Kernel的固定快照、完整state数组校验副本与元数据存储。每根begin时复制进已有缓冲区，层开始恢复搜索基线，层结束按undo mark回退，然后检查完整state数组和hash。没有通过覆盖state副本来掩盖undo错误。

19×15 FastState、FastKernel和专用Search实测工作区6,313字节；提交slab3,576字节，共9,889字节（仅这些新增TypedArray，不含JS对象及整控制器）。不能把这项开发工作区当成已接受的production内存增量。

18根三模式54次，相对BP292矩阵、动作、深度、展开量、胜负及restore零差异。新增UT覆盖反复复用同一buffer、重入拒绝、undo恢复和绕过undo的数组污染必须报错。未知异常路径清理时先恢复包装方法，避免恢复校验异常使包装器残留。

结果：`artifacts/native-causal-audit/bp308-transaction-workspace.json`。

## 仍未完成

提交与事务快照已经预分配，但完整调度器仍有预算Symbol/异常中断、每层闭包、attempt/evidence对象、Set/string诊断。当前不能称整个调度器零热分配。本轮没有生产搜索改动，也不声称实测加速。

下一步应集中处理调度核心：固定层结果记录、持久预算控制及中断状态传播，将详细诊断留在外围oracle；不是继续缩减快照字段。需要同时检查正常完成、预算中断、支持不足、准入拒绝和未知错误五条出口。待整个核心闭合再统一做性能标定及生产接线，而非逐项直接上线。

## 重跑

```sh
node tools/agentank/diagnostics/native-complete-layer-poc.js artifacts/native-causal-audit/bp280-root-oracle36.json artifacts/native-causal-audit/<新唯一结果>.json --work-budget 4096 --max-depth 3 --sample-per-outcome 6 --source-transition-from 4a5056ae736d5d4cc1bd3f397837c4cc2660ba516dc6e580e17760c2fbbdadba --transaction-workspace
node --test --test-isolation=none test/minimax-core/search-transaction-workspace.test.js test/minimax-core/complete-layer-scheduler.test.js
```

production tree保持 `019352b765a19385e2c86b34096944af6f60e799d885abe92f50e5267e82b7eb`。未调用平台接口。
