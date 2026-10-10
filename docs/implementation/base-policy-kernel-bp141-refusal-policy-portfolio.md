# BP141：持久策略组合完整，但两个新增策略均未扩展价值前沿

## 目的

BP140-Q1在35个精确方向根上闭合了有限时域拒绝价值搜索，但深层我方只有一个确定性重规划策略。
BP141分别完整求值少量命名策略，策略身份在整个horizon内固定，最后只在根上比较各策略跨规则世界的
最坏值。它不会在每一层重新展开全部我方primitive。本步只运行Shadow；历史单次结果仅是审计列。

组合包含`DIRECT_PURSUIT`、优先次轴建立射线的`FLANKING_LINE`，以及敌方已经瞄准时拒绝互射的
`COUNTER_SAFE_PRESSURE`。每个策略分别覆盖全部敌方动作、ChanceOutcome和三种移动规则世界；根选择
最大化跨世界最坏值。candidate证书仍要求所有规则世界严格改善且同敌方列逐点支配。

## POC缺陷与修复

首次运行中counter-safe与direct完全相同。原实现先处理“存在射线则开火”，再判断“敌方已瞄准则规避”。
敌方能瞄准我方时双方必然共线，因此规避分支不可达。新增互相瞄准UT，固定direct选择`FIRE`、
counter-safe选择`TURN_LEFT`，并将counter判断移到射线开火之前。随后增加零分配活动计数，避免把
“没有效果”误判成“代码没有执行”。

## 结果

35/35根、105/105规则实例完整，root restore失败和热分配均为0。

| 指标 | 结果 |
|---|---:|
| `LOCAL_EQUAL` | 25 |
| `LOCAL_TRADEOFF` | 8 |
| `LOCAL_ROBUST_INCUMBENT` | 2 |
| `LOCAL_ROBUST_CANDIDATE` | 0 |
| incumbent选择direct | 35/35 |
| candidate选择direct | 35/35 |
| 总节点 | 844,150 |
| 相对Q1节点 | 252.95% |
| 单个side/world/policy最大节点 | 3,380 |

新增策略不是dormant：侧翼实际执行15,644次，拒绝对枪实际执行350次。相对direct，侧翼在incumbent
上为0高/31平/4低，在candidate上为0高/27平/8低；counter-safe两侧都是0高/35平/0低。两个策略
都没有一次提高跨世界最坏值。

## 结论

保留“逐策略完整求值、根上选择区间”的组合机制，但拒绝这两个策略作为owner。当前组合付出Q1的
2.5295倍节点，根选择却完全不变；继续添加手写方向或调分没有证据基础。

下一步改为有界单次偏离的策略改进：从direct出发，只允许在整个horizon中的一个可达状态尝试一个
受支持动作，随后恢复baseline policy。它能定位哪个观察/响应条件和动作真正改善完整拒绝价值，规模
近似`horizon × actionCount`，不会恢复每层primitive的指数展开。

production行为未改变，SHA-256仍为
`0a8f09c3bf54e7ecd708346b08ff1133a716aa62634484b10e549968a0cbc23e`。机器证据见
`config/engine-v3/base-policy-kernel-bp141-refusal-policy-portfolio-evidence.json`。
