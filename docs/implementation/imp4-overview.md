# IMP4 Value、Matrix、Information Proof 与 Risk Overview

状态：`G3_G8_ALGORITHM_PASS / ACCEPTED / IMP5_ELIGIBLE / RELEASE_NOT_READY`，2026-07-16。

本Overview记录[实施计划](../design/implementation-plan.md)中IMP4的实现与验收结果。IMP4实现新的Minimax搜索核心和IMP3 Fast/Hard的深层物理桥接；整数评分、StrategySelector、OpponentModel、技能soft feature与PersistentPlan仍属于IMP5。

## 0. 验收结论

执行：

```text
./tools/imp4-toolchain.sh verify
./tools/implementation-toolchain.sh accept --stage IMP4
```

`A4-01`至`A4-08`全部PASS，最终166/166测试通过。Gate fingerprint为`27f16eb94976276e05cfb4719b96ba7d9d8a685b10fd32c6f53c20b03a8d89f0`；Acceptance fingerprint为`bddc370eb154b52d3aafdf0a8506ac140e718d8a81f11872738674444b4229e8`。

current报告位于[imp4-acceptance-report.json](../../artifacts/reports/acceptance/IMP4/imp4-acceptance-report.json)，不可变报告为[imp4-acceptance-bddc370eb154b52d3aafdf0a8506ac140e718d8a81f11872738674444b4229e8.json](../../artifacts/reports/acceptance/IMP4/history/imp4-acceptance-bddc370eb154b52d3aafdf0a8506ac140e718d8a81f11872738674444b4229e8.json)。

## 1. SearchState、Value与物理桥接

- `InformationGraph`用TypedArray表达Physical/Information搜索节点、完整support、联合cell、概率和coverage，不把hidden/chance/enemy压成ScenarioGroup；
- `ValueSearch`输出sound lower/upper、BoundKind、interval semantic和incomplete reason。普通evaluator只有ordering point，terminal-game区间保持`[-10000,+10000]`；
- simultaneous深层先计算`max_a min_b L`与`min_b max_a U`，依赖不完整时即使数值相等也不升级exact；
- `PhysicalTreeBuilder`使用显式frame栈直接执行IMP3 Fast make/undo。两层2×2联合动作fixture实际检查20个物理cell，正常与容量失败路径均恢复root；
- 当前物理树深度上限6、节点512、边4096，都是`BUILD_CONFIGURED`正确性容量，不是IMP6 benchmark后的发布参数。

## 2. 受限矩阵与Policy

- `StageMatrix`只保存整数lower/upper/risk interval；`DoubleOracleSolver`从pure witness开始，双方每批都扫描完整action set的best response，初始restricted support不能永久删除回应；
- regret matching+使用整数regret、平均策略、最大余数法和总和10000的PolicyArena；2×2完整exact cell使用同一外扩比较器的闭式专门化；
- RPS在512 iteration下返回`[-75,+75]`、gap 150的可复现approximate policy；Matching Pennies返回0 gap和10000总概率；iteration数量从不冒充exact；
- matrix cell先完成chance/hidden递归risk，enemy contamination只变换一次，根不重复施加risk。

## 3. InformationState Proof

- `ProofSearch`实现ForcedWin、ForcedNonloss、ForcedLoss和ActionRefuted的三值AND/OR量词；simultaneous ForcedLoss必须存在同一column覆盖全部rows；
- 我方/敌方strategy consistency、world、chance、observation、terminal、capacity与assumption进入CoverageCertificate；任何缺口把strict结果降为UNKNOWN；
- DFS与DFPN共享同一图和饱和proof/disproof number；预算中断只发布UNKNOWN，不保留启发式false positive；
- 穷举243个2×2终局量词组合，Proof false positive为0。低概率world仍阻止证明，chance probability大小不改变universal Proof。

## 4. 递归风险

- ChanceOutcome、HiddenWorld、EnemyAction三维分别使用整数epsilon-contamination，0–100映射到0–9900 nominal weight；
- risk=0等于support worst；risk=100仍保留1%污染。对`[-10000,+10000]`、50/50 fixture，结果由-10000单调上升到-100；
- 所有除法向外取整，无Float32/Float64语义数组；101个risk点与BigInt离线Oracle零差异；
- stateRiskClass只读整数局面字段；risk变化不改变Hard、Terminal、Proof trace或strict fingerprint。

## 5. Oracle、性能与故障

- 穷举81个2×2整数零和博弈：pure interval、Double Oracle policy interval对有理数真值的遗漏均为0；
- 最终搜索核心预分配125个整数TypedArray、121,110 bytes，Float typed array与tracked hot allocation均为0；
- normal/fallback使用同一semantic，预算不足只放宽区间；搜索实现不含MCTS、Monte Carlo、`Math.random`或热路径时钟读取；
- node/edge/proof/coverage/policy/matrix容量不足均返回incomplete/UNKNOWN/approximate，不能生成截断policy或strict Proof；
- 本阶段cache-off即正确，任何后续cache只能提升性能，不能成为语义前提。

## 6. 下一阶段

IMP5已经取得准入。它在本阶段Hard/Proof/Value量词不变的前提下实现整数FeatureRegistry、Table/Generated evaluator、动态StrategySelector、本局OpponentModel、八技能soft descriptor和Plan生命周期。IMP5不得用评分、对手概率或风险偏好收紧本阶段sound interval，也不得改变`HARD_REJECT_PROVEN/HARD_INCOMPLETE`与strict Proof。
