# BasePolicyKernel BP9：被支配 FIRE 的价值保真审计

> **BP13数值勘误：** 本页涉及旧native owner的整局W/L/D、FIRE、技能与运行时间受
> `CAST_STUN→TURN_RIGHT`诊断发射桥缺陷及错误V3 fallback语义污染，不再作为定量基线。
> 价值分量审计可保留为历史诊断线索；正确V3宿主和动作所有权结论见
> [BP13](base-policy-kernel-bp13-host-and-exact-ownership.md)。

## 结论

BP9没有更改动作域、Risk、Minimax、owner或production代码。固定16场景仍为
16胜、14负、2平，分析得分53.13%，production root SHA-256仍为
`c4443d…39c48`。

BP7的56个“FIRE在每个敌方根响应上都低于被选动作”并非同一种问题：

| V1根值对照 | 根数 | 解释 |
|---|---:|---|
| V1也判FIRE更低 | 30 | V2忠实复现V1的局部取舍，不是V2独有Minimax错误 |
| V1判FIRE更高 | **10** | 原生V2价值排序缺陷，进入修复集 |
| V1根动作缺失 | 16 | V1 oracle没有共同动作对，保持未知 |

所以不能覆盖全部56个FIRE。可验证修复对象只有10个共同根。

## 物理层排除

10个排序缺陷根的共同动作 transition 全部可重建：

| 层 | FIRE compared/mismatch/unsupported | 被选动作 compared/mismatch/unsupported |
|---|---:|---:|
| 一步 | 49 / **0** / **0** | 49 / **0** / **0** |
| 深层 | 22 / **0** / **0** | 22 / **0** / **0** |

因此这些根不是地图、移动、弹丸、炸弹、状态相位或Fast apply/undo错误。

## 叶值分量

> BP10校正：BP9的一步分量审计没有把已经存在的`scoreTransition`计入native
> ACTION，因此本节的一步ACTION累计值不能作为精确差值。深层审计也遗漏了当时尚未实现的
> apply后响应增量。物理transition零差异、40个共同根的V1/native排序分类以及静态缺口仍然
> 有效；分量数值由BP10同轨迹A/B替代。

下表为`native - V1`累计差，分量顺序为OBJECTIVE、PROJECTILE、ATTACK、
POSITION、STATUS、ACTION、REPETITION、SURVIVAL：

| 动作/层 | 非零差异 |
|---|---|
| FIRE一步 | POSITION `+8`，ACTION **`-3782`** |
| 对照一步 | POSITION `-42`，ACTION `-582` |
| FIRE深层 | ACTION **`-3890`**，REPETITION `-255` |
| 对照深层 | POSITION `+1`，ACTION `+10` |

OBJECTIVE、PROJECTILE、ATTACK和SURVIVAL均为0。主缺陷不是“Minimax太保守”，而是
原生路径价值对FIRE的响应条件收益计算不完整。

静态代码对照给出一个明确实现缺口：V1 `applyJointActions`在敌方移动结果已知后把
`predictiveInterceptOutcomeScore`加入`actionScore`；原生
`NativeV1PathUtilityPoc.fireTransitionUtility`明确声明该项应由
applied-transition hook计算，但当前搜索不存在这个hook。这与ACTION分量负差方向一致，
是BP10的第一修复候选。它当时仍只是静态相关性，不能在ACTIVE结果出来前称为已确认的胜率
根因。REPETITION差异只作为第二优先级，不能和FIRE修复混在一起。

## 搜索整体健康度

所有根的审计中，transition exact的482根有434根最佳动作一致（90.04%）；同时满足完整
ownership support的20根有18根一致（90%）。这说明不应重写整个Minimax。应修复局部的
transition-dependent path utility，再重新标定搜索性能。

## 下一步

BP10只实现诊断性的response-conditioned FIRE action delta：

1. 在成功apply后、undo前计算，与V1 `predictiveInterceptOutcomeScore`逐分支对账；
2. Shadow模式先要求10根的ACTION分量差显著收敛、物理差仍为0；
3. 只有根排序获得V1 oracle支持后，才运行固定16 ACTIVE POC；
4. 不给FIRE加常量、不绕过cellwise dominance、不同时修改repetition。

结构化证据见
`config/engine-v3/base-policy-kernel-bp9-evidence.json`。
