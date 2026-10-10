# BP316：修复MIN/MAX哨兵参与比较

## 结果

四处归约修复已落入生产生成代码：deep MIN、deep MAX、root响应MIN、可配置own-chance worst。由首个实际子节点建立初值，不再把±32000当作一个虚构子节点。空域回退、nominal同分次序、数组未计算标记和全部参数保持原语义。

全量Minimax UT：336/336通过。新增/迁移测试覆盖终局幅度、49种值组合×3个blend、根首列被mask、逆序遍历、nominal权重为0、own chance多个组及nominal平手。

## 固定16场景影子结果

32局双座位，2,328个旧版搜索根。旧版继续拥有实际动作，修复版只在相同根计算：

- 153根的root评分向量或domain发生变化（6.57%）。
- 11根的原始最高分行变化（0.47%）；这不是经过Risk/intent/最终门之后的实际改选。
- 双方完整动作流与来源全部一致；实际结果保持21胜10负1平。
- 未运行修复版ACTIVE对战，不能以这个结果声称修复提高或降低胜率。

本轮沿用工具中的depth/status字段仅表示旧预算下计划深度和正常完成调用，不表示complete-layer或严格Proof。未调用完整层4096预算实验。

单轮影子局部计时：旧版search总计2427.59ms，修复版2571.36ms；P95为3.855ms和4.052ms。分别约+5.9%、+5.1%。固定“影子先执行”的顺序、包装器和缓存差异会影响计时，这不是正式五批性能标定，也不是平台3秒证据。

## 生成链和证据

上游为 `tools/agentank/diagnostics/native-bounded-policy-search-poc.js`，经base-policy→compact→specialized生成。首次完整测试发现既有BP302四槽lattice配置仅留在下游，重新生成会退为零槽；已将既有配置同步上游，并重新生成测试。最终specialized与冻结旧源码差异严格限于四处归约修复。

旧源码保存在 `artifacts/native-causal-audit/bp316-reducer-repair/baseline-policy-search.js`。影子运行目录为 `artifacts/native-causal-audit/bp316-reducer-shadow/`，manifest绑定旧文件SHA和当前production tree。

```sh
node tools/agentank/diagnostics/thin-whole-game-shadow.js <新目录> \
  --reducer-baseline artifacts/native-causal-audit/bp316-reducer-repair/baseline-policy-search.js
```

影子时临时切换新旧四个方法，恢复各组件数组/标量和hazard绑定；退出时恢复新production方法。生成后完整UT通过，影子整局双方动作和结果指纹通过。

新production tree：`285f9863227d6af3638bed74e008f0260fd25440034d95eec5e3f8cac44d9120`。

## 下一步

先对这11个原始改选根检查最终动作所有者，确认评分差异是否真正传到输出；再做固定16场景修复版ACTIVE对照，并进行匹配输入交错五批计时。不要用影子结果冒充ACTIVE胜率，暂不扩大全量对战。

本修复解决有限评分归约正确性，不解决未知物理分支、有限值域证明或整体战略问题。区间搜索接入仍单独推进。没有官方simulate、publish或challenge。
