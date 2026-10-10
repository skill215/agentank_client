# BP298–299：可活度格架复用 POC

## 结论

复用方向有明显价值，但尚不启用生产。18 个既有根、三种模式共 54 次，17,319 次 reverseViable 与无缓存 oracle 的结果、complete、narrowProofComplete、horizon 全部一致。相对 BP292 的动作、行评分、完成深度、apply 次数、胜负、restore 零漂移。

生产源码树仍为 `4a5056ae736d5d4cc1bd3f397837c4cc2660ba516dc6e580e17760c2fbbdadba`。

## 先发现的正确性问题

`HazardKernel.computeReverseSignature` 依赖 TERRAIN_VERSION，而版本计数并不唯一标识回溯树中的地形。两个兄弟分支各击毁不同土块，可以具有相同版本号。

新增 UT 复现了两类错误：

1. 开放逃生角落缓存返回可活；同版本封闭角落后，旧格架仍返回 1，无缓存返回 0。
2. 即使不启用格架缓存，已有 hazard-signature rebuild 缓存也可能沿用错误爆炸范围：同版本另一分支移除了挡路土块，旧场仍不把后方格子标成 lethal，新建场则正确标记。

第 2 点是既有缓存键风险，不是新加格架引入的风险。UT 是构造的合法分支地形关系，尚未证明它在既有对战中造成了多少误判。不能据此归因整体低胜率。

## 诊断隔离

`AuditedLatticeHazard` 只在目标根替换搜索内部 hazard，退出后恢复原对象。地形内容逐格比较，变化时失效 hazard、exact 和 lattice 缓存；reverse signature 保守包含所有实体，包含会影响 horizon 的己方弹丸。使用现有 16 项 exact cache 加 4 项 lattice，不缓存特殊能力修正后的最终 pose 结果为通用格架。保持 `finalizeReverseResult` 原语义。

每控制器额外固定数组 4,881 字节；这是诊断方案，不宣称满足既有生产内存预算。构造发生在目标根外层；地形检查没有逐帧 subarray 临时视图。计时包装器和完整层调度器仍属于允许分配的开发工具。

## 复用结果

| 模式 | 查询 | exact 命中 | lattice 命中 | 格架重建 | 重建 pose-tick 节点 |
| --- | ---: | ---: | ---: | ---: | ---: |
| CURRENT | 677 | 131 | 442 | 104 | 948,480 |
| LAYERED | 8,315 | 1,976 | 5,492 | 847 | 8,218,260 |
| LAYERED_REVERSE | 8,327 | 1,961 | 5,528 | 838 | 8,166,960 |

完整层正序约 89.81% 查询不再重建格架。保留原深度、预算、危险截止时间与 Hard 语义。

## 初步时间（不能当正式性能资格）

与 BP297 单批插桩数据相比，18 根汇总 CURRENT 181.60→63.94ms，完整层正序 2267.66→587.68ms，逆序 2061.41→555.17ms。这里只说明值得进一步标定：不是预热五批、不是配对隔离环境；计时启动时与 oracle 运行末尾有短暂重叠，工具本身也有分配/插桩成本。不能声称平台提升 3–4 倍或已经解决 timeout。

## 下一步

1. 先把 terrain identity 修复单独做生产正确性变更，补齐 apply/undo 兄弟分支、回到旧地形和地图 reset 测试；审计其它同类版本键。
2. 格架复用再独立做固定输入、预热五批的 root/search pipeline A/B，包含无危险、弹丸、炸弹、土块分支；统计 P95、工作量与内存。
3. 只有语义、性能与内存门同时通过才接默认。不要为缓存效果改风险、深度或估值；已有估值退化是另一个问题。

## 可重复命令

```sh
node tools/agentank/diagnostics/native-complete-layer-poc.js artifacts/native-causal-audit/bp280-root-oracle36.json artifacts/native-causal-audit/bp298-lattice-verify.json --work-budget 4096 --max-depth 3 --sample-per-outcome 6 --lattice-cache 4 --verify-lattice
node tools/agentank/diagnostics/native-complete-layer-poc.js artifacts/native-causal-audit/bp280-root-oracle36.json artifacts/native-causal-audit/bp299-lattice-profile.json --work-budget 4096 --max-depth 3 --sample-per-outcome 6 --lattice-cache 4 --profile-phases
node tools/agentank/diagnostics/lattice-cache-report.js artifacts/native-causal-audit/bp298-lattice-verify.json artifacts/native-causal-audit/bp299-lattice-profile.json artifacts/native-causal-audit/bp292-balanced-depth3-calibration.json artifacts/native-causal-audit/bp297-phase-profile.json
```

诊断结果保存在 ignored artifacts；不生成逐帧 replay，不调用官方平台接口。
