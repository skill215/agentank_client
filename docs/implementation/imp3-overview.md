# IMP3 FastKernel、Hazard 与硬失败层 Overview

状态：`G2_G3_G4_CORE_PASS / ACCEPTED / IMP4_ELIGIBLE / RELEASE_NOT_READY`，2026-07-16。

本Overview记录[实施计划](../design/implementation-plan.md)中IMP3的实现与验收结果。IMP3只实现生产物理、已提交危险和逐动作Hard；Value、Matrix、Proof、Risk与Minimax仍属于IMP4，未提前混入。

## 0. 验收结论

执行：

```text
./tools/imp3-toolchain.sh verify
./tools/implementation-toolchain.sh accept --stage IMP3
```

`A3-01`至`A3-09`全部PASS，最终142/142测试通过。Gate fingerprint为`4fffb41aa7d5e4f87c8e7b542c1719ebe31aad76132cfd9aeb8d452f87cdcb7d`；Acceptance fingerprint为`6c148c570f66d9f136ce9178001e1cdeeb90d312800b5466eb0b077a17692688`。

current报告位于[imp3-acceptance-report.json](../../artifacts/reports/acceptance/IMP3/imp3-acceptance-report.json)，不可变报告为[imp3-acceptance-6c148c570f66d9f136ce9178001e1cdeeb90d312800b5466eb0b077a17692688.json](../../artifacts/reports/acceptance/IMP3/history/imp3-acceptance-6c148c570f66d9f136ce9178001e1cdeeb90d312800b5466eb0b077a17692688.json)。

## 1. Fast物理结构

- `FastState`使用38个TypedArray SoA承载terrain、双tank、8 projectile、4 bomb、effect deadline和scalar状态；entity slot具有独立generation与外部semantic id；
- 所有热写入先写预分配DeltaArena，再更新双整数signature；BranchMark以整数打包delta/event cursor，undo只逆放旧值，不重算parent；
- EventBuffer与Delta分离，单transition分别限制64 event、96 delta；event/delta不足在任何物理写入前fail closed；
- 当前TypedArray核心预分配为1,075,574 bytes，其中大部分是到256 projectile substep的committed hazard timeline。这是`BUILD_CONFIGURED`正确性profile，不是平台上限，也不是IMP6最终发布容量。

## 2. Reference差分和UNKNOWN边界

最终机器差分覆盖20个exact/common场景：move、turn、fire、bomb放置/爆炸、star、八技能cast、poison ACT/HOLD、stun reversed chance、overload fire及三条无需未决规则的canonical trace，逐字段mismatch为0。

第四条bomb/projectile/freeze复合canonical trace依赖`FREEZE_EMPTY_QUEUE_POLL_V1`的开发期选择。生产Fast没有复制该猜测，而是返回`FAST_UNSUPPORTED_RULE`并恢复root；该行为计为1个expected unsupported。move/star/shared projectile/multi-bomb/exact runtime tie等未解决variant同样不能静默选择默认值。

## 3. Committed Hazard与Hard

- 已出现projectile/bomb按独立slot建立SourcePlan，并正推到边界、墙、土、爆炸deadline或规范失效；相同physical/hash直接命中，只有实体/terrain变化才重建；
- Hazard时间轴区分exposure与lethal，多个来源用计数叠加，不用XOR抵消；enemy“可能开火”没有实体，因此不进入Committed plane；
- ReverseViability按真实相位执行：每帧动作发生在第一颗projectile子步前，两颗子步之间不能移动；bomb deadline与projectile tick分开映射；
- 每个候选在评分前执行`apply -> Terminal/Hazard/Reverse -> classify -> undo`。已提交且不可躲的子弹返回`HARD_REJECT_PROVEN`；实际移动可躲则`HARD_ALLOW`；shield、boost、teleport或dirt narrow phase覆盖不足时返回`HARD_INCOMPLETE`，绝不冒充必死；
- 16次重复Hard候选检查的tracked hot allocation为0，root mismatch/stale read/partial mutation/silent truncation均为0。

## 4. 容量与性能边界

[imp3-capacity-manifest.json](../../config/engine-v2/imp3-capacity-manifest.json)明确区分FACT、SUPPORT、SEARCH、CACHE和OUTPUT五类容量。ROOT entity、EVENT、DELTA required-minus-one故障均显式incomplete并完整undo；cache缺失只重算，不返回默认安全。

v1亲测有效的固定工作量思想已落实到这一层：所有map/projectile/bomb/hazard循环都有生成上界，不在热物理里读取`Date.now()`，也没有Map/Set/filter/map/Math.imul或临时语义对象。整局1.5/2.5秒等价work计量仍由后续RuntimeController统一收费，不能由FastKernel自行猜时间。

## 5. 下一阶段

IMP4已经取得准入。它必须在本阶段Fast/Hard不变的前提下实现sound lower/upper、受限矩阵、InformationState AND/OR Proof和递归epsilon-contamination risk。Risk、OpponentModel或评分不得改写本阶段的`HARD_REJECT_PROVEN/HARD_INCOMPLETE`，未解决RuleVariant也不得因搜索方便被选定。
