# HP10–HP11 Minimax值所有权与精确回退

状态：`PASS_LOCAL`。本阶段没有用胜率调整深度、Risk或战略参数；完成标定后只运行了一个
16场景的小型值所有权因果arena，没有运行全量arena。

## 问题

HP10差分oracle确认Physical depth-2递归值本身正确，但生产调度存在两个所有权错误：

1. `representativeSupportComplete`只检查动作宽度截断，没有检查Fast/Hard留下的
   `INCOMPLETE` cell，因此不完整矩阵可能获得精确证书；
2. 更深迭代只要完成遍历就覆盖`rootScore/rootCellScore`，即使该迭代动作集被截断或含未知
   cell。这样会丢掉已经完成的浅层精确值。

固定16根的旧P2调度只有25%调用拥有严格值支持。其余完成深搜只提供近似值；在HP10把不完整搜索
降级为evidence-only之后，这些根自然失去Minimax值所有权。

同格移动争用是唯一不能建立P1证书的固定根。平台目前存在顺序阻塞、intent阻塞和碰撞击毁三种
相互冲突的实现证据，因此继续保持`UNKNOWN`，没有猜测物理规则。

## 修复

`ProductionDepthSearch`现在分开记录：

- `completedDepth/completedExpansionLimit`：最后完成遍历的尝试；
- `representativeSupportDepth/representativeSupportExpansionLimit`：当前发布值的精确所有者；
- `representativeBestRow/representativeBestValue`：与发布矩阵绑定的根选择。

直接调度在同一个512节点、60,000 work上限内先运行full-width P1，再运行full-width P2。P2只有在
全部代表动作和全部Fast/Hard cell完整时才替换P1；否则继续发布P1。更深近似尝试仍可形成sound
区间和TT证据，但不能覆盖精确值。

HP11进一步增加语义中性早停：如果已有精确所有者，而新迭代出现动作截断、unsupported transition
或Hard incomplete，该迭代已不可能取得值所有权。搜索先为精确所有者保存一个可复用Successor-TT
principal，然后停止剩余近似工作。同一后继的不同动作宽度使用独立固定槽记录，lookup仍要求
宽度精确匹配，不改变PV身份或根所有权。

## 正确性证据

- 独立Physical depth-2 oracle逐cell一致；
- 16个固定根中15个有精确值：8个P2、7个P1 fallback、1个规则未知；
- 早停ON/OFF的16根`rootScore/rootCellScore/bestRow/bestValue/supportDepth`完全一致；
- 早停节点3,566，对照5,887，减少39.4%；
- cache ON/OFF值、动作、支持深度一致；
- root restore、RootTransition replay、热分配和warm/cold语义错误全部为0；
- Minimax core 146项、GR0 280项、IMP5 14项、diagnostics 77项通过。

## 标定结果

最终报告：

```text
artifacts/benchmarks/minimax-depth-calibration/hp11-final-v2.json
config/engine-v2/minimax-depth-baselines/after-hp11-final.json
```

报告指纹：`bc69c18e7b81df85bf864c0c1a6cb2a3c66294eed4d45d85042a99ff7bc3916f`。
冻结基线指纹：`37af3ad2a0df112d014e71b83981dd02a691aa6892f980aa07a28fb00dc0e07e`。

相对HP10：

| profile | 严格支持 | cold P50节点 | cold P95节点 | cold P95 |
|---|---:|---:|---:|---:|
| P1 | 93.75% → 93.75% | 153 → 153 | 342 → 342 | 824 → 1030us |
| P2 | 25% → 93.75% | 181 → 273 | 512 → 489 | 1606 → 1486us |
| P3 | 25% → 93.75% | 512 → 305 | 512 → 512 | 2583 → 1490us |
| P6 | 25% → 93.75% | 512 → 305 | 512 → 512 | 2354 → 1547us |

P2的P50节点上升是因为现在先建立full-width P1证书；P95节点和耗时仍下降。P3–P6不再把预算耗在
不能取得所有权的近似层，P50节点明显下降。P1节点完全不变，跨时墙钟上升属于运行负载漂移，
不归因于算法。独立同进程交错A/B对旧P2-width2调度得到P95
106.5%、平均节点86.5%，低于120%时间护栏，并获得15/16严格支持。

## 小型因果arena

诊断Bot用运行时包装器只消融HP11新增的direct-schedule精确证书，Production源码、遍历节点、
Hard、Risk、战略和物理均不变。固定Discovery前16场景、双换位共32个paired match得到：

- CURRENT与HP10边界均为2胜、28负、2平，分析得分9.38%；
- 正向转换0、负向转换0、结果不变32；星差和终局逐项一致；
- CURRENT发布32次完整值所有者，HP10包装器抑制8次direct证书；
- 只有1/32动作流变化，没有任何胜负、终局帧、reason或星数变化。

唯一分歧位于`mat_CfU68NApfI6EU8bVr`、candidate seat 0、第37帧。根状态和11,244 work完全
一致：CURRENT的full-width P2完整证明`GO`面对敌方`GO`响应为-900；Risk按`/2`消费后将GO
总分从1644降到1194，因而选择1584分的`TURN_RIGHT`。HP10边界不允许该矩阵取得所有权，继续
选择GO。两条轨迹最终都在128帧以1:2星数失败。

因此本次因果分类为`NEUTRAL_GAMEPLAY / POSITIVE_CORRECTNESS_PERFORMANCE`。证书已经被生产
Risk正确消费，但Physical完整值在32局中只改变一个动作流；与1,282次Information evidence-only
相比，当前整局瓶颈更可能是Information值支持和战术/战略消费，而不是继续提高Physical深度。
这个结论不能用于撤销严格证书，也不能宣称胜率提升。

## 边界

本阶段只证明Minimax值所有权和性能结构正确，小型arena没有证明整局胜率改善。下一步应先测量
Information搜索为什么大量停留在evidence-only，以及这些证据是否能以严格区间影响战术动作；
不能继续盲目加深Physical搜索、撤销精确证书或恢复不完整矩阵所有权。平台3000ms仍只能由官方
simulate证明。
