# BP307：预分配完整层提交存储

## 本轮完成

检查action-owner消费者后，将每个完整层的`value=snapshot(search)`替换为可选SearchCommitSlab：一次构造，随后capture/restore只复用固定数组。

保留root/nominal矩阵、动作域、交易分类、列序、exact标志共11组数组；35个数值/布尔标量暂保守保留，以维持完整性标志和诊断计数。深层动作栈、路径栈和历史数组不在提交结果中。标量使用Float64Array保存JS原始数值，不改变整数运算、截断或排序语义。

提交存储3,576字节。旧快照每层复制全部搜索TypedArray为4,523字节，另新建对象及标量属性；两者不是完整controller内存比较。本轮不宣称实测加速。

## 验证

- 18根、CURRENT/LAYERED/LAYERED_REVERSE共54次，动作、矩阵、评分、完成深度、展开量、胜负、restore对旧基线零差异。
- 11项相关UT通过，包含整数极值、数组引用不变、重复capture复用、未capture不得发布、层中断不覆盖旧结果。
- 结果：`artifacts/native-causal-audit/bp307-commit-slab.json`。
- 生产tree仍为 `019352b765a19385e2c86b34096944af6f60e799d885abe92f50e5267e82b7eb`。

## 尚未完成，不能混淆

本轮只是**结果提交路径不再逐层分配快照**。完整开发调度器仍包含根基线snapshot、kernel snapshot、state数组副本、attempt/evidence对象、Set/string统计、预算Symbol/异常控制。不是整个搜索零热分配，也未接入production。

下一步将事务基线和中断控制改为一次构造的固定工作区，并把详细诊断记录移出核心；继续拿现有调度器作为oracle。保留对所有state数组及hash的开发侧恢复校验，不因优化删除。只有完整事务等价、固定内存与实际耗时验证通过后才评估生产接线；现有搜索所有权仍不变。

## 重跑

```sh
node tools/agentank/diagnostics/native-complete-layer-poc.js artifacts/native-causal-audit/bp280-root-oracle36.json artifacts/native-causal-audit/<新唯一结果>.json --work-budget 4096 --max-depth 3 --sample-per-outcome 6 --source-transition-from 4a5056ae736d5d4cc1bd3f397837c4cc2660ba516dc6e580e17760c2fbbdadba --commit-slab
node --test --test-isolation=none test/minimax-core/search-commit-slab.test.js test/minimax-core/complete-layer-scheduler.test.js
```

无官方simulate/publish/challenge。
