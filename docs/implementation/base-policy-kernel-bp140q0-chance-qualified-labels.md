# BP140-Q0：历史方向标签不是Minimax真值

BP140-Q0没有改变production。它把BP133/BP139的35个方向差异根重新连接到BP128的exact-prefix
反事实语料，并从BP128原始紧凑match artifact恢复候选方和控制方的根前动作流。每个根分别比较
incumbent与candidate在历史Chance、RANDOM0–RANDOM6下的完整后续，共得到560个cell；560/560均
命中相同物理root、强制相同首动作并保持exact controller history。

## 双向资格合同

Discovery为`HISTORICAL + RANDOM0–RANDOM2`，独立Holdout为`RANDOM3–RANDOM6`。一个方向只有同时满足：

- 同一Chance逐项无胜负、死亡、击毁或可比星差退化；
- 多维区间存在严格支配；
- Discovery与Holdout都通过；

才可标为`ROBUST_CANDIDATE`或`ROBUST_INCUMBENT`。支持不完整单列为`INCOMPLETE`，其余为`MIXED`。

## 结果

- `ROBUST_CANDIDATE=0`；
- `ROBUST_INCUMBENT=0`；
- `MIXED=35`；
- `INCOMPLETE=0`；
- candidate在Discovery单独通过1根、Holdout单独通过6根，但交集为0；
- incumbent在Discovery单独通过1根、Holdout单独通过2根，但交集同样为0。

历史31个相等、2个incumbent更好、2个candidate更好的单局标签全部落入`MIXED`。特别是历史frame24
的candidate击毁和frame60的candidate击毁，在其他Chance下都有胜负、死亡或星差反向；两个历史退化
也同样会在部分Chance下翻转。因此这四个样本只能说明“该次随机世界发生了什么”，不能充当新value
layer的监督真值。

## 对BP140的约束

BP139的严格事件证明太窄：敌方拒绝暴露即可让最终FIRE证书为UNKNOWN。BP140-Q0的全局终局标签又
太远：后续stun与星序列会淹没根动作的局部因果效果。下一步必须落在两者之间：使用有限事件窗口的
字典序payoff/regret interval，先保持terminal与committed安全，再结算敌方为了拒绝暴露所让出的
接触、目标进度和资源。不能恢复通用ATTACK加分，也不能再用四个历史单局方向调参。

机器证据见
`config/engine-v3/base-policy-kernel-bp140q0-chance-qualified-label-evidence.json`。
