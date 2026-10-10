# BP325：拆分intent优先级与根风险排序的混杂

## 纠正BP324的解释

BP324同时改变了两个因素：根由混合评分变为最坏值优先，且原intent加分退到worst/expected之后。不能将它的全部胜率下降归因于“最坏值优先过于保守”。此前文档已记载intent降级，但结果解释必须进一步分离该影响。

6局原胜局退化的首次共同轨迹分歧均在第3–4帧：5局左转→GO，1局右转→左转。它们不是直接取消FIRE。原选择都有150分intent加成，候选差异只有67–118分的worst差距；降级intent后改变初期朝向/路线，后续攻击量变化不能简单视为直接拒绝开火。

## 离线2×2根选择对照

复用BP323全部2,139根与BP317/BP324压缩动作流，不新跑对战。四种定义：

- BLEND_INTENT：当前backed/nominal（含原intent）。
- BLEND_NO_INTENT：从两者移除原intent加分。
- WORST_INTENT：比较(worst+原bonus, expected+原bonus)，再原backed/nominal。
- WORST_LATE_INTENT：BP323/324合同，先(worst,expected)，再原backed/nominal。

不拟合新常数。数值相同的候选保留为集合，不猜测缺失的risk/动作优先级tie-break。

| 模式 | 唯一确定且不同于当前的根 | 数值平手根 |
| --- | ---: | ---: |
| BLEND_INTENT | 0 | 11 |
| BLEND_NO_INTENT | 260 | 30 |
| WORST_INTENT | 283 | 12 |
| WORST_LATE_INTENT | 520 | 14 |

520与BP323的525差异来自本轮不猜平手决胜，不是数据少算或实验漂移。

## 正反案例

- 6局胜→负/平的首次分歧：BLEND_NO_INTENT与WORST_LATE_INTENT均改选；BLEND_INTENT与WORST_INTENT均保留旧动作。**这些首次分歧由intent优先级变化即可解释。**
- 7LUP的负→平也属于同类intent驱动分歧，故保留intent并非只保留有利样本。
- 7j82的负→胜首次分歧为FIRE→GO，保留或去掉intent不改变结论，由最坏/期望取舍驱动。
- BP318两根I52与2oo：两个BLEND模式仍选右转/FIRE；两个WORST模式均选GO。保留原intent不妨碍这两根的预期修正。

这只是首次分歧的选择机制分离。没有证明仅恢复第一步就恢复整局胜利，也没有证明WORST_INTENT的后续策略不再退化。已知后续轨迹分叉不可忽略。

## 下一步预注册

固定16场景32局，唯一新候选WORST_INTENT：同一allowed域、原权重、原预算、原深度、原150分intent；仅替换根比较为(worst+bonus,expected+bonus)，其后复用原tie-break。递归cell仍保持现有混合搜索，不宣传为纯递归minimax。

与当前默认及BP324同时列出W/L/D、胜负转移、单方击毁、FIRE与星差。不能只测试两个失败根，也不调bonus。当前生产默认保持不变。

## 证据

工具：`tools/agentank/diagnostics/intent-factor-audit.js <新目录>`。
产物：`artifacts/native-causal-audit/bp325-intent-factor/`，overview含8个胜负翻转首根和2个旧退化根，压缩全根选择集合。
校验当前动作属于BLEND_INTENT最大集合、BP323替代属于WORST_LATE_INTENT最大集合；8个首分歧与双方压缩动作索引对应一致。
2项新UT通过，验证因子分离与未决平手保留。无新对战、无生产修改、无平台调用。
