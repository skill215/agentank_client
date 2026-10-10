# BP131：Depth-3代表宽度标定

BP131固定depth3、固定211组incumbent/candidate、固定共同后续策略，只改变深层代表动作宽度和最后一条
lane的节点预算：W2/B2048、W3/B2048、W4/B2048、W4/B4096。每条lane使用独立cache generation，
所有结果只进入Shadow。

## 完整率和成本

| lane | 完整/不完整 | higher/equal/lower | 合计节点 | 最大单根合计节点 |
|---|---:|---:|---:|---:|
| W2/B2048 | 30 / 181 | 18 / 6 / 6 | 24,472 | 4,096 |
| W3/B2048 | 175 / 36 | 55 / 92 / 28 | 91,945 | 3,776 |
| W4/B2048 | 175 / 36 | 55 / 92 / 28 | 93,103 | 4,004 |
| W4/B4096 | 175 / 36 | 55 / 92 / 28 | 93,118 | 4,004 |

W3恢复145个exact pair，完整率由14.22%升至82.94%，节点工作是W2的3.7571倍。W3→W4以及W4预算
翻倍均为211/211状态和关系完全相同，所以W3是当前representative generator的饱和点。剩余36根中
35根属于transition support，1根属于其他interval support，不再受宽度或预算限制。

## 完整不等于正确

W3的55个正scalar在BP128精确历史终局中是1改善、1退化、53不变；terminal Pareto为candidate支配
11、incumbent支配7。28个负scalar是0改善、4退化、24不变。扩大宽度提高了可比较分母，却没有让
正值具备动作方向性。

这证明两个优化维度必须分开：

- 性能/覆盖维度：若需要depth3完整证据，W3是有效但昂贵的诊断配置；W4无效；
- 算法/胜率维度：leaf、backup和目标语义仍无法让正scalar预测真实收益，不能因完成率提高而取得所有权。

因此production不启用W3 owner。BP132只分类剩余36个support出口；评价器修正则使用175个完整W3根
作更大的混淆语料，并保持胜负、死亡、击毁、星差多维，不调一个scalar margin。机器证据见
`config/engine-v3/base-policy-kernel-bp131-depth3-width-evidence.json`。
