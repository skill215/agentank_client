# BP300：修复危险缓存的地形身份

## 已实施

仅修改 production `fast/hazard.js` 的缓存身份，不改搜索深度、风险阈值、估值、格架开关或技能规则。原有 dirty 修改保留。

每个 HazardKernel 构造时分配一份当前地图大小的 Uint8Array 地形快照；每次计算危险签名前逐格比较真实地形。地形变化时失效 hazard rebuild、exact reverse 和 lattice 缓存。`loadReverseLatticeLayers` 同样经由此检查，不能在 rebuild 之前取到旧层。

不靠版本号或新地形哈希猜测相等；没有逐次分配。19×15 地图每 HazardKernel 增加 285 字节固定数组（控制器可能有多个 HazardKernel，不能把 285 当作完整 pipeline 内存增量）。既有危险/实体签名仍使用原哈希，本轮没有声称解决其所有碰撞或依赖问题。

## 验证

- minimax core：301/301。
- GR0：454/454。
- IMP5：14/14。三组存在重叠，不相加作为独立测试数。
- 新增 apply/write/undo 兄弟分支（相同 TERRAIN_VERSION）、回退到旧地形、同尺寸地图重置、层直接读取、正常命中保持测试。
- BP298 的诊断复现测试转为修复后正向约束：相同版本封闭出口必须返回不可活；移除阻挡后，爆炸后方格必须变为 lethal。没有改变场景几何来迁就实现。
- 固定 18 根、CURRENT/LAYERED/LAYERED_REVERSE 共 54 次，对 BP292 的动作、行评分、apply 数、深度、胜负和 restore 零差异。CURRENT 还校验双方完整动作流，所有分支检查强制根之前的双方前缀。

原始缺陷在构造分支中已确认并修复；这 18 根没有因修复改动作，不能说这次提高了胜率，更不能声称修好了全局低胜率。

## 源码与证据

- 修复前 tree：`4a5056ae736d5d4cc1bd3f397837c4cc2660ba516dc6e580e17760c2fbbdadba`。
- 修复后 tree：`9f0c7d75854f36ddf1b5b20d7d94091a8bf2f8a1b1bc5865c37b5293e318ca7d`。
- 结果：`artifacts/native-causal-audit/bp300-terrain-identity.json`。
- runner 新增显式 `--source-transition-from <旧tree>`；没有该选项仍拒绝源码漂移。结果记录真实新 tree 和旧 baseline tree，结束时再次校验源码没有运行中变化。

```sh
node tools/agentank/diagnostics/native-complete-layer-poc.js artifacts/native-causal-audit/bp280-root-oracle36.json artifacts/native-causal-audit/bp300-terrain-identity.json --work-budget 4096 --max-depth 3 --sample-per-outcome 6 --source-transition-from 4a5056ae736d5d4cc1bd3f397837c4cc2660ba516dc6e580e17760c2fbbdadba
node tools/agentank/diagnostics/search-phase-profile-report.js artifacts/native-causal-audit/bp300-terrain-identity.json artifacts/native-causal-audit/bp292-balanced-depth3-calibration.json
```

## 边界与下一步

专用搜索 `reverseLatticeCacheEntries` 仍为 0。本轮没有构建新上传包，也没有 simulate/publish/challenge。既有冻结 Candidate 保留原字节，不代表已包含此修复。

下一步在新 tree 上比较 lattice OFF/ON：固定输入、预热、五批 root/search pipeline 测量，报告 P95、同输入工作量、内存增量与结果一致性。需要重测而不能直接沿用 BP299 的旧源码、单批插桩时间。开发侧 AuditedLatticeHazard 的重复地形检查亦应在基线修复后简化，再做正式比较。
