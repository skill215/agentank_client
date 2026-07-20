# `NO_ACCEPTABLE_RESCUE` 结构修复

状态：实现与本地验收完成，2026-07-20。没有生成新的 V1/V2 对战，没有冻结 Candidate，
也没有调用官方 simulate 或 publish。

## 结论

R17 报告中的四个 `SURVIVE -> DIE` 不能直接等同为四个当前策略缺陷。旧报告在根动作之后
固定沿用历史动作，适合发现候选根动作，却不能回答“当前 V2 选择这个动作后是否仍会死亡”。
新增策略一致后续重放后，四个原样本被重新分类：

| 对局 / 帧 | 当前策略复核 | 结论 |
|---|---|---|
| `mat_9yOK...`, 26 | R17 的 `FIRE` 存活 | 固定后续动作造成的假退化 |
| `mat_1cgt...`, 51 | R17 的 `TURN_RIGHT` 存活 | 固定后续动作造成的假退化 |
| `mat_9sAI...`, 87 | R17 的 `TURN_LEFT` 死亡，`GO` 存活 | 真实的风险门兜底选择缺陷，已修复 |
| `mat_2bz...`, 79 | `TURN_LEFT` 死亡；`GO` 只在原战斗终止边界内存活 | 四帧边界后没有历史敌方动作，属于 horizon/证据不完整，不能证明 `GO` 更安全 |

因此，本轮没有为四个样本分别添加规则，也没有把风险门整体放宽。真正修复的是一个可复用的
因果排序错误：当所有动作都超出风险预算时，兜底选择先按聚合的 `horizonFatalMass` 排序；而
这个聚合量同时包含 possible projectile 和尚未发生的 future FIRE。future FIRE 已经进入递归
robust backup，再在兜底层按聚合量优先一次，会把同一未来敌方开火风险重复排序，并可能压过
实际的可逃生 Minimax 价值。

## 最终算法

`RiskAcceptanceController` 的普通可接受集、Hard gate 和严格 Proof 完全不变。只有
`acceptableCount === 0` 的应急路径使用新的因果比较器：

1. committed projectile/bomb 的致命质量仍然绝对优先；
2. possible-projectile 质量不同，仍使用原始完整风险元组，不能用价值覆盖更强的已存在弹道风险；
3. 两边都没有 possible projectile，仍使用原始完整风险元组，避免把纯 future-FIRE 场景变激进；
4. 只有两边具有相同且非零的 possible-projectile 质量，并且 `unknownMass`、最早致命帧、
   逃生余量也相同时，才允许递归 `robustLower` 接管 future-FIRE 的比较；
5. 覆盖原风险顺序还要求 `robustLower` 严格更高，且 `expectedValue` 至少高 2000/10000，
   防止数值噪声触发策略翻转；
6. 若上述条件不成立，完整回退到原字典序风险比较。

该实现只做 TypedArray 标量读取和整数比较，没有新增对象、数组或热路径分配。

## 结果

固定 352 帧 focused cohort（256 个历史死亡窗口根、96 个存活控制根）上的 R20 对 R17：

| 指标 | R17 | R20 | 变化 |
|---|---:|---:|---:|
| 历史死亡窗口中当前动作存活 | 49 | 50 | `DIE -> SURVIVE` 1，`SURVIVE -> DIE` 0 |
| 存活控制根 | 68 | 68 | 0 退化 |
| `NO_ACCEPTABLE_RESCUE` | 56 | 55 | -1 |
| 所有剩余可避免失败 | 116 | 115 | -1 |

真实修复样本 `mat_9sAI...` 帧 87 从 `TURN_LEFT` 改为 `GO`。两者的
possible-projectile fatal mass 均为 1250；旧聚合风险因为 future FIRE 不同而偏向
`TURN_LEFT`，但其 `robustLower=-9821`、`expectedValue=-5690`，均明显低于 `GO` 的
`robustLower=-9438`、`expectedValue=5012`。R20 选择 `GO` 并在策略一致重放中存活。

对 R17 的 56 个 `NO_ACCEPTABLE_RESCUE` 根全部进行策略一致后续重放后：

- 当前策略存活由 23 增至 25；
- 两个 `DIE -> SURVIVE` 分别是同一对局的帧 86 和 87；
- `SURVIVE -> DIE` 为 0；
- root restore failure 为 0。

帧 86 的根动作没有变化，但帧 87 的修复使其后续策略链不再死亡。这说明验收必须同时看根动作
和当前策略后续，不能只看固定 continuation。

## 被否决的更宽修法

以下方案都已用相同分母试验并撤销：

- 所有无可接受动作直接选最大 robust/expected value：破坏保守风险语义；
- 把逐帧致命质量总和改成时间峰值：策略一致重放为 7 个改善、9 个退化；
- 在所有 causal mass 上统一使用价值比较：4 个改善、3 个退化；
- 为 future FIRE 设置宽 robust tie band：虽然修复部分固定后续样本，但制造真实策略退化。

这些结果证明问题不在“风险门太严格”，而在应急路径对同一 future-FIRE 风险进行了二次排序。

## 验收证据

- [R20 focused report](../../artifacts/fast-regression/reports/native-poison-death-no-acceptable-tied-projectile-r20/ffcc3b1b07e862b46a850fb423177de3146902b8c45a87cfaee8158fbb91c965.json)
- [R20 vs R17 comparison](../../artifacts/fast-regression/reports/focused-no-acceptable-r20-vs-r17/b56de1005afc4d478db93e851d5f9b3ac9a6c84c07b6a871e80ddb4125edd174.json)
- [R20 failure buckets](../../artifacts/fast-regression/reports/dominated-rescue-no-acceptable-r20/6d12d9914ff3bc01a0f1071f4a62957643692b243d4dde297035a9c43ae15a29.json)
- [R17 policy-consistent baseline](../../artifacts/fast-regression/reports/no-acceptable-policy-all-actions-r17/39ef09cdfbc3d6894aac23b6708302f0f8a223346ffd67bd57fe6c306a1d5526.json)
- [R20 policy-consistent report](../../artifacts/fast-regression/reports/no-acceptable-policy-tied-projectile-r20/fc56ef8142f003b937d6eba0b7e5f58b4ea50e4dde6dc13158b729ae91a5ec8d.json)
- [19,136-root invariant replay](../../artifacts/fast-regression/reports/capsule-all/4c039319861ca0109d86d55fb92a1f4a76c5a30deb83a7c5d5c4565ec668086f.json)
- [multi-frame risk benchmark](../../artifacts/fast-regression/reports/multi-frame-risk-benchmark/ab97c3ed5f956035bfab0d0b768329b881730c12686c9f3fdf77b8bd66a45746.json)
- [search-frontier benchmark](../../artifacts/benchmarks/search-frontier/6a22ce006327e17acbc778cf58baee125089b42056dcacc7e245dd610d31ceae.json)

最终工作源码指纹为 `d2f0791d...`。测试为 183/183 通过；19,136 个历史根全部完成，
avoidable Hard reject、risk-dominated selection、strict Proof false positive、root restore failure
和 Capsule failure 均为 0。两项基准均为 `PASS`，热路径分配为 0。

## 剩余边界

`NO_ACCEPTABLE_RESCUE=55` 不表示还有 55 个同类实现 bug。该桶只说明固定历史 continuation 下
存在一个存活动作；其中包含实际世界偶然存活、四帧之后才分化、历史终止后缺少敌方动作和信息态
不可支配等情况。下一步若继续降低该桶，应先扩展“终止边界后的成对敌方响应/更长安全证书”，再
按策略一致证据分类，不能继续放宽本次应急比较器。
