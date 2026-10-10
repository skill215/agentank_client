# BasePolicyKernel BP26：长Option事件前沿

## 结论

BP26完成了BP25延期的606个`GO/TURN`攻击路线，但没有把它们重新塞回更深的primitive Minimax。
新评估器每个我方节点只执行AttackPose策略给出的一个动作，展开敌方动作与技能随机响应，并用
`hashLo/hashHi + remainingFrames`合并相同PhysicalState。叶子分别备份为`FIRE`、`DEATH`、
`ABORT`、`RESCUE`、`OPEN`、`INCOMPLETE`、`WIN`和`POLICY_LOSS`，不提前压成一个分数。

它是纯Shadow：不写Hard、Proof、StageMatrix或最终动作。固定16场景仍为`16/14/2`、53.13%，
production root SHA保持`43eb56…ffcf7`。

## 事实结果

606个路线根由166个GO、211个TURN_LEFT和229个TURN_RIGHT组成。六帧事件前沿共执行145,832个
状态节点和181,632次物理转移，命中22,334次状态合并，保存46,472个状态。最大单根1,819节点、
2,048转移；root restore、热路径分配和TT容量失败均为0。

首轮发现TT空槽index 0与“表满”都编码为`-1`，制造了13次假容量失败。修复为
`-(index + 2)`并增加定向UT后，容量失败归零。这是算法基础缺陷，不是参数问题。

事件语义也做了严格分离：实际执行FIRE才算攻击事件；没有攻击来源证明的终局WIN单独记录。
最终只有1/606在全部敌方响应下到达FIRE边界，而且它的根动作与incumbent相同；另外5/606达到
终局WIN闭合。不存在可改变动作的严格长Option证书。

大多数根同时存在不同响应类型：453个含死亡响应，477个含策略中止，475个进入committed救援，
470个超过六帧，87个含Fast/Hard/budget不完整。只有125个没有OPEN或INCOMPLETE。这说明严格
AND闭合适合ForcedWin/反证，不适合普通攻击策略的唯一所有权。

## 架构决定

1. BP26的Physical合并与事件分类保留，继续作为高性能事实层。
2. 普通攻击选择不能要求所有敌方动作都保证开火，也不能退回有限horizon标量dominance。
3. 下一层应同时保留最坏响应mask和整数nominal响应质量：FIRE、死亡、救援、中止、超时分别输出，
   再与incumbent的同量词结果比较。
4. 在有共同baseline、事件质量和Risk门以前，BP26保持Shadow，不做ACTIVE POC。

复现入口为`tools/base-policy-kernel-bp26.sh`，机器证据为
`config/engine-v3/base-policy-kernel-bp26-long-event-evidence.json`。
