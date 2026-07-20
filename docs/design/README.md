# 高性能 Minimax 坦克设计规格

状态：DD0–DD10详细设计已完成并通过最终实施就绪审计，2026-07-16；实施计划已冻结，尚未进入v2坦克功能实现和平台runner实现，当前发布状态为`NOT_RELEASE_ELIGIBLE`。

本目录描述一个从头构建的高性能 1v1 坦克。旧坦克及不可变244局快照是证据索引、行为基线、API兼容参考、反事实检查点和回归对手，不是新架构的实现基础；持续新增的对局由滚动ledger/snapshot管理，任何固定数字都不代表当前总量。

## 设计优先级

1. 已证明的强制胜利必须优先执行。
2. 已提交危险导致的明确终局失败必须在动作评分前过滤。
3. 总运行时间、状态一致性和缓存正确性属于硬约束。
4. 其余不确定结果由 0–100 动态风险策略控制。
5. 在上述条件内最大化我方最终获胜概率。

## 阅读顺序

1. [design-authority.md](design-authority.md)
2. [detailed-design-index.md](detailed-design-index.md)
3. [decision-register.md](decision-register.md)
4. [open-issues-register.md](open-issues-register.md)
5. [detailed-design-roadmap.md](detailed-design-roadmap.md)
6. [action-scheduler-contract.md](action-scheduler-contract.md)
7. [frame-timeline-contract.md](frame-timeline-contract.md)
8. [terminal-proof-algebra.md](terminal-proof-algebra.md)
9. [rule-corpus-schema.md](rule-corpus-schema.md)
10. [observation-reconciliation-contract.md](observation-reconciliation-contract.md)
11. [entity-data-association-contract.md](entity-data-association-contract.md)
12. [information-state-storage-contract.md](information-state-storage-contract.md)
13. [action-result-abi.md](action-result-abi.md)
14. [memory-capacity-manifest-schema.md](memory-capacity-manifest-schema.md)
15. [dd3-frozen-abi.md](dd3-frozen-abi.md)
16. [architecture-prototype-report.md](architecture-prototype-report.md)
17. [dd3-overview.md](dd3-overview.md)
18. [reference-kernel-contract.md](reference-kernel-contract.md)
19. [rule-calibration-report.md](rule-calibration-report.md)
20. [dd4-overview.md](dd4-overview.md)
21. [fast-kernel-contract.md](fast-kernel-contract.md)
22. [hazard-kernel-contract.md](hazard-kernel-contract.md)
23. [reference-fast-differential-report.md](reference-fast-differential-report.md)
24. [dd5-overview.md](dd5-overview.md)
25. [value-search-contract.md](value-search-contract.md)
26. [matrix-policy-contract.md](matrix-policy-contract.md)
27. [proof-search-contract.md](proof-search-contract.md)
28. [risk-backup-contract.md](risk-backup-contract.md)
29. [dd6-overview.md](dd6-overview.md)
30. [evaluation-contract.md](evaluation-contract.md)
31. [strategy-selector-contract.md](strategy-selector-contract.md)
32. [opponent-model-contract.md](opponent-model-contract.md)
33. [skill-state-machine-contract.md](skill-state-machine-contract.md)
34. [plan-contract.md](plan-contract.md)
35. [dd7-overview.md](dd7-overview.md)
36. [cache-inventory.md](cache-inventory.md)
37. [runtime-fallback-contract.md](runtime-fallback-contract.md)
38. [production-build-contract.md](production-build-contract.md)
39. [dd8-overview.md](dd8-overview.md)
40. [legacy-corpus-manifest.md](legacy-corpus-manifest.md)
41. [counterfactual-validation-contract.md](counterfactual-validation-contract.md)
42. [release-gate-report.md](release-gate-report.md)
43. [dd9-overview.md](dd9-overview.md)
44. [rolling-corpus-contract.md](rolling-corpus-contract.md)
45. [artifact-lineage-contract.md](artifact-lineage-contract.md)
46. [platform-operations-contract.md](platform-operations-contract.md)
47. [dd10-overview.md](dd10-overview.md)
48. [dd0-dd10-consistency-audit.md](dd0-dd10-consistency-audit.md)
49. [final-implementation-readiness-audit.md](final-implementation-readiness-audit.md)
50. [implementation-plan.md](implementation-plan.md)
51. [rules-registry.md](rules-registry.md)
52. [high-performance-architecture.md](high-performance-architecture.md)
53. [kernel-interfaces.md](kernel-interfaces.md)
54. [memory-layout.md](memory-layout.md)
55. [search-semantics.md](search-semantics.md)
56. [hybrid-solver-contracts.md](hybrid-solver-contracts.md)
57. [cache-contracts.md](cache-contracts.md)
58. [simulator-integration-contract.md](simulator-integration-contract.md)
59. [legacy-evidence-contract.md](legacy-evidence-contract.md)
60. [benchmark-contract.md](benchmark-contract.md)
61. [fast-regression-contract.md](fast-regression-contract.md)

平台规则基线保存在 [../agent-guide.md](../agent-guide.md)。该页面元数据仍标注 2026-06-06，但正文已经包含后续变更；规则冲突以官方 Updates 的具体变更为最高优先级，并由 RuleRegistry 记录来源与版本。

## 当前范围

- 正式搜索目标：高性能 1v1。
- 物理实体层：支持多个坦克 owner、多颗子弹和多个炸弹。
- multiplayer：只保留物理兼容能力；多人博弈搜索留给独立分支。
- 运行模型：单线程、同步 `onIdle`。
- 数值模型：热路径使用整数、定点数、bitset 和固定容量 TypedArray。
- 产物：普通单文件 JavaScript，顶层入口为 `onIdle(me, enemy, game)`。
- 平台运行：build、服务器simulate、发布、挑战、下载、分析全部由离线脚本执行并保存RunManifest；v1、v2及未来tank由不同TankProfile/key管理，这些工具绝不进入坦克bundle。
- 外部模拟器：只作为可校准的候选 Oracle 和场景生成器，不进入正式搜索或生产 bundle。
- v1 遗产：分析、回放重建、对手侧反事实和 league 全部离线运行；正式包最多接收经过 A/B 验证的小型整数先验。

## 不在本阶段完成

- 不实现新坦克功能。
- 不把旧坦克 Minimax 作为新架构的实现基础；旧代码只通过离线 Adapter 用于证据提取、行为基线和回归对手。
- 不确定具体搜索深度、节点数、Arena 容量或置换表大小。
- 不猜测指南未说明的事件顺序和终局规则。
- 不为 Worker、共享内存或异步并行保留架构。

## 必须由实验决定的项目

- AgenTank 剩余JavaScript能力及冷启动行为；`Math.imul`缺失、Uint16Array/Uint32Array可用已经平台证据确认。
- TypedArray/显式栈在实际平台 source/minified 引擎中的复核；本地 DD3 默认候选已冻结。
- 表驱动评分器与构建期生成评分器。
- 正常、降级和 fallback 的深度及节点额度。
- Arena、缓存和紧急储备容量。
- 共享资源冲突和剩余 RuleVariant 的同 phase 准确顺序。
- runtime 精确相等规则与 3 秒 comparator。
- 生产脚本大小上限和大型查表生成方式。
- 同格移动、swap、多弹/多 bomb 共享资源的准确结算。
- 外部模拟器其余实现与真实平台规则的逐项差异；其 bomb-before-action 已被平台 replay 否定。

所有未决项必须优先通过官方 Updates、平台回放/定向 simulation 解决，再校准 ReferenceKernel、差分 FastKernel，并更新 RuleRegistry 与 RULESET_VERSION。外部模拟器的一致结果只能提供候选证据，不能单独升级严格 Proof 规则。
