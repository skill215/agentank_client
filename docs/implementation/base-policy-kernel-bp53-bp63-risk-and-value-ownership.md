# BP53–BP63：Risk 与有限深度价值所有权

## 当前结论

普通战术接触的有效组合已经收敛为：

```text
Physical Hard / strict Proof / committed EO
→ Risk acceptable threshold
→ enemy-disabled tactical invocation
→ finite-depth BasePolicy Minimax + intent proxy
→ joint Pareto over Risk and Minimax value
→ stable action order
```

Risk-only Pareto不能作为Minimax前的硬成员门。它把得分从joint/acceptable的46.88%降到
21.88%；Risk阈值本身是正向的，无Risk时只有39.06%。joint模式允许用更高战术价值交换已接受的
Risk维度，同时保持真正的Risk+value联合支配选择为0。

非接触Minimax从46.88%降到31.25%，committed escape内重排从46.88%降到40.63%，两者均拒绝。
非接触由战略控制器负责；committed EO只负责可活成员与救援证书。

## Intent消融

固定16场景必须使用BP5的enemy-disabled mask=1。串行结果为：

| intent进入价值的方式 | 胜/负/平 | 得分 | 击毁 |
|---|---:|---:|---:|
| 加法代理 | 12/14/6 | 46.88% | 9 |
| 仅完全同值时tie-break | 9/21/2 | 31.25% | 4 |
| 完全关闭 | 7/24/1 | 23.44% | 4 |

因此intent不是当前污染源，而是在短深度边界上补充长期目标。未来可以由真实Strategy/Plan value
替换，但不能在没有等价bootstrap时直接删除。

## 精确分歧分类

owner现在用固定`membershipStage`数组记录每行动作第一次在哪层停止。固定16的523个proposal分歧中，
256个动作未进入最终集合：253个来自Risk阈值、3个来自搜索源域，Hard之后的owner域和intent域均为0。
另外267个V1动作已进入集合，但全部被Minimax排得更低，没有一次被排高。

这证明主要剩余矛盾是价值次序，而不是动作生成或owner域。

## Leaf截断因果实验

V1非终局值不截断；原生leaf把总和硬截断到±25000。完全移除截断虽使单步leaf绝对误差降低约34%，
但整局从46.88%降到34.38%，说明有限时域启发式幅度不能直接当终局确定价值。

总截断的另一缺陷是任一大分量饱和后会抹掉其他维度。BP62改为每个分量独立±25000截断后再求和，
不改变阈值、不加动作分数：

| 模式 | 固定16胜/负/平 | 得分 | 击毁 | Pairwise反向 |
|---|---:|---:|---:|---:|
| 总和截断 | 12/14/6 | 46.88% | 9 | 604 |
| 分量截断 | 15/12/5 | 54.69% | 10 | 558 |

已知Discovery64中，分量截断为35/77/16、33.59%，相对冻结的总截断32/82/14、30.47%提高
3.12个百分点；少5负、多3胜2平，净击毁差从-11改善到-9。星差轻微从-105变为-107，收益来自
生存/战斗而不是抢星。

该候选仍未进入production。参数和源码已冻结到
`config/engine-v3/base-policy-kernel-bp63-component-clamp-candidate.json`，并且没有根据Holdout结果调整
25k阈值。

## BP64：独立Combat Holdout

冻结候选后，在此前未用于选择component clamp的128场景、256局`COMBAT_HOLDOUT`上，串行运行
total/component A/B：

| 模式 | 胜/负/平 | 得分 | 星差 | 净击毁差 | FIRE | 击毁 |
|---|---:|---:|---:|---:|---:|---:|
| 总和截断 | 60/163/33 | 29.88% | -189 | -36 | 1509 | 42 |
| 分量截断 | 65/164/27 | 30.66% | -190 | -31 | 1488 | 47 |

分量截断只提高0.78个百分点，星差下降1，击毁增加5。256局中54局动作流发生改变；按场景合并两种
换位后，正向10、负向10、无变化108，单侧随机化检验`p=0.588098526`。Hard误拒、Risk+value
联合支配选择、root restore和timeout/error均为0。

结论为`REJECTED_FOR_DEFAULT_WEAK_POSITIVE`：component clamp保留为诊断模式和战斗价值分解线索，
但不能作为production默认。Discovery上的3.12个百分点没有在独立样本中复现，禁止继续扫描截断阈值。

## 下一问题：有限时域值的语义可信度

Holdout中P2与P3的动作一致率都约69%，P3没有显示出显著更可靠的动作次序；同时搜索记录了约6千次
fast/hard incomplete和约3.2千次深层transition unsupported。`completedDepth`只表示执行到计划层数，
不表示叶值是终局事实，也不表示各层根动作已经稳定。

下一轮不按胜率选择搜索深度，也不减少Minimax工作。它只在Shadow中记录同一root的逐层动作和值次序，
把“到达层数”和“动作次序稳定/支持完整”分开。若P1/P2/P3根动作反复翻转，普通有限深度值不能直接
取得动作所有权；只有终局、Proof或跨层稳定且支持完整的值区间才有资格覆盖长期策略。

## BP65–BP66：逐层稳定性与所有权分解

在固定16场景中让V1 oracle始终执行动作，P1/P2/P3只做Shadow。按场景、座位、帧和双hash精确对齐
1,866个root，丢失root为0：

- P1与P2各自命中V1战术动作1,125次（60.29%）；
- P3命中1,196次（64.09%）；
- P2→P3有235次翻转，其中130次改对、59次改错；
- P2=P3的1,631个root中仍有565个稳定错误；
- “稳定时用P3，不稳定时退回当前V2”只有60.72%，低于直接P3。

因此更深平均有益，但跨层稳定不能充当正确性证书；当前V2 incumbent也不是合格fallback。P3的670个
错误进一步分解为：182个V1战术阶段不提案、278个V1动作被Risk threshold删除、210个动作可用但
被有限深度值排低。

278个Risk冲突中，277个动作的immediate fatal mass为0；249个只有horizon风险，21个只有unknown，
并且没有一个被Risk Pareto标记为支配。这证明普通future风险被错误地用作动作成员生杀门。

## BP67–BP68：Strategy授权的已知软风险带

新增默认关闭的`intent-known`诊断模式。它不关闭Risk，也不改变Hard：只有immediate fatal mass=0、
unknown mass=0、Risk未支配且当前长期intent明确支持的行，可以越过horizon acceptable阈值；其后仍
由原Minimax、intent和joint Risk次序比较。

| 集合 | 旧组合胜/负/平 | 新组合胜/负/平 | 旧得分 | 新得分 | 变化 |
|---|---:|---:|---:|---:|---:|
| 固定16 / 32局 | 12/14/6 | 22/10/0 | 46.88% | 68.75% | +21.87pp |
| Discovery64 / 128局 | 32/82/14 | 67/47/14 | 30.47% | 57.81% | +27.34pp |

固定16逐局为9个`LOSS→WIN`、6个`DRAW→WIN`、5个`WIN→LOSS`；星差-19→+1，净击毁差+5→+9。
Discovery64星差-105→-13，净击毁差-11→+24，FIRE为891。7,293个软风险候选中只放行1,295，
其余仍因immediate、unknown或无intent被拒。Hard误拒、joint支配选择、restore和timeout/error均为0。

候选已冻结到`config/engine-v3/base-policy-kernel-bp68-intent-known-soft-risk-candidate.json`。下一步只在
未参与本规则形成的`STRATEGY_HOLDOUT`对`off/intent-known`各运行一次；Holdout前不再修改规则。

## BP69：独立Strategy Holdout

冻结后在96场景、每模式192局上完成独立A/B：

| 模式 | 胜/负/平 | 得分 | 星差 | 净击毁差 | FIRE |
|---|---:|---:|---:|---:|---:|
| soft band off | 50/128/14 | 29.69% | -144 | -38 | 1048 |
| intent-known | 79/98/15 | 45.05% | -4 | -15 | 1149 |

逐局有48个`LOSS→WIN`、23个`WIN→LOSS`，另有7个`DRAW→WIN`、3个`WIN→DRAW`、
10个`LOSS→DRAW`和5个`DRAW→LOSS`。按场景合并换位后正44、负18、平34，精确单侧随机化检验
`p=0.00044392429430010474`；弹丸击毁净增12。全部硬不变量为0。

相对旧组合提升15.36个百分点且统计显著，证明“Strategy授权软风险、Risk负责风险维度而非独占成员资格”
是正确架构方向。但候选绝对得分45.05%，未达到预注册50%，因此状态为
`VALIDATED_POSITIVE_NOT_QUALIFIED`：它成为下一轮诊断基线，不改production默认。

剩余2,230个动作分歧中，736个仍是Risk拒绝，1,373个是动作已进入集合但被有限深度值排低；后者已成为
第一大缺陷。下一轮固定soft-band语义，不再调Risk阈值，转向根值次序的结构性校准。
