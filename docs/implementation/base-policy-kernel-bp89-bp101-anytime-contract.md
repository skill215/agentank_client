# BP89–BP101：Chance一致性、共同深度与有限时域反例

## 结论

本轮没有把更大depth或budget当成胜率参数。实验把两个问题拆开：

1. `NativeBoundedPolicySearchPoc`原来的`row-shared`预算会让同一根矩阵的敌方列得到不同有效深度；
2. 即使只发布完整共同深度，P2/P3仍可能比P1差，说明剩余主因是有限时域目标与叶值，而不是单纯算力不足。

新增默认关闭的`iterative-complete`诊断模式：

```text
P1 complete
→ remaining budget尝试P2
→ remaining budget尝试P3/P4
→ 更深层任一cell预算/Fast/Hard不完整时恢复最后完整共同层
```

该模式使用固定TypedArray保存上一完整root matrix，热路径不创建对象；每个外部root共享一个硬policy-node预算，未完成层不能取得动作所有权。它不修改production bundle和当前BP68候选默认语义。

## 单场景预算反例

场景`mat_5MvYesJA23RBie0Fc`显示旧标量截断明显非单调：

| depth / budget | row-shared结果 | cell-equal结果 |
|---|---:|---:|
| P3 / 128 | 0胜2负 | 1胜1负 |
| P3 / 256 | 0胜2负 | 1胜1负 |
| P3 / 512 | 2胜0负 | 1胜1负 |
| P3 / 1024 | 1胜1负 | 1胜1负 |
| P4 / 128 | 1胜1平 | 1胜1平 |
| P4 / 256 | 0胜2负 | 1胜1负 |
| P4 / 512 | 1胜1平 | 1胜1负 |
| P4 / 1024 | 1胜1负 | 2胜0负 |

`cell-equal`降低了列顺序偏置，但仍混合完整/截断子树，不能成为稳定anytime合同。P3在4096预算仍有数千budget leaf；两局约25万policy nodes、约20万joint transitions，本地候选时间达到5–6秒。继续全宽加预算不可行。

## fixed16共同深度曲线

固定16场景、32局、相同Risk/Intent/Chance/动作域：

| 模式 | 胜/负/平 | 得分 | policy nodes | 候选总耗时 | 发布深度P1/P2/P3/P4 |
|---|---:|---:|---:|---:|---:|
| 当前`v1-state/128` | 22/10/0 | 68.75% | 315,030 | 22,602,849us | 不适用，发布混合截断标量 |
| iterative/128 | 16/14/2 | 53.13% | 220,158 | 20,202,226us | 1,315/411/0/21 |
| iterative/256 | 12/17/3 | 42.19% | 418,651 | 22,507,210us | 761/949/1/22 |
| iterative/512 | 13/16/3 | 45.31% | 808,245 | 27,866,468us | 312/1,362/28/29 |

128共同层相对当前混合截断：

- policy nodes减少约30.1%；
- 候选总耗时减少约10.6%；
- 单根实际policy nodes不超过配置预算；
- root restore、Hard、timeout/error保持0；
- 但得分下降15.62个百分点，因此不能替换当前候选。

256/512让更多根完整发布P2，却继续下降。更高共同深度没有自动提高动作质量，证明当前搜索存在明显horizon effect：搜索越完整，只是越精确地优化当前短时叶目标。旧截断值在固定集上的收益属于启发偏差，不能被解释为Minimax正确性。

## 架构决定

`iterative-complete`保留为后续所有BasePolicy性能和语义实验的基线，但默认关闭。后续禁止：

- 用提高全宽depth/budget修胜率；
- 发布部分根矩阵为“完整Minimax值”；
- 用单场景胜负选择节点预算；
- 把运行更深与价值更正确合并成同一验收。

下一结构阶段应先改变时域定义，而非继续调常量：

1. 稳定叶/战术quiescence：完整根浅搜后，只沿FIRE、已提交危险、强制闪避和技能效果等非静态事件延长；
2. 或策略Option时域：根保留完整原语量词，深层改为少量持久策略；Hard/Proof/committed safety仍使用完整物理量词；
3. 使用同root P1/P2/P3与实际续行结果分别验证叶值和时域；
4. 性能门只比较完成深度、nodes、P95和fallback帧，决策门独立比较整局结果。

## 验证

- BasePolicy/CLI focused UT：41/41通过；
- `iterative-complete`覆盖上一完整层恢复、最深完整层发布、无完整P1拒绝所有权；
- 单场景硬预算：88个root上限11,264 nodes，实际10,890，单层最大120；
- fixed16全部`rootRestoreFailure=0`、`timeoutError=0`、`avoidableHardReject=0`、joint dominated selection=0。
