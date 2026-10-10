# BasePolicyKernel BP13：实验宿主与精确价值所有权

## 结论

BP13修复了两个会扭曲此前BasePolicy实验结论的诊断合同问题：

1. final override生成`CAST_STUN`后没有再次经过技能发射桥，实际会被production emitter降成
   `TURN_RIGHT`；
2. 所谓native/hybrid owner的未提案回退仍是V2 production动作，并不是真正的V3/V1基线。

因此，BP9–BP12中使用旧native owner得到的W/L/D、FIRE、技能和运行时间数值全部降级为历史诊断
数据，不能再作为“V3宿主移植效果”的定量证据。它们关于软预测值不应取得robust动作所有权的定性
结论仍由修复后的对照再次支持。

修复后固定16场景、32局的有效结果是：

| 所有权模式 | W/L/D | 分析得分 | FIRE | 技能 | 相对V3动作流变化 | 正/负转换 |
|---|---:|---:|---:|---:|---:|---:|
| `V3_ONLY` | 16/14/2 | **53.13%** | 197 | 111 | 0 | 0 / 0 |
| `BUDGET_COMPLETE_OVERRIDE` | 15/15/2 | **50.00%** | 203 | 113 | 4 | 0 / 1 |
| `VALUE_EXACT_OVERRIDE` | 16/14/2 | **53.13%** | 197 | 111 | 1 | 0 / 0 |

production默认语义没有变化，production root SHA-256仍为
`c4443ddbd2a7a651d77f1582e5b68ce3715dfc87af7cf40ac7432396def39c48`。

## 发射桥根因

诊断Bot先包装`engine.emit`以便替换最终动作，技能桥随后又包装该函数。旧路径中，final override
发生在技能桥之后，替换出来的`CAST_STUN`直接进入原production emitter；该emitter不认识诊断技能
动作，最终按默认分支执行`TURN_RIGHT`。

BP13将替换动作显式交给`engine.diagnosticReplacementEmitter`，普通动作和replacement动作共享同一个
技能发射实现。集成UT使用完整`ProductionDiagnosticBot`验证：把`GO`替换成`CAST_STUN`时只调用
`me.stun()`，不调用`me.turn()`。

精确场景`mat_2oo7Bhd32HH4mziLA`复核中，两席首次错误动作都从旧`TURN_RIGHT`恢复为实际`STUN`，
owner提案与发射动作一致；两局结果仍为V2胜。修复后旧native standalone基线变成11/18/3，
39.06%。这个数字说明旧native控制器本身很弱，但它也不是V3组件移植宿主，不能用于评价Minimax替换
V3局部组件的效果。

## 正确的宿主定义

新增所有权模式：

- `v3-only`：完整V3 controller始终拥有最终动作；native搜索只做Shadow；
- `v3-base`：native只有产生合格提案时才能覆盖，否则完整回退V3 controller；
- `hybrid`：保留旧战术stage回退语义，只用于复现历史实验，不再作为V3基线。

这一区分很关键：V3不是只包含一个战术stage。只回退该stage仍可能在“无提案”时落回V2 production，
从而把宿主差异误归因给被测组件。

## “预算完整”不是“价值精确”

旧`lastOwnershipSupportComplete`仅表示本根没有触发预算、Fast或Hard incomplete。它并不表示递归值
已经由terminal或严格证书闭合。四个budget-complete覆盖根的值均包含有限深度启发式叶：

| 场景 | V3动作→覆盖动作 | native margin | 结果变化 |
|---|---:|---:|---:|
| `mat_EqI2gfxnpT68zisaY` | LEFT→GO | 143 | V2胜→V2胜 |
| `mat_CfU68NApfI6EU8bVr` | RIGHT→GO | 368 | V2胜→V2胜 |
| `mat_7YoItnsrSrw04cRu2` | LEFT→RIGHT | 111 | V1胜→V1胜 |
| `mat_I2Z8t6EspmMENRW5H` | RIGHT→LEFT | 232 | **V2胜→V1胜** |

最后一项直接反证“搜索预算完整即可取得动作所有权”。有限深度maximin可以作为有序启发式，不能冒充
最终值证书。

## 新的精确性合同

诊断搜索现在分别记录：

- `lastDepthLeafCount`：深度截断叶；
- `lastTopLeafCount`：候选上限截断叶；
- `lastPolicyRejectCount`：策略域拒绝后使用启发式的叶；
- `lastNoActionLeafCount`：没有合法动作时的fallback叶；
- `lastValueExact`：预算/Fast/Hard完整，且上述四类启发式叶全部为0。

`--bounded-policy-support-owner exact`只有在`lastValueExact=1`时允许提案。固定16场景中共有43个
budget-complete根，但只有8个exact根；1633次候选所有权被exact合同阻塞。最终只有一个对局动作流
变化：`mat_CfU68NApfI6EU8bVr` seat 0在frame 126由RIGHT改为GO，结果仍为V2胜。

因此当前证据支持：

```text
V3 base action
→ Minimax Shadow value
→ terminal / Hard / value-exact certificate
→ 才允许覆盖
```

严格exact所有权在本样本中没有退化，但也没有增加胜局。下一步应提高**证明覆盖率**，优先扩展
ForcedWin/terminal closure或构造可验证的non-regression证书；不应放宽到有限深度启发式margin，也不应
用更大的经验阈值重新包装同一个不精确值。

## 性能边界

三种模式都报告热路径对象分配为0。这里的本地运行同时执行V3 oracle与native Shadow，不能作为
production耗时或平台3000ms证据；本轮只验证所有权语义，没有据此调整搜索深度或fallback参数。

结构化证据见`config/engine-v3/base-policy-kernel-bp13-evidence.json`，复现入口为
`tools/base-policy-kernel-bp13.sh`。
