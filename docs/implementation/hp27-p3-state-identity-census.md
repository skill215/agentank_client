# HP27：P3状态身份与剪枝上限

## 结论

HP27没有修改production搜索。它用外部Map观察器对固定16根的冷P3进行state-depth-width身份、
bucket替换、动作顺序和Chance后继等价性census，并用无观察器的独立搜索逐项验证动作、值、节点
和restore完全一致。

结果排除了四条看似合理但不够大的优化方向：扩大TT、静态重排动作、预剪Fast失败和合并
ChanceOutcome。真正的结构瓶颈是：递归child始终被要求返回精确值，父节点已有的maximin界没有
传入child。下一阶段应验证返回`EXACT/LOWER/UPPER`的windowed maximin，而不是继续加局部启发式。

## 状态身份

1,027次直接TT probe中：

- 879次是首次出现的精确`PhysicalState + remaining depth + width + risk`，占85.58%；
- 148次是同身份重复，124次已经命中；
- 只有24次重复状态因替换等原因再次miss，占全部probe的2.33%；
- 104次是相同PhysicalState第一次以另一depth出现，不能复用最终值；
- 32项表虽然有496次满bucket写，但绝大多数被替换条目没有在本次搜索再次访问。

因此“满bucket很多”不能推出“扩大表有用”。HP26的真实后继实验和本阶段的身份数据相互闭合。

## 静态排序上限

891个完整深层frame中，755个最佳己方row本来就在第一个，占84.73%。现有alpha-beta共剪掉
1,028个row；用事后oracle把实际触发截止的敌方column永远排到第一，理论上也只能额外少算7个
cell。这个上限远小于冷P3达到640等效所需的6–15%节点下降。

这不代表alpha-beta没有价值，而是说明当前“节点内部”的动作排序已经很好。缺失的是把父窗口传入
递归child，让child在只需证明`value <= alpha`时返回上界，而不是继续求完整精确值。

## Chance等价性

4,043个parent-state/action group包含5,207个已执行Chance code，其中848组确实有多个outcome。
只有14组出现相同物理successor，总共可合并22个outcome，占0.42%。即使全部零成本合并，也无法
形成目标级性能跃迁。

## Fast/Hard计数修正

初看6,499节点与5,822次Hard classify相差677，容易误判为Fast失败。重新对账发现其中665次是
RootTransitionSlab直接回放的缓存Hard事实；Fast build 5,833加root replay 666正好等于6,499节点。
实际差额只有约12，不构成优化面。该修正避免了基于错误计数进行规则预剪枝。

## 下一阶段合同

HP28先做理论oracle和诊断POC，不直接替换production：

- 每个递归frame携带整数`alpha/beta`；
- 返回值显式标记`EXACT/LOWER/UPPER`，TT也必须区分界类型；
- max row和min column按标准窗口传播，不能把bound当exact写入StageMatrix；
- Chance robust backup必须在部分outcome上维护可证明上下界；不能按普通平均值提前剪枝；
- 与现有完整搜索在小图、随机树和固定根上比较：完整预算最终动作/值相同，预算内节点显著减少；
- 如果节点收益不能达到至少6%，或任何exact/bound假阳性出现，POC拒绝。

机器证据见`config/engine-v2/hp27-p3-state-identity-evidence.json`。
