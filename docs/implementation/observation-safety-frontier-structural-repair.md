# Observation Safety Frontier 结构修复 Overview

状态：生产接线、结构 UT、历史聚焦回归、SR2 性能门和 IMP6 构建门均已通过；未运行完整
V1/V2 arena，未冻结 Candidate，未调用官方 simulate/publish/challenge。

## 1. 闭合的逻辑缺口

上一阶段的 `ThreatCapabilityTimeline` 能回答“敌方未来什么时候重新具备 FIRE 能力”，但不能回答
更严格的问题：不同隐藏物理世界产生相同观察时，我方是否存在一个对这些世界都合法的共同后续
动作。逐个世界分别找到不同闪避动作，不构成 InformationState 上的安全策略。

新增 `ObservationSafetyFrontier` 后，四帧选择性安全证明使用以下量词顺序：

1. 固定正在评价的 root action；
2. 对每个受支持的敌方物理位置和方向；
3. 对每个敌方 action 与每个 ChanceOutcome；
4. 按下一帧真实可观察信息分组；
5. 每个观察组必须存在一个组内所有物理世界共享的己方 action；
6. 递归到四个联合帧，或在完整证明下提前停止。

容量不足、预算耗尽、物理内核不支持、观察 support 不完整或技能状态不完整时返回 `UNKNOWN`，
不会发布安全。未来可能 FIRE、隐藏敌方和 possible projectile 始终只影响 Safety/Risk；本阶段没有
修改 Hard gate。

## 2. 生产组合方式

生产 Safety 是两个互补层的组合，而不是由新前沿单独替换旧逻辑：

- `InformationSafetyClosure + ReverseViability` 继续把已提交弹丸和炸弹计算到规范失效/最后
  committed deadline，不受四帧 future-action 窗口截断；
- `ObservationSafetyFrontier` 只复核旧层拟发布为 `PROVEN_SAFE` 且 Hard=`ALLOW` 的动作，补上
  未来敌方动作、ChanceOutcome、物理推进和 observation split；
- 前沿返回 `NO_WITNESS` 时动作降为 Safety `PROVEN_DEAD`；返回 `UNKNOWN` 时降为 Safety
  `UNKNOWN` 并写满 unknown mass；只有完整 `WINDOW_SAFE` 才保留原安全结论；
- root/关键节点的 Hard、ForcedWin 和最终动作硬门没有被前沿写入或放宽。

这种“选择性安全认证”避免为已经是 `POSSIBLE_DEATH/UNKNOWN` 的动作重复展开昂贵物理树，同时
保持安全结论必须经过两个层级。它不是对全部动作风险向量的重新估值。

## 3. 固定内存和地图状态压缩

前沿所有 action、observation group、linked state 和 hash 数据均为构造时拥有的整数 TypedArray，
热路径不创建临时状态对象。状态池容量固定为 96；超过容量显式 `UNKNOWN`。

最初的直接实现为每个状态复制一张最大 32×32 地图，导致生产根 TypedArray 达到
1,630,164 bytes，正确触发 IMP6 的 1 MB 容量门。最终实现没有放宽门，而是利用物理规则中地形
只会发生单调 `DIRT -> OPEN` 的事实，将地图保存为：

- 一份 root terrain；
- 每个物理状态一张 1024-bit changed-cell bitmap；
- 每个状态独立保存坦克、弹丸、炸弹、scalar 和双 hash。

状态槽复用时会先清空对应 bitmap。专门 UT 验证 root dirt 与分支 destroyed dirt 的双向加载、
hash、delta/event cursor 均精确恢复。最终 `ObservationSafetyFrontier` 占 54,008 bytes，完整
production root 为 972,756 bytes，继续通过原有 1,000,000-byte 门。

## 4. 威胁选择性与技能边界

前沿只在威胁可能在剩余窗口触达时继续展开；该判断只能保守地多展开，不能漏分支：

- 已提交敌弹沿真实地形推进，并考虑我方剩余可达范围；
- 到期炸弹、敌方 active boost、ready boost 和 ready teleport 保留威胁分支；
- ready teleport 只是新增选择，绝不会遮蔽敌方普通 FIRE；
- ready boost 保留 `CAST_BOOST -> 加速对齐 -> FIRE` 的最早可能链；
- 一旦 FIRE 生成弹丸，后续物理帧由同一个 FastKernel 推进；
- teleport 枚举星星邻接的全部可通行目标；action/chance 容量不足时不截断成 exact。

独立小地图 allocating oracle 不复用前沿的 action generator、状态池或 observation grouping，已对
多组位置、root action 和 depth 1–2 做 differential。另有专门隐藏草地 fixture：两个单独世界
各自 `WINDOW_SAFE`，合并到同一观察后因不存在共同动作而为 `NO_WITNESS`。

## 5. 历史证据与剩余 witness

固定 `native-poison-death` 聚焦 cohort 共 160 entries：64 个主要单方死亡和 96 个换位/胜局控制，
共检查 352 个决策帧。

| 指标 | 结果 |
|---|---:|
| focused 执行 | 160/160，failure 0 |
| 前沿实际展开帧 | 18 |
| 前沿物理节点 | 122 |
| 前沿 root restore failure | 0 |
| 已确认假 `PROVEN_SAFE` | 4 → 0 |
| 新增 safe/fatal 帧 | 0 |
| exact replay failure | 0 |
| control survival regression | 0 |
| 剩余 audited safe/fatal | 1，已冻结 physical witness |

剩余项 `7b45916116e8…:11` 的 root action 是 `GO`。四帧物理前沿找到观察一致的后续生存策略；
历史固定 continuation 没有采用该后续动作而死亡。因此该记录证明“这次历史策略后续失败”，不证明
root `GO` 必死，不能把它降为 Hard 或 `PROVEN_DEAD`。专用验收器要求任何剩余 safe/fatal 都必须
属于冻结 witness 集，且 production frontier 确实返回 `WINDOW_SAFE`。

## 6. 性能、构建和可重复验收

| 门 | 结果 |
|---|---:|
| SR2 tests | 34/34 |
| SR2 composite P95 | 3,091 μs / 上限 3,108 μs |
| SR2 hot allocation | 0 |
| IMP6 G4/G7/G9 gate | 201/201 |
| production source/minified differential | mismatch 0 |
| source bytes | 463,321 |
| minified bytes | 357,738 |
| production root TypedArray | 972,756 / 上限 1,000,000 |
| deterministic source hash | `b7f65b066aa95eb684d9b9cad145800019574836b56208069b23264c202304be` |
| deterministic minified hash | `d51127e6ac235648f7e5eee012185423c80a1bacf72ab7b4d49742b85040bb70` |

可复用命令：

```sh
./tools/fast-regression-toolchain.sh diagnose-focused \
  --cohort native-poison-death \
  --report-name native-poison-death-observation-frontier

./tools/fast-regression-toolchain.sh verify-capability-repair \
  --report-name native-poison-death-observation-frontier \
  --classification-name physical-safety-oracle \
  --before-name native-poison-death-safety-chance \
  --output-name observation-frontier-verification

./tools/imp6-toolchain.sh verify
./tools/structural-repair-toolchain.sh verify --stage SR2
./tools/fast-regression-toolchain.sh verify-observation-frontier
```

最后一个命令统一绑定 focused report、physical/capability comparison、SR2 gate、IMP6 gate、
BuildManifest 与当前 working source，并拒绝 root restore、性能、容量、源码身份或 source/minified
任一漂移。

不可变证据：

- focused report：`artifacts/fast-regression/reports/native-poison-death-observation-frontier/2c6f4cc62bc44633fd117cf8d06c64b8a2497b51380fec9968c89d1da978c134.json`；
- capability comparison：`artifacts/fast-regression/reports/observation-frontier-verification/3a3f7da850bc605b4eee3637786ac514f6ade272f58415d1e204cdc743546a25.json`；
- unified acceptance：`artifacts/fast-regression/reports/observation-safety-frontier-verification/43e9dce9066367155f9fd8218798fb3c23af6d9a6baf229eb176b3ff60a5a1e0.json`；
- SR2 gate：`a5e71e2b7dd6b5562f5dd3c05be00d7021f3a123e33936638d96babec688afa6`；
- IMP6 gate：`c882f4b2aa8d40812679b7fd68709a18f9871024b57be119ba703952a0f6833e`。

## 7. 尚未授权和后续边界

- 聚焦历史样本中实际展开的 18 帧都是 singleton/可见物理支持，因此 observation group 计数为
  0；隐藏世界共同动作语义由独立 Oracle 和结构 UT 约束，但仍应在未来 Rolling Discovery 中收集
  真实隐藏多世界样本。
- 96 个状态槽和物理节点预算是完整性边界，不足时只会增加 `UNKNOWN`；后续可在 SR5 用真实
  profile 比较容量/速度，但不能为了提高 safe 数量放宽 fail-closed 语义。
- 当前阶段只认证旧 Closure 拟发布的安全动作；它不替代 SR3 多维 RiskAcceptanceController，也
  不调整攻击压力、领先保护、stun 策略或 gameplay 参数。
- 完整固定 arena、SR3/SR4 战斗门、Candidate、官方 simulate 和发布均不属于本阶段授权。
