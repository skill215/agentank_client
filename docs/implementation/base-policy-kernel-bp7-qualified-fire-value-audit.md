# BasePolicyKernel BP7：合格 FIRE 的 Minimax 价值归因

## 结论

BP7 只增加固定数组计数器和 UT，不改变动作域、值函数、Risk、Minimax 或最终动作。
固定 16 场景仍为 16胜、14负、2平，分析得分 53.13%；production root 的
SHA-256 仍是 `c4443d…39c48`。

真正满足以下条件的 FIRE 有 169 个：

```text
FIRE 已进入根域
∩ Hard 允许
∩ Risk 可接受且不被风险支配
∩ CombatVector 目的完整
∩ postFireEscape
```

其中 73 个被 Minimax 选择，96 个未被选择。问题不是“所有可开火动作都被 Risk
删掉”，也不能用一个全局 FIRE bonus 修复。

## 漏斗

| 阶段 | 根数 |
|---|---:|
| 搜索根 | 1,535 |
| FIRE 存在 | 1,241 |
| source domain允许 | 317 |
| Risk拒绝 | 111 |
| Risk支配删除 | 8 |
| 攻击目的完整 | 169 |
| 开火后可逃 | 169 |
| 攻击闭包完整 | 168 |
| Minimax选择FIRE | 73 |
| Minimax未选FIRE | **96** |

169 个目的完整行几乎都不是直接必杀：direct kill仅1个，possible hit为162个，
intercept为168个，能裁掉至少一个敌方第一动作的只有49个。这说明
`intercept/possibleHit` 是软攻击证据，不能升级成ForcedWin。

## 96 个未选 FIRE 的三类所有者

| 类别 | 根数 | 含义 |
|---|---:|---|
| 另一动作逐敌方响应支配FIRE | 56 | 叶值或后继延续把FIRE整体评低 |
| 响应矩阵互有胜负 | 37 | 最坏响应量词压下FIRE，需要受限反事实验证 |
| FIRE逐响应支配另一动作 | 3 | 不是Minimax矩阵问题，是后置意图仲裁反转 |

从意图仲裁前的V1-exact blended search value看，85个FIRE确实较低，1个平手，
10个原始值更高却最终落败；该值按V1 opponent context在最坏响应与加权响应期望之间
做整数混合，并不是pure worst value。
这10个全部由150分的V1-shaped intent连续性改变排序，nominal opponent policy反转为0。
因此先前看到的3个“FIRE逐响应更好却未选”不是搜索值源错乱，而是战略连续性仍能在
Minimax之后拥有动作排序权。

## 下一步边界

下一轮必须把两类反事实分开：

1. 对37个矩阵tradeoff根，只在固定敌方响应矩阵上比较 worst-response分量、受限
   mixed/nominal backup和真实后续结果；先Shadow，不能直接放宽Minimax。
2. 对10个intent flip根，比较“延续当前V1意图”和“采用已验证FIRE”的短期结果；只允许
   完整攻击闭包、无风险退化的FIRE挑战意图连续性。
3. 56个逐响应被支配行不做动作覆盖；若要修，必须回到leaf/continuation分量，找到具体
   分量错误并用oracle证明。

结构化数字见
`config/engine-v3/base-policy-kernel-bp7-evidence.json`。
