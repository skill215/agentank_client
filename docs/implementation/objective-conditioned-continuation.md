# 目标条件延续与 Risk 所有权 POC

本轮没有修改 production 默认语义，也没有读取独立 Holdout。它只回答一个结构问题：
在 Observation 支持不完整、没有完整 value owner 时，Risk/Pareto 是否会在多帧目标延续计算前
删除最终更好的动作。

## 找到的三个结构缺口

`OptionAwareDepthSearch` 并非完整的“目标条件搜索”。它会按 Option 改变深层代表动作和 cache
身份，但 `POSITION` 与 `STAR_CONTROL` 的叶值仍回到同一个全局 heuristic。目标格和 deadline
大多只是标签，而不是递归效用的一部分。

更严重的是 `OptionPortfolioSlab.buildTyped()` 的兜底语义：一个没有显式 `starPurpose` 的移动行，
也可能以可见星星为目标生成 `POSITION`。因此所谓“位置目标”可能只是被动继承了星目标，进一步
强化 V2 已知的抢星倾向。

第三个缺口在所有权顺序。固定16场景的 Shadow 中出现39个“同为 `POSITION`、同一目标、延续值
选择不同动作”的根。新动作在 committed、immediate、unknown 和 possible-projectile 四个维度
均没有更差；39个冲突全部来自 horizon mass，其中34个可以完全归因于 future FIRE，6个同时
恶化软 escape slack。这说明 future-FIRE 风险有时会在目标延续得到比较机会前，通过单帧
Pareto 删除动作。

## 诊断实现

新增的 `ActionContinuationEnvelope` 只在以下边界触发：

- runtime 为 NORMAL；
- Observation 支持不完整且存在 possible projectile；
- 敌人当前可见，观测物理世界是单例；
- 没有完整的 Physical/Information value owner；
- Risk 可接受的移动行之间存在 Pareto 冲突。

它用固定数组选取最多三个候选，运行2–4层目标条件 Physical continuation。`strictTargetOwnership`
禁止无主移动继承星星；`dynamicContactTarget` 让接触位置目标跟随敌方实体。所有计算均为诊断服务：
不写 Hard、Proof、Safety，也不改变原始风险向量。Shadow 的 root restore 和声明热分配均为0。

Active POC 只允许一种非常窄的反事实：两个动作必须属于同一 `POSITION` 和同一目标；新动作必须
已经通过 Risk 阈值，且 committed、immediate、unknown、possible-projectile 和 escape slack
均不变差；额外 horizon 风险必须完全由 future FIRE 增量解释。即使如此，它仍只是用单个观测
PhysicalState 代替不完整 InformationState，因此不能获得生产动作所有权。

## 固定16场景结果

CURRENT 为4胜27负1平，分析得分14.06%。目标条件 Shadow运行3,242次，触发80次，74次完整；
51次得到不同的名义动作，全部与当前Risk Pareto冲突，最大节点756，动作保持不变。

修复无主星目标后的 strict Active 为5胜25负2平，18.75%，提升4.69个百分点。动态接触目标同样
为5胜25负2平，没有超过 strict 版本。两者的换位转换完全相同：

- 3个 `V1_WIN→V2_WIN`；
- 2个 `V2_WIN→V1_WIN`；
- 1个 `V1_WIN→DRAW`；
- 其余26个结果不变。

strict/dynamic 分别产生32/33次有意识的软风险Pareto覆盖，所以审计中的
`riskDominatedSelection` 也如实为32/33，而不是被包装器隐藏。两组 avoidable Hard、timeout/error
和 root restore failure 都为0。strict 的FIRE减少4次；dynamic恢复了FIRE总数，但自身crash比
CURRENT增加2局。

这组数据证明“目标延续应在 future-FIRE 软风险最终删行前参与比较”具有因果价值，但没有证明
当前名义Physical解法正确。+4.69pp中同时存在两个胜转负，而且动态目标没有进一步改善结果。
因此不读取Holdout、不接入production，也不继续围绕固定16场景调常量。

## 架构结论

下一版应一次性修正所有权，而不是上线这个POC：

1. Option生成器成为目标身份唯一来源；无主移动不能继承STAR。
2. `POSITION/contact` 绑定动态敌方实体；`STAR_CONTROL` 绑定带generation的星目标。
3. committed与possible-projectile安全继续不可放宽。
4. future-FIRE horizon保留为独立的搜索后权衡维度，不能在目标延续前提前删行。
5. 对隐藏世界计算每个Option的sound Information区间；只有区间严格支配才能覆盖当前动作。
6. 新结构直接进入一次新的盲Discovery/Holdout，不能继续使用固定16场景调参。

机器证据位于
`config/engine-v2/objective-conditioned-continuation-evidence.json`。production root 和
RiskController 指纹保持不变。
