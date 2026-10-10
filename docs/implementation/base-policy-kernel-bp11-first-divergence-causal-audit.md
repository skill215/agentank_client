# BasePolicyKernel BP11：首次分歧因果审计

> **BP13数值勘误：** 本页7个首次分歧属于旧诊断宿主；其W/L/D及动作落地受
> `CAST_STUN→TURN_RIGHT`发射桥缺陷影响，不能外推为V3组件替换效果。软路径值不构成动作证书的
> 架构结论保留，正确宿主与exact-value复核见
> [BP13](base-policy-kernel-bp13-host-and-exact-ownership.md)。

## 结论

BP11没有继续调整FIRE分数，而是把BP10的7个结果变化局还原到**同一个FastState上的第一次动作分歧**。
结论很明确：响应条件FIRE增量在7/7个根上足以单独翻转选择，但只产生1个正转换和6个负转换。
因此，“局部估值更像V1”不是可以取得动作所有权的证书。

production默认语义没有变化，production root SHA-256仍为
`c4443ddbd2a7a651d77f1582e5b68ce3715dfc87af7cf40ac7432396def39c48`。

## 可复现工具

新增：

- `tools/base-policy-kernel-bp11.sh`：先跑固定16场景OFF/ON，再只重跑结果变化场景并抓取根；
- `tools/agentank/diagnostics/base-policy-first-divergence-audit.js`：按真实callback动作序号对齐首次分歧根；
- `--bounded-policy-capture-roots`：有界抓取每个决策根；
- 每个根记录`engineDecisionIndex`、FastState hash、候选矩阵、backed value、最终动作和同帧V1 oracle。

早期版本用owner的emit调用次数对齐根；当引擎提前退出、不进入owner时，该序号会漂移。BP11改用真实
callback/action-stream序号，7个根的OFF/ON状态hash全部相同。

## 固定16场景ACTIVE基线

| 模式 | W/L/D | 分析得分 | crash | FIRE |
|---|---:|---:|---:|---:|
| BP9，响应增量OFF | 16/14/2 | 53.13% | 11 | 186 |
| BP10，响应增量ON | 12/19/1 | 39.06% | 15 | 170 |

结果变化为5个`V2_WIN→V1_WIN`、1个`DRAW→V1_WIN`和1个`V1_WIN→V2_WIN`。

## 首次分歧证据

| 指标 | 结果 |
|---|---:|
| 共同对局 | 10 |
| 动作流发生分歧 | 7 |
| 结果发生变化 | 7 |
| 精确同状态根 | 7/7 |
| ON动作与V1 oracle一致 | 5/7 |
| 其中负转换 | 4/5 |
| 响应增量足以拥有选择翻转 | 7/7 |
| ON首次动作FIRE | 5 |
| ON首次动作TURN_RIGHT | 2 |
| 所有权margin | 2 / 38 / 63（min/median/max） |
| 选中根的增量 | 68 / 80 / 87（min/median/max） |

两个非FIRE根也被翻转，是因为未来FIRE收益通过递归`pathScore`回传到当前TURN动作。这证明问题不是
“FIRE根分数略高”，而是软证据进入了整个递归稳健标量。

另有一个独立边界问题：OFF在一个根中owner提议`CAST_STUN`，最终却发出`TURN_RIGHT`。这是技能
bridge/emitter的动作落地差异，不属于响应增量的因果链，后续必须单独审计。

## 架构判断

当前搜索把以下两类信息放进同一个`pathScore`并通过最坏响应回传：

1. 已提交物理事实、terminal和确定动作成本；
2. 对方可能移动到弹道上的预测收益。

第二类是nominal/soft evidence，却获得了第一类同等的递归所有权。BP11的反例说明它即使提高V1局部
估值一致率，也可能破坏整局策略。

BP12已经完成价值所有权消融：确定价值继续进入robust，预测命中进入独立nominal通道。它把39.06%
恢复到50.00%，但唯一一次robust精确平局的nominal接管仍造成`V2_WIN→V1_WIN`。因此最终合同比本页
最初建议更严格：软路径收益只能Shadow；没有完整非劣/攻击证书时，连robust平局也不能直接接管动作。

结构化证据见`config/engine-v3/base-policy-kernel-bp11-evidence.json`。
