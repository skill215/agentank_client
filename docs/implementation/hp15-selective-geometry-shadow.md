# HP15：选择性单层几何搜索 Shadow

## 结论

HP15 验证了可复用的三行单层几何搜索结构：

```text
selected final action
+ strongest qualified ordinary challenger
+ strongest qualified attack challenger
→ full enemy columns
→ one geometry horizon
```

它保留 Risk/Pareto 所有权，不恢复被拒绝或支配的动作。固定16场景中，相同行在compact与
full-width矩阵的所有cell和root value完全一致，同时减少57.82%的Information节点。

本阶段仍是post-decision Shadow；不改变production动作、runtime work、fallback或bundle。

## 候选合同

- 当前实际最终动作始终保留；
- challenger必须`acceptable && !dominated`；
- 普通与攻击动作分别保留最强一行；
- 某一类不存在时，以剩余Risk/Pareto动作补位；
- 只有一个合格动作时完全跳过搜索；
- possible projectile、future FIRE和其他Observation不完整继续归Risk；
- 几何结果是`HORIZON_UTILITY`，不是Terminal Proof；
- compact候选严格优于selected才形成未来Proposal机会。

## Full/compact differential

命令：

```bash
./tools/runtime-schedule-poc.sh \
  --profiles CURRENT,INFORMATION_DEPTH_ONE \
  --role DISCOVERY --scenarios 16 \
  --capture-selective-geometry-search-probe true \
  --selective-geometry-rows 3 \
  --output /tmp/hp15-selective-geometry-final.json
```

| 指标 | 数值 |
|---|---:|
| 单层Information attempts | 1,895 |
| full geometry complete | 1,890 |
| 无challenger直接跳过 | 614 |
| compact complete | 1,276 |
| full rows / compact rows | 8,891 / 3,760 |
| full nodes / compact nodes | 61,099 / 25,772 |
| compact/full node ratio | 42.18% |
| 节点节省 | 57.82% |
| row value comparisons / mismatch | 3,760 / 0 |
| enemy cell comparisons / mismatch | 22,876 / 0 |
| strict improvement opportunities | 193 |
| strict improvement false positive | 0 |
| root restore failure | 0 |

全局full-width赢家有217次位于Risk集合外，正确地没有被compact恢复。Compact不要求复现
全局赢家：合同只要求某个已通过Risk的候选严格优于selected。即使另一个未计算的合格动作
更强，已证明的严格改善仍成立。因此验收重点是相同行差分和假阳性，而不是full winner一致。

## 宽度对照

两行版本把compact节点进一步降至22,561（未计单行跳过优化），但严格改善机会从三行版本的
约193降至156，损失约19%。三行已经超过“至少节省50%节点”的门，因此冻结三行为下一阶段
候选，不为更低节点牺牲攻击/普通双类别覆盖。

## 未完成边界

Shadow发生在production决策完成之后，所以尚未证明把25,772个节点计入真实runtime work后，
不会使跨帧fallback提前。HP14的全宽单层已经证明直接接入会挤占Physical搜索，HP15不能用
post-decision耗时冒充该问题已经解决。

下一步HP16必须在真实顺序中接线，但仍先保持不选动作：

```text
Risk/Pareto + Strategy candidates
→ 若candidate count < 2：0 search work
→ 三行Geometry search使用独立的可取消optional quota
→ 先保留下一帧Physical/Proof reserve
→ 记录实际fallback、Physical完整迭代、strict interval proposal
```

只有实际fallback不提前、Physical完整迭代不下降、严格提案仍存在，才允许后续ACTIVE A/B。

## 验收

- Selective geometry UT 全部通过；
- Minimax 146/146；
- Diagnostics全绿；
- GR0 280/280；
- IMP5 14/14；
- 所有硬不变量、差分和restore为0；
- production source fingerprint未改变，HP12 calibration仍为CURRENT。
