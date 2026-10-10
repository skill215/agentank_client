# BP119：ATTACK目标存在，但92.76%的目标帧没有执行Option

## 结论

V2现在可以稳定识别ATTACK目标，但上游没有持续生成“接敌、占射位、调整朝向”的攻击执行Option。
固定16场景中ATTACK epoch活跃1,851帧，只有134帧存在同目标strict执行，1,717帧为执行断层，支持率
仅7.24%。这比Minimax深度、Risk阈值或OptionPortfolio本身更靠上游。

本阶段为行为中性Shadow，胜负、星、击毁、FIRE和production hash全部不变。

## 攻击漏斗

3,030个决策根按第一个失败层互斥分类：

| 层 | 根数 |
|---|---:|
| 无Combat攻击证据 | 2,585 |
| 只有ZONE_DENIAL/BELIEF_SWEEP软证据 | 36 |
| 完整度或射后逃生不足 | 0 |
| Portfolio完整支持缺口 | 1 |
| Hard拒绝 | 8 |
| Risk不可接受 | 114 |
| Pareto dominated | 32 |
| strict ATTACK可用 | 254 |

409个根已达到当前攻击生成条件，408个进入完整Portfolio，400个通过Hard。由此排除“Portfolio漏掉
大量攻击”和“Hard过严”两个假设。Risk与Pareto合计过滤146根，也远小于2,621个证据生成前缺口。

## strict执行结构

254个strict攻击根共264个执行行：FIRE 225、GO 13、左转13、右转13。215个根只有FIRE，只有39个根
有移动执行。当前动作位于strict集合155次，离开集合99次；后者才是已有Option仲裁可以处理的区域。

因此目前的ATTACK语义近似为“现在已经能开火”，不是“持续到达可开火位置”。这解释了为什么语义
epoch虽然长期存在，BP117只找到4个需要局部Minimax的冲突根。

## 诊断边界修正

首次普查误把Production用于Hard/Safety的末尾`ACTION.NONE`哨兵计入策略域，制造63个伪Portfolio
缺口。修正为与Production相同的`selectionCount`后，缺口降为1。该问题只在诊断工具中，不是引擎
时序缺陷，并增加UT锁定哨兵边界。

## 下一步

不放宽Risk，不恢复已被整局反例否定的AttackObjectiveField直接owner。只在活跃ATTACK epoch没有
strict执行时，用route-proven攻击姿态场生成一个GO/TURN候选；候选仍必须通过Hard/Risk，并在完整
敌方根列的两Option Minimax中严格高于incumbent。先Shadow量化生成覆盖、搜索反驳和节点成本，再决定
是否存在ACTIVE资格。

机器摘要：`config/engine-v3/base-policy-kernel-bp119-attack-option-coverage-evidence.json`。
