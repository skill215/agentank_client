# BasePolicyKernel BP27：长Option响应质量

## 结论

BP27没有再把六帧前沿压成一个Minimax分数，而是在同一个Physical前沿中成对比较：根第一步分别使用
当前incumbent与AttackPose候选，之后双方都执行相同的receding AttackPose策略。敌方动作、chance、
Fast/Hard、事件边界和Physical TT完全共享。这样测到的是“第一步改变”的边际效果，不是两套后续
控制器之间的混杂差异。

每个根同时保留最坏事件mask和0–10000整数响应质量。11个维度分别记录FIRE、DEATH、ABORT、
RESCUE、OPEN、INCOMPLETE、WIN、POLICY_LOSS，以及派生的SUCCESS、FAILURE、UNRESOLVED。
比较先禁止新增最坏失败/不完整事件，再要求成功不降、失败/不完整/未决不升，至少一维严格改善。

它仍是纯Shadow：不写Hard、Proof、Risk、StageMatrix或最终动作。固定16场景保持`16/14/2`、
53.13%，production root SHA保持`43eb56…ffcf7`。

## 配对事实

606个根中506个完整、100个不完整；284个候选与incumbent首动作相同，322个不同。完整同动作比较
零差异，证明根恢复和共享TT在完整预算下保持确定性。另有2个同动作比较在不完整预算边界发生部分
前沿漂移：先执行的一侧填充共享TT后，后执行的一侧到达了不同的截断点。这两个样本只记为
`sameActionPartialBudgetDrift`，不参与所有权。

关系分解为：295相等、36候选严格支配、32 incumbent严格支配、181权衡；其余60是非相等且不完整。
所以不存在“整个AttackPose结构普遍更好”的结论，但出现了36个完整、不同首动作、候选严格支配根，
它们是下一轮唯一允许进入因果ACTIVE POC的集合。

总质量显示候选SUCCESS增加262,972，UNRESOLVED减少263,054；同时FAILURE增加13,285。这个组合解释了
为什么按总成功或总未决改善全局接管仍然危险：优势主要集中在部分根，另一些根明确恶化。全局阈值、
FIRE bonus或“平均更好”不能代替逐根Pareto证据。

## 性能与实现缺陷

两侧共评估234,538个节点和287,644次转移，共享TT命中39,497次；TT容量失败、root restore失败和
热路径分配均为0。候选侧节点少于baseline侧，不代表候选天然更快，主要因为共享TT由baseline先填充。
因此这些计数用于确认复用有效，不能作为两个首动作的独立成本比较。

实现过程中发现并修正了两个诊断合同问题：相同的不完整向量应先判相等，而不是统一标为INCOMPLETE；
同动作在预算截断下的顺序漂移不能伪装成完整语义错误。两者都有定向UT。

## 架构决定

1. 保留BP26/BP27的事件前沿、Physical TT和整数质量，作为长期Option的事实服务。
2. 拒绝让aggregate mass、权衡根、不完整根或possible-hit直接拥有动作。
3. 下一步只允许36个`complete && different-action && candidate-dominates`根进入固定16场景ACTIVE因果
   POC；原Hard、Risk和committed escape边界继续先行。
4. ACTIVE若没有正向整局转换，或出现任一硬不变量失败，就退回Shadow；不得放宽dominance定义补救。

复现入口为`tools/base-policy-kernel-bp27.sh`，机器证据为
`config/engine-v3/base-policy-kernel-bp27-response-mass-evidence.json`。
