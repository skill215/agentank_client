# 物理 Safety Oracle 分类 Overview

状态：本地分类完成；4 个缺陷已冻结；后续窄范围 capability timeline 修复已通过本地验收，仍未
重跑完整 arena。修复结果见 `docs/implementation/future-fire-capability-structural-repair.md`。

## 1. 目的与边界

上一轮修复后还剩 12 个“生产 Safety=`PROVEN_SAFE`，但固定历史后续最终死亡”的帧。
固定后续死亡本身不能证明 Safety 错误，因为根动作之后仍可根据新观察改选动作。本阶段因此没有
直接调整 V2，而是增加一个离线物理 Oracle，回答更严格的问题：

> 固定被审计的根动作后，是否存在一个按观察历史选择后续动作、并能对所有敌方动作和
> ChanceOutcome 存活至原终局窗口末端的策略？

Oracle 使用固定 simulator commit `1ef804eb2c187138c4c8e5229fb37cd0126beddf`。它只提供
1–4 帧局部物理证明，不宣称全局获胜或整局安全，也不写入生产 Hard。

## 2. 量词与完整性

搜索顺序固定为：

1. 根 V2 action 固定为被审计动作；
2. 当前 PhysicalState、敌方合法原子动作和 stun ChanceOutcome 全称展开；
3. simulator 物理推进后按 V2 observation fingerprint 分组；
4. 每个观察历史组允许 V2 存在性选择一个共同动作；
5. 重复至 `distanceToTerminal + 1`，最大四帧。

相同观察下的隐藏世界不能选择不同动作；观察分裂后可以改变策略。任何具体致死分支足以反驳
一个己方动作，但只有所有己方动作均有反例时，才能形成 `NO_WITNESS`。预算、动作 support、
Chance support 或 belief 容量不完整一律返回 `UNKNOWN`，不能产生安全或缺陷证明。

普通、poison、stun 原子动作 support 在当前 12 个案例中完整。teleport target 与 active boost
compound program 尚未穷举，因此遇到它们会显式不完整。历史出星 provider 是有状态闭包，不能
跨 clone 共享；Oracle 保留当前星但抑制窗口内新出星。新星不改变物理生死，且 teleport 已处于
不完整边界。终局且 V2 存活的世界作为安全吸收态，不再伪造后续 step。

## 3. 可复用工具和不可变证据

统一命令：

```text
./tools/fast-regression-toolchain.sh classify-physical-safety
```

也可使用 `npm run fast-regression:physical-safety`。命令动态读取修复后的 focused report 和冻结的
Safety v1 corpus，重新 rehydrate 每个 Capsule，并输出进度、内容寻址报告和独立缺陷 corpus。

本次不可变证据：

- 分类报告：
  `artifacts/fast-regression/reports/physical-safety-oracle/a0c7f4dba0dc91a03504a4b7bf3bf44000c0bf06483ebb3f2031fd50573f0f54.json`；
- 已确认缺陷 corpus：
  `artifacts/fast-regression/defect-corpora/physical-safety-v1/3c1d1969b2f23d21c5cdddcf1ddd68ca4ce147cffc8ba52c072f557261fa9cfb.json`；
- 输入 focused report：
  `artifacts/fast-regression/reports/native-poison-death-safety-chance/3fe93157179675bb363f9106cc9f47981ed0a2084ee2ccc0d82d72532e76206a.json`；
- 输入 Safety corpus：
  `artifacts/fast-regression/defect-corpora/safety-v1/c03bc4ae6b0d176c8bf317e5aed444eb25619b35fcd66deb35f16ec4425d2eb3.json`。

分类器连续运行两次得到同一 fingerprint。生产 V2 source 没有在本阶段改变。

## 4. 分类结果

| 类别 | 数量 | 含义 |
|---|---:|---|
| `CONFIRMED_FALSE_PROVEN_SAFE` | 4 | 固定根动作后，窗口内不存在观察一致生存策略 |
| `OBSERVATION_CONSISTENT_WINDOW_WITNESS` | 8 | 历史后续动作死亡，但至少存在一个全 support 生存策略 |
| `UNRESOLVED_INCOMPLETE` | 0 | 没有预算或 support 未闭合案例 |

总计搜索 2,535 个 observation-belief 节点、27,160 次 simulator transition。

已确认的四个生产假阳性是：

| Capsule | 帧 | 根动作 | 窗口 |
|---|---:|---|---:|
| `03414b85edaf…` | 38 | `GO` | 4 |
| `11ef62c235b0…` | 22 | `TURN_RIGHT` | 2 |
| `1723388cef7c…` | 15 | `TURN_LEFT` | 2 |
| `c484c9b0f592…` | 51 | `GO` | 2 |

其余八帧不再属于 Safety 缺陷。它们可以用于以后验证“是否选择了 Oracle witness 所要求的后续
动作”，但不能用于把根动作判死或提高 Hard。

## 5. 共同结构原因

四个缺陷在根帧的 `enemyCanFire` 全部为 false；其中两个根帧 `enemyCanAct` 也为 false。
根状态同时存在已提交弹丸，生产 `InformationSafetyClosure.evaluate()` 却只接收根时刻的单个
`enemyCanFire` 布尔值：当它为 false 时，整个四帧窗口不再建立未来 FIRE frontier。

真实物理会继续变化：已有弹丸失效、fire lock 到期、poison/stun 的行动 cadence 恢复，敌方随后
重新获得 FIRE。四个 `NO_WITNESS` 证明中的终端致死叶全部来自这种未来 FIRE。生产 Closure
没有推进 capability timeline，却把当前静态投影当作完整四帧覆盖，最终写出 fatal mass=0、
unknown mass=0、coverage=10000、`PROVEN_SAFE`。

所以问题不是简单的 FIRE 分数过低，也不是 Hard 漏判；它是 Safety 的时间状态缺失。当前
`threatDepth()` 还把我方位置固定为根动作后的 cell，不能表达“后续移动进入新射线”，进一步说明
不能用调大静态威胁半径修补。

## 6. 后续结构修复状态

固定容量的 `ThreatCapabilityTimeline` 已接入生产 Safety，并完成 focused 回归、专用验收器和
SR2 性能门。它闭合了根帧暂时不能 FIRE、未来重新取得 FIRE 能力这一共同缺陷。

完整的选择性 `ObservationSafetyFrontier` 仍待实现：

- 每个 support 保存未来四帧 `canAct/canFire`、已有弹丸释放时刻、fire lock、技能/debuff cadence；
- 已提交弹丸和炸弹继续沿现有生命周期推进，不能受四帧 value depth 截断；
- 当未来某帧 FIRE 解锁时才生成 potential projectile，并复用 ReverseViability 检查之后是否存在
  观察一致逃生动作；
- 根动作固定，未来己方动作按 observation group 存在选择，敌方动作与 ChanceOutcome 仍为全称；
- 完整 frontier 才能产生 `PROVEN_SAFE`；容量、预算或 capability support 不完整必须是
  `UNKNOWN/POSSIBLE_DEATH`；
- potential FIRE 只写 Safety/Risk，四个缺陷也必须保持 Hard=`ALLOW`。

性能实现必须继续使用预分配 TypedArray slab。capability timeline 是 root/world 共享派生数据，
每个 action 只保存 frontier handle、fatal depth/mass、escape slack 与 observation-group obligation，
不能为每个节点创建 JS 对象，也不能把离线 simulator Oracle 搬入生产热路径。

第一段最低验收已经满足：四个冻结缺陷全部不再发布 `PROVEN_SAFE`，Hard 仍为 `ALLOW`；八个
witness 案例没有变成 Hard reject 或 `PROVEN_DEAD`；热路径分配为 0，SR2 P95 通过。尚未完成的
frontier 必须继续验证 cache on/off、source/minified、root restore，以及小地图 exhaustive Oracle
的 1–4 帧零假阳性。当前报告和后续修复报告均不授权 Candidate、simulate 或 publish。
