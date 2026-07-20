# V2 对照 V1 第一轮结构修复

状态：`STRUCTURAL_REPAIR_IMPLEMENTED / LOCAL_DISCOVERY_PASS / PLATFORM_UNVERIFIED`，2026-07-17。

## 1. 本轮结论

本轮只修复 V1/V2 对战实验暴露的结构问题，不进行性能调参，也不修改冻结 V1、冻结 V2 Candidate 或旧实验结果。当前工作树源码身份为 `44e084e917ddd32d42503854842ea04a60bcb16a895ef38f16c73cfe5701e5ec`。

在 266 个历史场景、两个 repetitions、四种出生位/技能变体上共运行 2,128 场。本地 V2 为 1,173 胜、955 负；原生 V1 stun / V2 poison 为 541/1,064，技能交叉为 632/1,064。对冻结 V2 可精确比较的旧 1,952 场，V2 从 731 胜提升到 1,082 胜，增加 351 胜；其中原生从 315/976 提升到 495/976，增加 180 胜。

这个结果证明本轮结构改造方向有效，但不代表玩法问题已经全部闭合。旧胜局中有 237 场转为失败；全部 2,128 场仍有 955 场失败，而且 1,064 个重复组中有 349 组的胜负、终局原因或死亡类型不稳定。后续必须继续按失败链分类，不能仅凭总胜率接受算法。

## 2. 修复范围

### 2.1 所有有效根动作统一进入 FinalActionGate

[final-action-gate.js](../../engine-v2/src/runtime/final-action-gate.js) 在任何动作打分前，对完整根动作集合逐一执行 Hard 检查；搜索、Plan 和启发式只能排序，不能授权动作。选定动作在未改变的根状态上再次检查后才允许输出。

有效根不会再绕过 HardGate 进入几何 fallback。`ACTION.NONE` 作为最后一个合法但最低分的应急保持动作；只有其他动作全部被拒绝时才可能选中。几何 fallback 仅保留给输入无法构造状态的无 bundle/非法根，不能参与正常策略选择。

### 2.2 已提交子弹和炸弹成为跨帧实体与 Plan

[production-root.js](../../engine-v2/src/runtime/production-root.js) 为子弹和炸弹维护固定槽位、实体 id 与 generation。实体一旦观察或由我方动作创建，就持续存在到撞墙、命中土堆、越界、爆炸或其他物理失效；多子弹使用独立槽位，并允许一个 Plan 绑定多个实体。

`FIRE` 与 `THROW_BOMB` 在打分前先创建 PlanSketch，只有最终成功输出的动作才物化 PersistentPlan。下一帧 Plan 从 `PENDING_EXECUTION` 绑定到实际实体的 slot+generation 并激活；实体消失、generation 不匹配、执行失败或 deadline 到期时完成或失效。任何 Plan continuation 仍需经过 Hard 验证，Plan 不能覆盖硬失败条件。

### 2.3 PhysicalState 与 InformationState 分权

完整且可见的单一物理状态可以进入深层物理 Value 搜索与严格 ForcedWin。可见位置已知但其他观察字段不完整时，深层物理结果只能由 [production-information-search.js](../../engine-v2/src/search/production-information-search.js) 接收为 `supportComplete=0 / approximate=1` 的快速界；它可以参与分数，不能授权 Hard 或 Proof。

敌方不可见时，固定数组 HiddenWorld、EnemyAction 与 ChanceOutcome 分别聚合，并使用整数 ε-contamination robust backup。敌方可能开火、可能位于草丛或可能投弹始终属于软风险；只有已经存在且物理信息足以证明的子弹/炸弹才进入 Hard。

### 2.4 ForcedWin 改为多帧严格 AND/OR Proof

[production-forced-win-search.js](../../engine-v2/src/search/production-forced-win-search.js) 使用固定 TypedArray 保存每层动作族，逐 horizon 扩展我方 OR、敌方/技能 chance AND。只有精确可见的 singleton PhysicalState 可以触发证明；普通 horizon 叶不是胜利值。动作族不完整、预算耗尽、状态不完整、teleport 目标族或 boost compound 族未闭合时一律返回 `UNKNOWN`，不能误触发强制胜利。

Proof 和 Value 共用同一个 callback work reserve。Proof 记账后重新计算剩余节点预算，必须保留最终 HardGate 和 emitter 的最低预算。

### 2.5 诊断可重复且历史数量动态化

新增入口：

```text
./tools/v1-v2-working-arena.sh --repetitions 2 --progress-every 64
```

[v1-v2-working-arena.js](../../tools/agentank/diagnostics/v1-v2-working-arena.js) 固定冻结 V1 字节和冻结参数，只把当前 `engine-v2/src/**/*.js` 作为待测实现；每个 role 完成后重新校验源码 hash。它保留四格换位/换技能实验、逐局进度、分 role 报告和相对冻结 V2 的转移矩阵。

[historical-scenarios.js](../../tools/agentank/simulation/historical-scenarios.js) 从当前 V1 corpus snapshot 和 ledger 动态构造历史场景，逐个验证 raw replay SHA-256，不写死 244 或其他对局数。本轮 snapshot 共 266 个 V1 历史场景，其中 22 个不在旧 DD9 锁定 assignment 内，只进入 `ROLLING_DISCOVERY`。

## 3. 本地验收证据

完整报告位于 [working-arena-overview.json](../../artifacts/diagnostics/v1-v2-working/44e084e917ddd32d-r2-discovery-calibration-frozen-rolling-3c663bc6/working-arena-overview.json)。

### 3.1 硬不变量

| 检查 | 结果 |
|---|---:|
| 可避免的 Hard reject | 0 |
| 所有候选均拒绝的不可避免状态 | 195 |
| 被拒动作被最终输出 | 0 个可避免案例 |
| 根状态恢复失败 | 0 |
| 热路径分配诊断 | 0 |
| V2 本地 callback timeout | 0 |
| V2 error | 0 |

四个 role 均为 `PASS`。195 次 selected Hard reject 全部对应 `unavoidableAllRejected`，有效根最终保持 `NONE`，没有从正常根绕到未经检查的几何动作。

定向测试为 42/42 通过。全量测试为 269/278 通过；9 个失败全部位于旧 IMP8/IMP9 冻结身份与发布证据链。当前工作树源码已改变，旧 Candidate 又必须保持字节不可变，所以预检按设计阻止其继续作为当前发布物，并连带阻止旧 IMP9 release evidence。不能通过覆盖冻结 manifest、bundle 或官方失败证据来消除这些失败；下一次准备发布时必须生成新的 Candidate 身份并重新执行对应 gate。除这 9 个身份链失败外，没有新增规则、搜索、Plan、模拟或平台工具测试失败。

### 3.2 与冻结 V2 的同局转移

| 分组 | 冻结 V2 胜 | 当前 V2 胜 | 变化 |
|---|---:|---:|---:|
| 原生 | 315/976 | 495/976 | +180 |
| 技能交叉 | 416/976 | 587/976 | +171 |
| 合计 | 731/1,952 | 1,082/1,952 | +351 |

| 转移 | 场数 |
|---|---:|
| LOSS → WIN | 588 |
| LOSS → LOSS | 633 |
| WIN → LOSS | 237 |
| WIN → WIN | 494 |

滚动新增 22 个场景产生 176 场：V2 91 胜、85 负；原生 46/88。该部分没有旧 Candidate 同局基线，只作为新增 Discovery 覆盖。

### 3.3 重复稳定性

两个 repetition 分别为 591/1,064 与 582/1,064。按“历史场景 + variant”合并后，715/1,064 组终局签名稳定，349/1,064 不稳定。V1 使用本地 wall-clock/runtime fallback，模拟器执行时序和运行负载会影响部分轨迹，因此不得把单次本地胜率或细小胜率差当作确定结论。

## 4. 明确不纳入本轮验收的内容

### 4.1 炸弹死亡

本轮共有 26 次本地炸弹死亡。简化模拟器使用“炸弹爆炸在动作前”的 phase，而平台已确认的顺序是 action → projectile → bomb。因此这 26 场只能用于发现候选场景，不能作为平台物理真值，也不能据此修改 FastKernel 或 Hard 规则。

### 4.2 性能

本轮本地统计为 V2 每局 P95 410,679 微秒、V1 P95 475,514 微秒；这只说明当前本地脚本运行，没有证明平台性能优于 V1。平台是整局 3 秒预算，本地 runner 不是平台计时模型；历史官方 cold-smoke 的 3,012ms timeout 仍未闭合。

按照当前阶段决策，性能优化延后到硬结构问题完成并经 review 后进行。本轮没有为了本地耗时降低深度、节点预算、风险支持集或 Hard 检查覆盖。

## 5. 尚未闭合的问题

1. 2,128 场仍有 955 场失败；其中原生失败 523 场，必须继续按死亡前状态链拆分，而不是立即调权重。
2. 共有 811 次 projectile/collision 类失败。该分类混合了已提交敌弹、同帧敌方新开火和碰撞，需要从逐帧 trace 分开后才能决定是 Hard、风险模型还是移动策略问题。
3. 237 个旧胜局退化为失败，需要优先做成反回归样本；任何下一轮修复都必须同时报告 `LOSS→WIN` 和 `WIN→LOSS`。
4. InformationState 深层搜索当前是有界快速界；隐藏世界支持集不完整时仍然是近似值，不能升级为严格胜负证明。
5. teleport 目标族与 active boost compound 的严格 Proof 尚未闭合，当前正确行为是 `UNKNOWN`。
6. 128 帧终局、同星平台 runtime 判定和真实 3 秒 fallback 只能由官方平台证据闭合。

因此本轮状态是“第一轮结构修复完成并通过本地硬不变量”，不是“V2 已完成”或“可以发布”。下一步应从 955 个失败中构造分层 trace，先处理能复现的 projectile/collision 与 237 个反回归，再进入性能阶段。
