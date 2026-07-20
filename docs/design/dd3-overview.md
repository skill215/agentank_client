# DD3 Overview 与一致性审计

状态：DD3 COMPLETE，2026-07-15。DD4 READY。

## 1. 阶段结论

DD3 的目标不是写可对战 Tank，而是证明 DD2 的逻辑状态能用高性能、无语义截断的 JavaScript 物理架构实现。结论为通过：两档真实复合 workload 的 20 个 correctness oracle 均零失败，source/minified fingerprints 一致，全部容量故障遵守 incomplete/emergency/undo 合同。

冻结结果：

```text
multi-world       common immutable base + immutable sorted WorldDelta
singleton         direct PhysicalState fast path, same RulesKernel
hot pools         preallocated TypedArray SoA
support           exact prefix + lossless residual overflow path
search driver     explicit preallocated stack
branch recovery   generated BranchMark + separate Event/TransitionDelta buffers
derived cache     direct-address interface candidate; miss = recompute
```

## 2. 退出门检查

| DD3 退出条件 | 结果 | 证据 |
|---|---|---|
| 真实复合 workload | PASS | map、skill、multi projectile/bomb、hidden factors、partition、matrix、apply/undo、mixed policy |
| 多 PhysicalWorld 并存 | PASS | immutable records，交替 materialize oracle |
| snapshot/delta 选择 | PASS | delta typed 在保守档等速且节省约 85% world bytes |
| scalar/driver/support/cache A/B | PASS | 两档 11 samples，明确选择及保留边界 |
| Result/Policy/Event/Delta/BranchMark ABI | PASS | [dd3-frozen-abi.md](dd3-frozen-abi.md) |
| 容量和 high-water | PASS | 两 profile manifest + event/delta high-water |
| 故障注入 | PASS | FACT/SUPPORT/SEARCH/CACHE/OUTPUT/EVENT/DELTA |
| source/minified 一致 | PASS | support/semantic/terminal fingerprints 相同 |
| OI-ARCH-001/002 | CLOSED | 可实现性与地图布局已验证 |
| DEC-0101/0102/0106 | SUPERSEDED | `DEC-0039` 至 `DEC-0042` |

## 3. 跨文档一致性检查

| 主题 | 权威文档 | 检查结果 |
|---|---|---|
| Logical InformationState | information-state storage contract | 无冲突；DD3 只选择物理表示，不改变联合 support/partition |
| Terminal/Hard/Proof | DD1 contracts | 无冲突；prototype 值不能生成平台 Proof，incomplete 不升级 exact |
| Action/Result/Policy | action-result ABI | 无冲突；统一 arena/handle 与 0–10000 mixed policy 保留 |
| Capacity overflow | manifest schema | 无冲突；五类容量语义与 emergency 分离 |
| Map/dynamic entities | state/storage + frozen ABI | 无冲突；column-major static terrain 与 entity pools 分离 |
| Cache | cache contracts + DD8 | 无冲突；DD3 只冻结 miss=recompute 和版本化接口，不提前冻结 inventory |
| Platform rules | RuleCorpus/DD4 | 无越权；synthetic workload 未升级为规则证据 |
| Production sizing | manifest/DD8 | 无越权；32×32/128 worlds 仍是 BUILD_CONFIGURED |

扫描中发现并处理的旧状态文本只有“DD3 前/待 DD3/当前 DD3 READY”；规范入口、storage/ABI/layout/interface 和 decision/issue register 已统一改为 DD3 后状态。保留在历史段落中的“DD3 前禁止冻结”是阶段门事实，不构成当前冲突。

机械验证结果：29 份 design Markdown 的相对链接、code fence、DEC 引用和 OI 引用全部通过；capacity JSON 可解析；prototype 通过 `node --check`。独立 source/minified 运行的三类 semantic fingerprints 在两个 profile 均一致。

## 4. 未关闭但不阻塞 DD4 的项目

- 平台最大地图、实体、world/support 和正式 bundle 字节门：`OI-R3-008`，DD8。
- source/minified 平台引擎是否反转 TypedArray/stack 选择：`OI-R3-005` 进入 DD8 复核，不再是 DD3 架构阻塞。
- trajectory/cache 的完整 inventory、entry count、替换与跨帧失效：`OI-ARCH-007`，DD8。
- 真实碰撞、技能、bomb、visibility、128/runtime 细节：R0/R1/R2 RuleVariant，正是 DD4 的输入。
- Topology/Hazard 的生产增量算法：DD5，由 Reference/Fast differential 冻结。

这些项目都有明确 UNKNOWN/incomplete/variant 行为；没有一个要求 DD4 猜测平台规则或修改 DD3 ABI。

## 5. DD4 准入判断

DD4 可以开始，理由是：

1. ReferenceKernel 所需的 PhysicalState、InformationState、Event、Result 和 capacity failure 已可无损表达；
2. DD4 可以使用对象友好 Reference 实现校准规则，同时用已冻结 canonical trace/ABI 作为输出边界；
3. 未确认平台规则都已登记为有限 RuleVariant、interval 或生产阻塞，不会被 prototype synthetic 数值替代；
4. 任何 DD4 发现“状态字段无法表达”的反例会触发 ABI revision 并回到 DD2/DD3，而不是在 Reference 中私藏字段。

DD4 当前状态：**READY**。下一步按路线先建立可执行 RuleCorpus 与 ReferenceKernel contract，再运行平台 replay/外部 simulator 差分和 R1 support 校准。
