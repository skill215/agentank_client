# BP128：完整Minimax比较的历史混淆矩阵

BP128没有继续筛选BP125的64个正证书，而是捕获固定16场景内全部211个支持完整的paired comparison：
64个`candidate higher`、109个`equal`和38个`candidate lower`。每个比较根都分别强制incumbent与
candidate首动作，然后让原V2/V3控制器和历史出星继续运行到终局。

构造语料时发现并修复了两个诊断身份缺陷。第一，FinalActionGate并非每帧调用，保存的hash只有在保存
frame与当前frame相同时才有效，否则会把上一帧状态绑定到当前比较。第二，源arena是STUN/STUN，而
反事实工具此前调用`field()`时回落到默认非对称技能。修复后，211个incumbent和211个candidate全部
命中双hash、全部成功强制动作，211个incumbent全部复现源终局。旧REJECTED语料不作为证据。

## 结果

| scalar关系 | 根数 | candidate改善 | candidate退化 | 胜负不变 | terminal Pareto候选/原动作支配 |
|---|---:|---:|---:|---:|---:|
| higher | 64 | 2 | 2 | 60 | 13 / 11 |
| equal | 109 | 0 | 0 | 109 | 1 / 0 |
| lower | 38 | 1 | 5 | 32 | 3 / 7 |

`higher`的累计结果是非败局−1、击毁+2、死亡不变、星差−2。它既能把败局改成击毁胜，也能把平局
改成死亡或星数负局；更大的value margin同样不能分开这两类。`lower`有弱负向信号，但样本只有6个
改变胜负的根，其中仍有1个被低估的击毁胜，不能升级为Hard事实。

Objective向量也没有形成独立证书。64个正scalar里，14个仅改善目标progress，结果1改善、2退化；
50个还改善至少一个非progress维度，结果1改善、0胜负退化，但其中仍包含6个原动作terminal Pareto
支配和5个mixed tradeoff。这个子集是读完同一Discovery后的描述，不能用作新的生产门。

## 结论

- 保留三类完整comparison和精确历史反事实工具；
- 保留`candidate lower`作为诊断veto信号，不把它写入Hard；
- 拒绝`candidate higher`直接拥有primitive；
- 不按value margin调阈值，也不把事后Objective组合包装成证书。

下一步BP129只检查搜索语义本身：在预注册depth/node-budget梯度下比较同一类根的判决是否稳定。如果
符号随深度变化，根因是horizon/leaf bootstrap；如果符号稳定但仍与终局相反，根因是评价目标错位。

机器摘要：
`config/engine-v3/base-policy-kernel-bp128-comparison-confusion-evidence.json`。
