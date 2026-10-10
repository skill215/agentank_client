# BP120：一步接近射位不是攻击Option，完整Minimax反驳208/208

## 结论

BP119证明ATTACK目标存在但执行断层。本阶段只在语义ATTACK活跃且没有strict执行时，让旧
`AttackObjectiveField`生成一个更接近有利射位的安全GO/TURN，再用完整敌方根列、depth 2的两Option
Minimax比较候选与当前动作。组件全程为Shadow，不改变动作。

固定16场景中生成306个不同候选；208个完成搜索的候选全部比当前动作差，9个预算不完整，89个处于
runtime fallback而未搜索，严格支配为0。因此这批候选没有ACTIVE资格，不能靠放宽Risk或调高攻击分
把它们变成所有者。

## 正确分母

首次运行错误使用了semantic epoch的`lastExecutionRowMask`。该掩码包括POSITION等执行别名，不等价于
BP119的完整ATTACK支持。修正后BP120直接共享BP119逐帧`lastStrictMask`，精确复现：

- ATTACK epoch 1,851帧；
- strict执行支持134帧；
- strict执行缺口1,717帧；
- 其中307帧为资源/终局中断，本阶段不竞争；
- 对其余1,408帧运行几何候选普查。

这是诊断接线缺陷，不是Production动作缺陷。

## 候选与搜索结果

| 项目 | 数量 |
|---|---:|
| 存在至少一步几何进展 | 704 |
| 进展动作与当前动作相同 | 395 |
| 不同且Risk不退化的候选 | 306 |
| 没有候选 | 707 |
| GO / 左转 / 右转 | 9 / 165 / 132 |
| 实际进入两Option搜索 | 217 |
| 完整 / 不完整 | 208 / 9 |
| 完整候选更差 / 相等 / 严格更好 | 208 / 0 / 0 |
| runtime跳过 | 89 |
| 搜索节点总数 / 单根最大 | 20,770 / 256 |

全部动作、胜负、星、击毁、FIRE与基线一致；Hard、Risk domination、root restore、timeout及热分配均为0。

## 为什么“目标正确”仍然全被否决

几何场只约束第一步：它从有利射击pose反向计算距离，挑选一个缩短距离的primitive。但进入
`OptionAwareDepthSearch`后，`ATTACK_SETUP`后续由`generateAttackContinuation`重新生成，后者只根据
当前敌人位置直接转向、前进或开火，并不继续沿几何场选出的射位路径。第一步和后续策略不是同一个
Option policy。

所以本阶段真正否定的是“一个几何进步primitive”，不是“完整接敌策略”。Minimax的208次反驳应被
保留，而不是用攻击加分覆盖。

## 下一步

BP121应把所有权单位提升为稳定的`ATTACK_APPROACH`策略：语义敌方target与policy generation保持不变，
具体射击pose允许随模拟状态重新规划；attack分支每一步都消费该route policy，incumbent分支则保持自己的
continuation，禁止两边共享同一续写。仓库历史已经否定“长期固定具体pose”和“给所有根混入route动作”，
因此不重复这两个实验。比较仍使用完整敌方列和fail-closed区间；没有严格支配就不做ACTIVE。

机器摘要：`config/engine-v3/base-policy-kernel-bp120-attack-execution-interval-evidence.json`。
