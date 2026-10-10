# 同帧腾空跟随规则与三世界 Minimax POC

## 结论

这轮先解决了一个真实物理缺口，再拒绝了一个“能算更深但不能改善选择”的昂贵搜索方案。

当前动态历史池的1,283个去重官方replay、83,570个record中，共有19,509个双方都发生单位移动
的record。其中31个明确表现为一方进入对手的帧初位置，而对手在同一record移动到别处；seat0
先进入17次，seat1后进入14次。事件顺序仍是seat0→seat1。这直接否定外部simulator中“即使
对手同时离开也阻止进入”的实现，并证明普通GO的腾空跟随是平台共同规则。

FastKernel和ReferenceKernel现在只闭合以下严格子集：

```text
双方都是普通GO
双方都无boost/stun/poison/freeze复合
两个单位目标都由公开地形完整确定
不是直接swap
→ 允许进入对方在同record确定腾空的帧初位置
```

同目标、swap、boost/teleport/effect复合继续返回unsupported/variant，不进入Hard或Proof。

## 为什么这仍没有让 Minimax 接管

修改前，固定因果场景的P2裁剪搜索有5次因`JOINT_TANK_RELOCATION`提前结束。共同路径闭合后，
搜索继续展开，出现7个更深的未闭合分支：2个直接swap、5个同目标GO/GO。这不是修复退化，
而是原先较早的UNKNOWN被移除后暴露出的下一层物理边界。

为判断是否值得把三种move variant接入生产，V3因果宿主运行了诊断三世界闭包：

- `SEQUENTIAL_BLOCK`；
- `INTENT_BLOCK`；
- `COLLISION_CRASH`。

候选动作只有在三个世界、所有敌方首动作上都不差于V1动作，并且跨世界最坏值严格更高，才可
提出接管。固定单场和固定16场景的结果一致：7/7个P2都完整闭合，额外计算1,854节点，但
`variantRefinementSelectionCount=0`。因此剩余规则不确定性确实阻止了“exact P2”标签，却不是
当前场景中缺少优质接管动作的主因。

三世界闭包保留为诊断模式`V3R2_PHYSICAL_VARIANT_P2_ACTIVE`，不进入production默认。把它放进
生产只会增加节点，不能改善动作所有权。

## 覆盖变化

共同规则路径带来的固定搜索合同变化：

- 16个HP10根仍有15个exact、1个unresolved；严格实现下P1 owner为7、P2 owner为8；
- HP28固定P3 exact oracle完成样本为27；
- root restore failure保持0；
- Minimax 217/217、IMP2 53/53、IMP3 28/28、Diagnostics 480/480、V3 55/55通过。

固定16场景三世界POC为16胜/16负、16个换位对全部split，分析得分50%。其中普通exact P2仍有
4个短视严格优势提案，但三世界闭包新增提案为0。结果继续支持当前总方向：Minimax提供严格
物理/终局证据；普通有限深度位置值不能因为“完整”就覆盖长期策略。

## 同座位长期反事实

第一次同实现基线暴露了一个分析工具错误：候选和基线的implementation id相同时，旧分析器按
id映射角色，会把任意座位胜利都写成候选胜利。对局物理结果和动作流没有损坏，但100%汇总无效。
分析器现在只按`candidateSeat`映射角色，并增加相同id、候选在seat1时的反向UT。

修正后，以`VC2_HARD_ACTIVE vs VC2_HARD_ACTIVE`生成固定16场景/32局同座位基线，再将普通exact
P2候选逐局与同场景、同candidate seat基线比较。结果为：

- 基线与候选均为16胜、16负；
- 转换矩阵严格为`WIN→WIN=16`、`LOSS→LOSS=16`；
- 4局首动作变化，0局产生胜/负/平转换；
- 2局终局质量改善，0局终局质量退化；
- 一局把同归于尽星胜改成我方存活的单方击毁胜；
- 一局把我方被击毁负改成存活到128帧但仍因星少而负。

这说明P2局部值不是整体错误：它在2/4个实际接管中改善了生存/击毁质量。但两帧优势没有形成
长期目标接续，因此没有转化为新的胜局。继续增加depth、node budget或move variant不能直接补上
这个缺口。

## Plan 接续和 Proposal Verification 消融

严格P2提案原先只改变当前动作。为了验证局部优势是否因为缺少后续目标而无法转化，诊断宿主把
被选P2行已有的`PlanSketch`物化，并逐步尝试让非接触导航继续执行该Option。固定Discovery64
包含64场景、双方换位共128局，exact-P2本身为59胜、63负、6平，得分48.44%，配对随机化
`p=0.706520`，没有显著优于V1-shaped control。

无验证的16帧recovery只改变3局，却同时产生：

- `LOSS→WIN=1`：连续7次续写最终得到干净单方击毁；
- `WIN→LOSS=1`；
- `DRAW→LOSS=1`。

总分降至48.05%。五个当前Risk维度在11次续写选择上均未阻止动作，说明四帧fatal/unknown/slack
不能证明十几帧Option的nonloss。

随后进行了五种所有权消融：

| 所有权 | 结果 | 判定 |
|---|---:|---|
| 同Plan identity + 原deadline | 58/64/6，47.66% | 删除正向接续，仍保留`WIN→LOSS` |
| 完整P1严格优势 | 58/64/6，47.66% | 5次完整比较中2次优势，实际放行的仍是退化动作 |
| 完整P2严格优势 | 59/63/6，48.44% | 6次尝试，3完整/3不完整，0次优势、0续写 |
| 完整P3严格优势 | 59/63/6，48.44% | 6次全部不完整，0续写且成本最高 |
| 完整P2不劣于V1 | 59/63/6，48.44% | 仅放行1次平值动作；仍`LOSS→LOSS`且终局质量退化 |

最后一项证明逐帧安全重验证仍不是正确Option语义：第一步P2不劣于V1，把局面带离完整V1轨迹；
下一帧证书失效后突然回退V1，最终形成既不是完整V1、也不是完整V2 Plan的混合轨迹。局部动作证书
无法保证半执行Plan的可恢复性。

现有`ProposalVerificationArbiter`的`CERTIFIED`只表示当前Safety slab完整，不是跨deadline证书；
`ActionContinuationEnvelope`也明确是观测支持不完整时的nominal诊断。两者均不得改名后冒充Option
证明。本轮新增的`RecoveryProposalVerifier`只用于P1/P2/P3因果消融，默认关闭，不进入production。

另一次全量结构测试发现，早期覆盖数字6/9和30来自把“双方命令都是GO”误当成“双方一定腾空”的
过宽统计。严格规则要求目标格可达；被墙/土阻挡的GO不会腾空。专用正反fixture全部通过，因此聚合
golden修正为P1/P2=7/8、HP28=27，而不是放宽物理实现以追逐错误计数。

## OptionPolicyCertificate：完整两帧策略仍未修复退化

诊断版`OptionPolicyCertificate`已实现为固定TypedArray：严格P2提案必须枚举所有敌方动作和chance，
每个非终局后继必须有同一搜索内的principal continuation；后继按平台可观察状态分组，同一观察组要求
共同动作。任何隐藏后继、冲突、容量不足、Hard拒绝或状态恢复失败都返回`INCOMPLETE`。该证书只是
有限时域执行证据，不写Hard、Safety或Proof。

第一版错误地用完整FastState hash作为下一callback的查找键，3个已启动证书全部失配。原因是该hash
包含内部entity generation和cache身份，它们不是平台观察。改成双32位observable key并排除内部ID后，
固定16场景得到3次完整证书、2次实际续行动作、1次观察失配，但结果从16胜/16负退化为15胜/17负：

- 一个原本67帧因敌方碰撞获胜的局，在frame 22由`GO`改为证书`RIGHT`，最终frame 52我方碰撞失败；
- 另一个原本frame 42被击毁的局避免碰撞并存活到128帧，但仍因星少失败。

这否定了“只缺完整多帧执行”的解释。两帧策略在自己的有限时域内完整，但其终端仍是启发式叶值；
`complete horizon`不等于`correct game value`。Option证书保持默认关闭，不扩大Discovery。

## 叶值与根策略先验消融

为了区分“搜索结构错误”和“叶值错误”，又运行了两个互斥诊断：

1. 将PhysicalSearch叶函数替换为V1风格整数FastState评价（星路、已提交危险、攻击race、位置和状态）；
2. 保留原叶值，只将V1当前动作放到Minimax根访问顺序第一位，不加分、不拥有动作。

V1风格叶值在固定16场景仍为16胜/16负，FIRE由exact-P2的159变为157，改变5局/217帧；相对
exact-P2没有任何终局改善，却有2个终局质量退化：一个128帧存活负变成41帧同归于尽负，另一个
4星获胜降为2星获胜。叶值与Option证书组合仍为16胜/16负；证书启动3次，只实际执行1次且动作与
V1相同，因此不构成正向所有权证据。

持续根策略先验共准备1,232次、唯一匹配并提前111次，完整搜索UT确认值、cell矩阵和动作恒等。
固定16场景相对exact-P2为0个动作帧差异、0个终局差异；但它错误地在P1完成后继续压住搜索自己的
principal row，使refinement节点从147增到283。修正的seed-only实现只影响第一次迭代，P1完成后
立即把排序交还给Minimax；节点恢复147、动作和终局仍为零差异。两种实现共同证明：持续先验性能
负向，正确seed先验完全中性，都不值得扩大样本。

三项结果共同收敛到一个架构结论：当前缺口不是继续增加depth、节点、根排序或把V1压成另一个标量，
而是深层continuation policy与根部长期策略不是同一个Bellman对象。下一步是原生
`BasePolicyKernel`等价工程：逐根复刻V1战术stage的有界同时maximin、动作资格、敌方期望、intent
迟滞、重复状态和叶语义，先达到stage动作等价；V2的Hard/EO/Proof位于其上，Minimax只有完整终局
或严格区间反证时才覆盖。该kernel不得嵌入V1/V3源码，也不得把普通有限深度点值升级为Proof。
