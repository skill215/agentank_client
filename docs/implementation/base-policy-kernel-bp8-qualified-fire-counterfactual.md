# BasePolicyKernel BP8：合格 FIRE 所有权反事实

## 结论

BP8 分别让两类 FIRE 在固定16场景中取得诊断所有权：

1. `intent-active`：仅覆盖Minimax原值不低、但被V1-shaped intent连续性反转的FIRE；
2. `response-active`：仅覆盖敌方响应矩阵互有胜负、且V1-exact blended adversarial
   backup压低FIRE的根。

两类都出现显著退化，因此保持默认 `off`，不进入production。

| 模式 | 覆盖 | W/L/D | 得分 | 碰撞失败 | 弹丸击毁 | 每万弹击毁 |
|---|---:|---:|---:|---:|---:|---:|
| BP7基线 | 0 | 16/14/2 | 53.13% | 11 | 14 | 753 |
| intent-only | 10 | 13/15/4 | 46.88% | 12 | 11 | 591 |
| response-tradeoff | 30 | 8/23/1 | 26.56% | 19 | 8 | 430 |

三组都正好发射186颗弹丸。ACTIVE没有增加总开火量，而是改变了开火时刻和后续轨迹；
结果是击毁转化下降，response模式的四帧内反杀/碰撞压力由6升到13。

## 精确整局转换

intent-only相对BP7：

- `V2_WIN→V1_WIN`：2；
- `V2_WIN→DRAW`：1；
- `V1_WIN→DRAW`：1；
- 其余28局结果不变。

净结果为负，说明那10个intent flip不是“战略连续性错误”的充分证据。局部FIRE原始值较高，
不代表打断多帧位置/攻击意图后整局更好。

response-tradeoff相对BP7：

- `V1_WIN→V2_WIN`：2；
- `V2_WIN→V1_WIN`：10；
- `DRAW→V1_WIN`：1；
- 其余19局结果不变。

这直接反证了“possible hit + postFireEscape后可以绕过对抗backup”的策略。敌方的
最坏响应分量不能被名义上更容易命中的响应覆盖。

## 架构含义

`postFireEscape`只证明第一步后存在自逃动作；`possibleHit/intercept`只证明部分敌方响应受压。
两者都不是跨帧攻击策略证书。可靠攻击所有权至少需要以下之一：

- strict direct kill；
- 完整敌方响应集上的非退化；
- 带共同后续策略的攻击Plan证书；
- leaf/transition模型被独立oracle证明当前低估了FIRE。

因此下一步不继续放宽owner。应针对BP7中56个“FIRE逐响应被支配”的根，拆解native与V1的
transition、leaf component和后续策略差异，先判断值模型是否错误。

结构化证据见
`config/engine-v3/base-policy-kernel-bp8-evidence.json`。
