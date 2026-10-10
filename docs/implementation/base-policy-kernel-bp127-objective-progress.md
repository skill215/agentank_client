# BP127：攻击目标进度向量不能独立确认Minimax动作

## 为什么不再增加一个分数

BP125和BP126已经证明，depth-2标量严格优势不能保证整局改善。BP127没有再调权重，而是在原有
AttackPose根上保留六个相互独立的可观察维度：目标进度、开火deadline、枪口覆盖、敌方响应后仍可
到达目标的覆盖、逃生分支和反击暴露。候选只有逐维不差并至少一维严格改善时，才形成Objective Pareto
关系。终局和未来出星不参与这个关系，BP126的Chance结果只在事后离线连接。

实现使用一个固定scratch向量对和固定TypedArray certificate slab，热路径分配为0。固定16场景的
64个标量证书根全部得到完整向量；Shadow与CURRENT的胜负、星、动作和资源逐项相同，production hash
仍为`0a8f09c3…23e`。

## 结果

| Objective关系 | 根数 | 8条Chance无退化 | 8条Chance严格无退化 | 最终资格 |
|---|---:|---:|---:|---:|
| candidate dominates | 59 | 1 | 0 | 0 |
| incomparable | 5 | 0 | 0 | 0 |

59个Objective dominance覆盖472个Chance cell，其中candidate改善胜负22次、退化16次、相同434次。
这说明进度维度有弱方向信号，但完全不足以产生严格动作所有权。它只过滤掉5/64个旧证书，而且连“全
8条无退化”的1个根也没有严格收益。

根因不是还缺一个权重，而是证据相关性：AttackPose先选择目标，再把朝这个目标有进度的行交给
Minimax；用同一个目标的进度重新确认这些行，大部分时候只是重复候选生成条件，不是独立验证。
response coverage和escape虽提供反证，但在这批根上变化太少，无法约束局部标量的长期退化。

## 决定与下一步

- 保留六维向量用于解释和候选审计；
- 保留AttackPose作为候选生成器；
- 拒绝Objective Pareto直接拥有动作；
- 不在这64个scalar-positive根上继续扫阈值或拼新启发式。

下一步BP128改查Minimax本身：保存211个完整paired comparison的全部三类判决——candidate更好、相等、
incumbent更好——再对两侧首动作做精确历史反事实，形成标量判决与真实终局的完整混淆矩阵。如果相等或
被反驳的候选里也存在大量正例，问题就是leaf/backup语义同时存在假阳性和假阴性，而不是所有权门还不够严。

机器摘要：
`config/engine-v3/base-policy-kernel-bp127-objective-progress-evidence.json`。
