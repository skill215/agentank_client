# BasePolicyKernel BP10：响应条件 FIRE 增量

> **BP13数值勘误：** 本页旧native owner的W/L/D、FIRE、技能与运行时间受
> `CAST_STUN→TURN_RIGHT`诊断发射桥缺陷以及错误V3 fallback语义污染，不再作为定量基线。
> “软响应值进入robust所有权会退化”的定性结论已由BP13正确V3宿主重新验证；有效数值见
> [BP13](base-policy-kernel-bp13-host-and-exact-ownership.md)。

## 结论

BP10把V1的`predictiveInterceptOutcomeScore`移植为诊断搜索的apply后分支增量。Shadow
同轨迹对账证明移植方向正确，但native owner的整局ACTIVE结果从BP9的53.13%降到39.06%。
因此结论分开记录：

- **诊断价值：接受。** 它修复了一个真实的V1价值保真缺口，可继续用于oracle审计。
- **动作所有权：拒绝。** 默认保持关闭，不进入production，也不作为FIRE加分项。

production root SHA-256始终为`c4443d…39c48`。

## 先修正对账器

BP9的一步组件审计漏掉了已有的`scoreTransition`，深层审计漏掉了新的apply后增量。BP10把
路径分数按真实搜索顺序重放：

```text
pre-apply scoreTransition
→ prepareAppliedTransition
→ Fast apply + stun phase
→ scoreAppliedTransition
→ leaf component comparison
```

因此BP9的一步`ACTION=-3782`不再作为精确证据；物理transition结论不受影响。组件名也从
`MISSING_ACTION/MISSING_REPETITION`改为`ACTION/REPETITION`，明确它们现在是差值而不是缺失项。

## Shadow同轨迹A/B

两组都由V1 stage oracle输出最终动作，所以整局轨迹完全相同：13胜、16负、3平，217次
FIRE。唯一变量是native诊断搜索是否加入响应条件增量。

| 指标 | OFF | ON | 变化 |
|---|---:|---:|---:|
| 根pair顺序一致 | 3,329 / 3,655 | 3,344 / 3,655 | +15 |
| 根最佳动作一致 | 1,092 / 1,261 | 1,101 / 1,261 | +9 |
| 被支配FIRE中V1反向排序 | 11 | 1 | -10 |
| 一步ACTION绝对误差 | 1,439,978 | 1,343,723 | -96,255 |
| ply2 ACTION绝对误差 | 932,401 | 884,471 | -47,930 |
| ply3 ACTION绝对误差 | 1,003,353 | 954,381 | -48,972 |
| transition物理差异 | 508 | 508 | 0 |
| 热路径分配 | 0 | 0 | 0 |

这里的508是整个Shadow轨迹中原有的transition mismatch计数，并没有因增量而增加；增量本身
不修改FastState。它被调用16,172次，其中13,736次为正，总增量1,276,680。

## ACTIVE反证

固定16场景、32个candidate matches：

| 模式 | W/L/D | 得分 | 星 | crash | FIRE |
|---|---:|---:|---:|---:|---:|
| BP9 native owner | 16/14/2 | **53.13%** | 16 | 11 | 186 |
| BP10 response FIRE ACTIVE | 12/19/1 | **39.06%** | 14 | 15 | 170 |

32局中19局动作流完全相同，13局发生分歧。结果转换为：

- `V2_WIN→V1_WIN`：5；
- `DRAW→V1_WIN`：1；
- `V1_WIN→V2_WIN`：1；
- 其余25局结果不变。

7个结果变化局的第一分歧中，6个负转换有4个转向FIRE，唯一正转换也转向FIRE。总FIRE反而
减少16次（新增13、减少29），说明它改变的是开火时机及后续轨迹，不是简单提高开火频率。
所有Hard、Risk domination、restore和timeout/error不变量仍为0，退化属于价值组合/动作
所有权，不是物理或安全层故障。

## 架构含义

“更接近V1局部估值”不等于“在native Minimax组合中更强”。响应拦截收益是V1整体搜索策略的
一部分；单独把它提高到native owner，会改变敌方最坏响应和后续动作序列。Shadow保真提升只能
证明移植正确，ACTIVE整局反证决定它不能取得所有权。

后续不应调大/调小该增量，也不应立即修repetition。BP11已经使用首次动作分歧的整局转换建立
`value component → root choice → realized outcome`对账：响应增量拥有7/7次选择翻转，但结果为
6负1正。下一步改为分离robust确定价值与nominal软路径价值，而不是继续追求V1分量逐项相等。

结构化证据见
`config/engine-v3/base-policy-kernel-bp10-evidence.json`。
