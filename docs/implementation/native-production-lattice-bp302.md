# BP302：生产搜索启用四项格架缓存

## 修改

专用生产搜索 `bindIsolatedHard` 启用4项 reverse lattice，保留16项 exact cache，不保存tick1/tick2副本。新增可选 `reverseLatticeIncludesOwnProjectiles`：本搜索使用全部实体危险签名，包含影响horizon的己方弹丸；其它调用者默认签名行为不变。

同步 `base-policy-compact/policy-search.js` 上游与 specialized 输出。首次测试确实拦截了只改生成文件的问题；同步后可重复生成测试通过，没有修改测试期待来掩盖生成链漂移。

开发侧 AuditedLatticeHazard 现在复用production选项，不再自己重写签名，防止实测与上线使用不同实现。未改深度、fallback、工作预算、评分或风险规则。

最终 tree：`019352b765a19385e2c86b34096944af6f60e799d885abe92f50e5267e82b7eb`。

## 验证结果

- minimax 305/305；GR0 458/458；IMP5 14/14（套件之间有重叠）。
- 18个固定根、三模式54次：对旧BP292矩阵、动作域、评分、完成深度、工作量、胜负、restore零差异。最终证据 `bp302-production-lattice-final.json`。
- 固定16场景换位32局，分别运行direct/source/minified，共96局：三路均20胜9负3平；14次单方击毁胜、5次单方击毁负；FIRE160次。三路完整动作指纹相同。
- 指纹：`53571a20cca2b75076ed93256258be0cf81c6c258040877f2b1ddbf1f5d51124`。
- 三路检查timeout/error/rootRestore均0，tracked hotAllocations为0；这是现有分配计数，不是JS堆分配分析器的全覆盖证明。
- 该32局为已有开发集，结果与旧固定16一致，不宣称胜率提升或独立统计显著性。

## 内存与构建

首次实际搜索根整个可达 NativeBasePolicyEngine 的TypedArray底层buffer去重统计：OFF414,063字节，ON418,659字节，增加4,596字节。审计遍历整个控制器而非只算hazard；不包含普通JS对象/堆开销，也不是所有地图/整局峰值。

压缩包180,830字节，距离204,800字节上传限制余23,970字节。两次编译确定性通过，source/minified的32 callback fixture一致；后续三路整局资格同样通过。压缩SHA：`cff54cdd82d41d6d12591e6bdea94f7a282f005e8974d015db822d4978fc800a`。

资格状态为本地 `QUALIFIED`，不是官方simulate attestation或发布许可。未调用官方simulate、publish、challenge。

## 证据和下一步

证据目录 `artifacts/native-causal-audit/`：

- `bp302-production-lattice-final.json`：最终源码固定根差分。
- `bp302-memory.json`：控制器固定内存审计。
- `bp302-local-qualification/qualification.json`：本地三路整局、构建和不变量。
- `bp302-local-qualification/build-a/`：可检查的源码包、压缩包及manifest，未替换历史Candidate。

下一步优先在当前生产实现上重新标定深度成本及fallback预算分配。先保持动作策略不变；性能省出的预算不能直接视作更深必然更强，已有深层估值退化仍需单独处理。BP301是搜索入口局部A/B收益，不应声称整局或平台也加速相同比例。

标定入口已允许显式传入新的已验证源码证据，仍要求SHA匹配：

```sh
node tools/agentank/diagnostics/lattice-search-benchmark.js artifacts/native-causal-audit/<新标定结果>.json artifacts/native-causal-audit/bp302-production-lattice-final.json
```
