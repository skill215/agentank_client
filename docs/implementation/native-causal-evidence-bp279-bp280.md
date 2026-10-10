# BP279–BP280：搜索入口与选择损失分离

本轮不改生产策略、预算、规则；不读取Holdout，不调用平台。

## 诊断加固

- 搜索入口区分敌不可见、非接触、资源所有权、严格证明/救援、prepare失败与prepare成功。不是把depth=0都称作性能fallback。
- 新反事实输入必须绑定整个 `engine-v2/src` 文件树；保留旧六文件hash兼容历史，但不再仅凭它运行新反事实。
- 反事实校验双方动作前缀和稀疏动作参数；依然不是完整物理状态哈希证明。
- 11项UT通过。新增可重复分桶脚本 `tools/agentank/diagnostics/native-search-entry-analysis.js`。

## BP279 Discovery64

128局：71胜45负12平，分析得分60.15625%，星差-11，单方击毁胜51、负31。与已知基线聚合结果一致，不主张已对全部128局历史动作逐项核对。

捕获351个首个分阶段分歧根（非全帧统计）：

| 搜索入口 | 根数 | V1动作被风险排除 | V1动作合格但未选 |
| --- | ---: | ---: | ---: |
| 搜索prepare成功 | 186 | 76 | 110 |
| 非接触模式 | 112 | 16 | 96 |
| 敌方不可见 | 44 | 11 | 33 |
| 资源动作拥有 | 9 | 1 | 8 |

这些样本中V1动作候选缺失、物理Hard阻断均为0；V1动作不是正确性证书。非接触分歧根83/112选择左转，是检查线索而非错误证明。没有prepare失败样本；不能由选择性样本推断所有帧都没有性能问题。

## BP280 单步反事实

36个确定性抽样根，181个动作标签；19个根运行搜索。17个根存在更好的终局质量，其中9个胜负改善：5负→胜、4平→胜。其余8个不能计为胜率提升。

9个胜负改善动作全部acceptable=1，拆分如下：

| 原因线索 | 数量 | 后续检查 |
| --- | ---: | --- |
| 搜索已允许，但搜索值更低 | 3 | 预算、对手分支及叶/时域语义 |
| 搜索source domain排除 | 2 | 根动作域资格及删枝依据 |
| 非接触或不可见、未搜索 | 4 | 战略band、风险Pareto及仲裁 |

3个改善动作有dominated标记（与上表交叉，不可加总）。不能据此认定Pareto实现错误：可能是比较维度/估值不符合实际续局，也可能是单个对手续局与鲁棒目标不同。

搜索估值分歧的3个样本：

- `mat_Ar56ffTFA4X3ss6lj` seat0 frame19：FIRE→TURN_RIGHT，-186 vs -227。
- `mat_DW7MTpFVooBKYxYbU` seat0 frame28：TURN_RIGHT→GO，993 vs -6444。
- `mat_CWKbddZd2Mb1EKL5v` seat1 frame46：TURN_LEFT→GO，2196 vs -16923。

source domain两个样本：`mat_LpYDwCCol1LH2ujZw` seat1 frame30、`mat_H0ocE5Rk3JWEeS2p8` seat1 frame32，均为转向→FIRE。

双方动作前缀不匹配0，强制动作失败0。原动作标签复用基线，不是每个标签都独立重跑。有限样本的最佳续局是事后oracle，不是可上线策略或严格胜利证明。

## 结论和下一步

BP277中负→胜集中于未搜索帧的结果不能外推为整体根因。扩大样本显示：搜索资格、搜索估值和非搜索仲裁都有可追踪损失。

优先顺序：

1. 对两个source-domain FIRE样本读取根资格证据，确认删除是合法性、预算代表性还是启发式筛选；先写可复现UT，不直接恢复所有FIRE。
2. 对3个搜索估值样本拆分有限预算与叶/对手建模差异，不以事后胜负冒充Minimax oracle。
3. 非搜索4个样本分别定位band或Pareto拥有权，不全局更换V1导航、不放宽Risk阈值。

## 保存位置与身份

- `artifacts/native-causal-audit/bp279-search-entry-discovery64/`
- `artifacts/native-causal-audit/bp279-search-entry-analysis.json`
- `artifacts/native-causal-audit/bp280-root-oracle36.json`

生产源码树SHA-256：`4a5056ae736d5d4cc1bd3f397837c4cc2660ba516dc6e580e17760c2fbbdadba`。
production engine SHA-256仍为 `1800ceaf4841d9681216f0782abc8c9a49527afb0ad40e8437de346e5797b1e3`。
