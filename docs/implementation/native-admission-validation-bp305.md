# BP305：场景隔离的预算准入验证

## 预注册与隔离

保持BP304公式不变：`ceil(lastWork² / previousWork) <= remainingApplyBudget`。未调系数、阈值或风险参数。

排除BP280与BP303涉及的37个match ID，并按scenario fingerprint排除别名与另一座位。剩余场景用固定SHA盐选择16个，每场景1个已有真实搜索根，不按胜负或成本选择。manifest在运行前写入目标列表、预测器SHA、生产tree与门槛：`lostCompletedDepth=0 && avoidedWork>0`。

这是相对成本公式开发集的场景隔离验证；历史池此前用于过其他对战研究，不能称为完全未见过的胜率盲测。

## 结果

| 指标 | 结果 |
| --- | ---: |
| 总apply工作量 | 25,796 → 15,320 |
| 预计避免工作 | 10,476（40.61%） |
| 未提交层工作 | 16,853 → 6,377（减少62.16%） |
| 避开预算中断 | 2 |
| 成本门偶然避开的支持不足层 | 1 |
| 误拒绝已完成层 | 0 |
| 丢失已完成深度 | 0 |
| 放行后仍预算中断 | 0 |

原完整层计算最高完成深度：1层2根、2层10根、3层4根；影子准入保留这些深度不变。16场承载对局双方动作流及胜负与来源一致。四项准入/隔离UT通过。

三个拒绝点全部在尝试3层前：

- `mat_4CERCmkg3sR0RwcBk` seat0 frame121：估计7442，剩余3712，旧层预算中断。
- `mat_2oo7Bhd32HH4mziLA` seat0 frame25：估计11686，剩余3496，旧层预算中断。
- `mat_7j82fyujttV51dL8o` seat0 frame18：估计4033，剩余3792，旧层支持不足。

第三个不是“预测出了规则不足”，只是按成本拒绝；不能把这项结果变成支持完整性证书。

## 结论和后续

状态 `SHADOW_GATE_PASS`。不代表可直接上线。生产默认仍是原近似搜索；它并不具备开发完整层调度器的“上一已完成层矩阵提交”语义，不能把公式直接塞进其行共享预算分支。

下一步在开发侧完整层调度器加入在线准入钩子：实际不启动被拒绝层，并验证保留矩阵逐项等于无准入版本的最后完整层、状态恢复、工作量对账及五批真实耗时。公式保持冻结，当前验证集只用于该语义与性能验证，不再拿来调准入阈值。

然后才讨论零热分配事务提交和生产搜索的接线，且性能与估值/胜率恢复仍分开验收。本轮没有生产源码变更，没有平台请求。

## 证据

`artifacts/native-causal-audit/bp305-independent-admission/manifest.json` 与 `overview.json` 保存冻结样本、公式指纹、逐根展开与决策。生产tree仍为 `019352b765a19385e2c86b34096944af6f60e799d885abe92f50e5267e82b7eb`。

```sh
node tools/agentank/diagnostics/layer-admission-validation.js artifacts/native-causal-audit/<新的唯一验证目录>
node --test --test-isolation=none test/minimax-core/layer-admission-validation.test.js test/minimax-core/layer-admission-shadow.test.js
```

结果为反事实展开工作节省，不是已测40.61%墙钟加速，更不是胜率改善。16个根中零误拒绝也不构成全局零误拒绝保证。
