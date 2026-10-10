# Common-policy Option interval：有限时域证据不能冒充终局值

本轮使用一个全新的盲 Discovery 验证目标条件 Minimax、future-FIRE 风险和
InformationState 共同策略能否组成安全的动作所有者。Production 默认语义未修改，64个
Holdout 场景保持封存。

## 新盲测集合

从当前1,243个滚动历史场景中排除V3 repair与VC0已经使用的896个场景，剩347个候选；按固定
SHA-256盐冻结32个Discovery和64个Holdout。manifest fingerprint为
`c992c611...b717db`。

## 搜索后Risk不能单独闭合所有权

目标条件Physical Shadow在6,974个决策中触发138次，121次完成；42次目标续搜改变了名义
赢家，其中32次与Risk Pareto冲突。把future-FIRE用现有整数epsilon-contamination放回搜索后，
仍不能把这些结果升级为Information所有权：目标类型、目标身份、escape slack、possible
projectile与horizon来源仍是不同量词，不能压成一个补丁分数。

## 共同策略interval

新增诊断核显式枚举possible projectile“不存在/存在”两个世界、完整敌方动作和ChanceOutcome。
第一帧后按平台可见观察分组；同一观察组强制共用一个续行动作，不同观察组才允许策略分裂。
共同策略的最坏叶作为有限时域下界，逐世界独立选择的融合值只作上界。所有状态使用固定数组，
root restore与热路径分配均为0。

修正后的Discovery得到248个完整interval、40个不完整、334,842个节点和114个有限时域分离。
但没有任何候选与当前动作在所有叶上都到达终局/严格死亡证书，因此终局所有权为0。

## 关键反证

曾把这114类信号中的103个当作“严格value dominance”接管动作，结果：

| 指标 | CURRENT | 错误Active | 变化 |
|---|---:|---:|---:|
| W/L/D | 9/52/3 | 8/56/0 | 退化 |
| 分析得分 | 16.41% | 12.50% | -3.91pp |
| 我方crash | 19 | 28 | +9 |
| FIRE | 327 | 290 | -37 |
| Risk-dominated selections | 0 | 53 | +53 |

转换为3个`LOSS→WIN`、1个`DRAW→WIN`，但同时出现5个`WIN→LOSS`和2个`DRAW→LOSS`。
这不是Risk阈值问题，而是类型错误：两层启发式叶只能形成`HORIZON_UTILITY`排序，不能形成
终局游戏值的lower/upper。

最终实现已经fail-closed：114个horizon separation仍被记录，但`terminal ownership=0`、
proposal=0，64局动作、W/L/D、星、击毁和FIRE与CURRENT完全一致。

## 性能与决定

共同策略核在Discovery额外计算334,842节点，本地总耗时约为baseline的2.28倍，P95约1.77倍。
因此它只保留为离线或极稀疏证书服务，不进入每帧production。

下一步不再放宽Risk或提高这个核的常驻预算。有限时域interval只允许用于排序、剪枝和稀疏调度；
最终动作所有权只来自terminal-complete/strict committed证书。整体提升方向转向战略目标生成和
verified attack proposal，让Minimax证明一个有用的攻击/保命命题，而不是继续让启发式搜索直接
覆盖最终动作。

机器证据位于`config/engine-v2/common-policy-option-interval-evidence.json`。
