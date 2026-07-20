# Future FIRE capability 结构修复 Overview

状态：窄范围结构修复与本地验收完成；未运行完整 arena，未冻结 Candidate，未调用官方
simulate/publish/challenge。

## 1. 修复目标

物理 Safety Oracle 将上一轮 12 个“生产模型判安全、固定后续死亡”的帧分成 4 个确认的
`CONFIRMED_FALSE_PROVEN_SAFE` 和 8 个存在观察一致生存策略的 witness。四个确认缺陷具有同一
结构：根帧敌方暂时不能 FIRE，但已有弹丸会失效、技能节拍会恢复，敌方可在未来 1–4 帧重新
开火；旧 `InformationSafetyClosure` 把根帧 `enemyCanFire=false` 错当成整个窗口都不能开火。

本修复只补齐这个时间维度。它不把未来可能 FIRE 提升成 Physical Hard，也不把离线 simulator
Oracle 搬进生产热路径。

## 2. 生产结构

新增 `ThreatCapabilityTimeline`，由每个生产 root 复用一个固定对象：

- 预分配 5 个槽位的 `Uint8Array canAct/canFire`，覆盖根决策帧及其后四帧；
- 从已提交弹丸、静态地形、fire lock、freeze 和相对 poison cadence 推导未来 action/FIRE 槽；
- 等待弹丸失效的帧可以与转向或移动准备重合，`earliestCompletion(requiredActions)` 返回最早
  完成动作链并开火的帧；
- 容量、观察、技能状态或平台规则证据不完整时显式降级 `complete=0`；
- 构造后无节点级对象、无随机数、无浮点 TypedArray，声明并实测热路径分配为 0。

生产 root 在 Hard gate 完成后只准备一次 timeline，再把同一个只读派生结果交给所有 root action
的 `InformationSafetyClosure`。Safety slab 新增 `futureFireDepth`，每个 action 保存未来开火链最早
触达帧；完整 support 写入 horizon fatal mass，不完整 support 写入 unknown mass。Hard gate 的输入
与判定没有改变。

## 3. 规则证据冲突处理

两个确认案例来自 pinned simulator 的“绝对偶数帧 poison cadence”，但平台指南、真实 replay
和现有校准合同采用相对施加帧 `ACT-HOLD-ACT-HOLD`。本修复没有为了通过 simulator fixture 去改
Reference/FastKernel 的平台语义。

`ProductionObservationAdapter` 会校验 callback 中的 `canActThisFrame` 与相对 cadence。出现冲突
时，只把 `enemyCapabilitySupportComplete` 降为 false；Safety 因而不能发布 `PROVEN_SAFE`，但也
不会伪造一个 exact 未来状态或写入 Hard。另两个 support 完整案例则由 timeline 产生明确的未来
FIRE depth 和 fatal mass。

## 4. 可复用验收入口

聚焦回归：

```text
./tools/fast-regression-toolchain.sh diagnose-focused \
  --cohort native-poison-death \
  --report-name native-poison-death-capability-timeline
```

结构验收：

```text
./tools/fast-regression-toolchain.sh verify-capability-repair
```

验收器分别约束三种量词结果：

1. 4 个确认缺陷必须全部离开 `PROVEN_SAFE`，同时保持 Hard=`ALLOW`；
2. support 完整时必须有未来 FIRE depth 与 fatal mass，support 不完整时必须有 unknown mass；
3. 8 个物理 witness 不能变成 Hard reject 或 `PROVEN_DEAD`；剩余的 audited `PROVEN_SAFE` 只能来自
   witness 集合。

它还约束新假安全为 0、一步假阳性为 0、event exact replay failure 为 0、control survival
regression 为 0、执行失败为 0。工具输出内容寻址、源码绑定、cohort 绑定的不可变报告。

## 5. 验收结果

最终生产源码身份：
`a858453ffae3619a7eee32d5e6a24af1674df3f2387e2b96a173c60eda917796`（76 files）。

| 证据 | 结果 |
|---|---:|
| 确认假安全 | 4 → 0 |
| focused `MODEL_PROVEN_SAFE_FIXED_CONTINUATION_DIES` | 12 → 1 |
| 剩余 audited safe | `7b45916116e8…:11`，物理 witness |
| 新增 safe/fatal 帧 | 0 |
| exact replay failure | 0 |
| control survival regression | 0 |
| focused execution failure | 0 |
| focused action reproduction failure 变化 | +1（23 → 24，非物理 replay/安全门） |
| fast-regression UT | 40/40 |
| SR0–SR4 + minimax + fast-regression | 127/127 |
| SR2 P95 | 1,091 μs（上限 3,108 μs） |
| SR2 热路径分配 | 0 |

不可变证据：

- 修复后 focused report：
  `artifacts/fast-regression/reports/native-poison-death-capability-timeline/6f399bc28882be2d4c89b302732a0166e8f57e661134ada61dd5f2cd30a6a12e.json`；
- repair verification：
  `artifacts/fast-regression/reports/capability-repair-verification/cb5de86d513c96d0117b81d6749f4b9310f912ec70872cf2f3905b72f47e528b.json`；
- SR2 gate：
  `artifacts/reports/structural-repair/SR2/history/sr2-gate-1940b7bad71a6a60ef793aad99bc52cfe8826c8c6babfca1bf7e63a162b9c858.json`。

## 6. 尚未闭合的边界

这不是完整的递归 `ObservationSafetyFrontier`。当前生产 Closure 仍使用每个 root action 的静态
projected cell/direction 来计算威胁链，没有逐帧物理推进所有后续己方动作、敌方动作、
ChanceOutcome 和 observation split。timeline 也只是 root-shared capability 上界，不等同于按未来
物理分支精确追踪坦克/盾导致的弹丸提前失效。

因此下一结构阶段应构造固定容量、预算可中断的 observation-consistent frontier，并以独立小地图
Oracle 做 differential test。任何不完整或预算中断仍必须返回 `UNKNOWN`；只有完整 frontier 才能
发布新的 `PROVEN_SAFE/PROVEN_DEAD`。本阶段证据只授权继续该详细设计与窄修复，不授权完整 arena、
Candidate 或平台写操作。

## 7. 后续状态

上述下一阶段已经完成。固定容量、观察一致、四帧物理推进的生产前沿及其独立 Oracle、历史回归、
性能/容量门和统一验收见
`docs/implementation/observation-safety-frontier-structural-repair.md`。本文件中的数值与源码 hash
继续作为 `ThreatCapabilityTimeline` 阶段的历史证据，不用后续结果覆盖。
