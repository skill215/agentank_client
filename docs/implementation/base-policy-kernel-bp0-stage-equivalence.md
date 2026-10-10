# BasePolicyKernel BP0：意图与动作映射等价

## 结论

BP0 已把 V1 战术 stage 的意图事实接入原生诊断链，并消除了 Shadow 诊断自身污染状态的问题。在固定前16场景、双方换位、`stun`、oracle 持有最终动作的64局运行中，候选侧共有1,549个可比较战术根：

- proposed intent：1,549/1,549 一致；
- committed intent：1,549/1,549 一致；
- intent/action mapping：1,549/1,549 一致；
- context epoch：1,544/1,549 一致，仍有5个上下文转换事件待闭合；
- 完整原生战术动作：1,127/2,024 一致，55.68%。

前三项达到逐根完全等价，说明当前 `determineIntent`、提交意图以及 V1 动作到意图的映射可以冻结，不应继续通过修改意图启发式来追逐胜率。55.68%的完整动作一致率同时证明 BP0 还不是完整 BasePolicyKernel：主要差异已经收敛到动作域资格和递归 value，而不是意图分类。

## 诊断缺陷与修复

初次运行中，Shadow 路径先提交原生 counterfactual，再执行 V1 oracle 动作，导致下一帧 `lastIntent/contextEpoch` 被错误的原生选择污染。这使 committed intent 和 mapping 差异看似来自 V1/V2 语义，实际是诊断工具改变了被测状态。

修复后采用逐根双相流程：

1. 在同一根上独立比较 native proposal 与 V1 oracle；
2. 记录差异后，以 oracle 已执行动作产生的 `lastIntent/lastIntentEpoch/contextEpoch` 重基原生诊断状态；
3. 下一根只继承 oracle 世界的持久状态。

该修复不进入 production，不改变上传 bundle。

## 固定证据

最终运行目录：`/tmp/agentank-base-policy-bp0-fixed16-root-rebased`

- physical matches：64；候选/oracle-owner matches：32；
- 候选结果：3胜、28负、1平，分析得分10.94%；
- Hard、Risk domination、root restore、timeout/error：全部为0；
- 诊断热路径分配：0；
- final manifest SHA-256：`183181b1690c3cfa50ed215c2826b6e4ae09fe4ee86b65678367b75956b63e45`；
- final overview SHA-256：`7ce78056af0eb43957a945c2327d0e5997036f726c94f7ff7035a08b3d6c3160`。

10.94%不是 BP0 的行为验收值：运行仍把 V1 战术 stage 移植到 V2 的其他所有权层中，目的仅是逐根语义比较。原生和oracle在同一进程同时执行，因此本轮耗时也不能当作 production 性能结果。

验证结果：

- diagnostics：482/482；
- V3：60/60；
- Minimax core：220/220。

## 下一阶段

BP1 只处理剩余两层，不调整 Minimax 深度、评分阈值或战略权重：

1. 定位5个 context epoch 转换，闭合 V1 的上下文进入/退出条件；
2. 逐根复刻 `tacticalActions` 的 root/deep 动作资格；
3. 增加 overload、stun-contact、turn-then-fire 的动作域陷阱；
4. 动作域等价后再比较 simultaneous maximin、opponent expectation、node budget；
5. 最后处理 repetition/path utility/Monte Carlo 叶语义。

只有动作域和递归 value 分别有独立差分证据后，才允许它们影响 production 默认。
