# BasePolicyKernel BP12：robust / nominal价值所有权拆分

> **BP13数值勘误：** 本页三模式的旧W/L/D、FIRE、技能和本地时间受诊断发射桥与fallback宿主
> 缺陷污染，已被BP13定量证据替代。robust/nominal分离的架构方向仍成立；修复后的真正V3宿主中，
> budget-complete覆盖从53.13%降至50.00%，value-exact覆盖保持53.13%，详见
> [BP13](base-policy-kernel-bp13-host-and-exact-ownership.md)。

## 结论

BP12验证了BP11的架构判断：主要退化来自**软响应预测进入robust递归标量并取得动作所有权**。

固定16场景中，把软响应值从robust通道移出后，得分由39.06%恢复到50.00%；但允许它在robust
完全相等时破同分，仍造成唯一一次`V2_WIN→V1_WIN`。因此本轮最终合同是：

```text
committed / terminal / exact value → 可以进入robust并参与选择
response prediction / possible hit → 只能Shadow、解释或训练模型
                                  → 没有独立证书时不能直接选择动作
```

production默认语义未改变，production root SHA-256仍为
`c4443ddbd2a7a651d77f1582e5b68ce3715dfc87af7cf40ac7432396def39c48`。

## 实现

诊断`NativeBoundedPolicySearchPoc`增加双整数通道：

- `rootScore/rootCellScore`：robust通道；
- `rootNominalScore/rootNominalCellScore`：nominal通道；
- 递归函数仍返回一个robust整数，nominal使用单个side-channel回传；
- 根矩阵使用预分配TypedArray；热路径对象分配为0；
- nominal只能在robust值完全相等时参与字典序比较。

这不是把两个值重新加权合成，也没有设置band或经验阈值。Hard、物理、搜索深度、动作域和预算均未
变化。

## 三模式固定16对照

| 模式 | W/L/D | 得分 | 星 | crash | FIRE | 节点 | 平均本地µs/decision |
|---|---:|---:|---:|---:|---:|---:|---:|
| `ROBUST_BASE`（BP9） | 16/14/2 | **53.13%** | 16 | 11 | 186 | 290,322 | 6,210 |
| `SOFT_IN_ROBUST`（BP10） | 12/19/1 | **39.06%** | 14 | 15 | 170 | 271,822 | 6,672 |
| `SOFT_NOMINAL_ONLY` | 15/15/2 | **50.00%** | 16 | 12 | 186 | 288,471 | 6,673 |

新实现的`single`模式与BP11历史字节行为逐局对账：

- `ROBUST_BASE`：32/32动作流和结果一致；
- `SOFT_IN_ROBUST`：32/32动作流和结果一致。

因此恢复不是由顺手改变搜索实现造成的。

相对`ROBUST_BASE`：

- soft进入robust：13局动作流变化，1正转换、6负转换；
- soft仅nominal：1局动作流变化，0正转换、1负转换。

相对错误的`SOFT_IN_ROBUST`，双通道恢复4个胜局和1个平局，只损失1个胜局。这强烈支持价值所有权
拆分，但不支持让soft nominal直接接管动作。

## 唯一nominal分歧

场景`mat_2oo7Bhd32HH4mziLA`、candidate seat 1、真实callback序号94：

- OFF/ON FastState hash完全相同；
- robust：`GO=418`，`FIRE=418`；
- nominal：`GO=418`，`FIRE=474`；
- 原稳定规则选GO，nominal破同分后选FIRE；
- V1 oracle在该根也不选择FIRE；
- 整局从128帧V2胜变为117帧V1胜。

这不是数值越过小margin，而是合同允许软预测在精确robust平局时拥有最终动作所导致。继续缩小
band没有意义，因为band已经是0。

## 性能判断

双通道没有增加搜索节点，也没有热路径对象分配，但固定16本地平均callback耗时相对BP9约增加
7.5%。本地时间不能替代平台3秒证据，不过既然该通道没有正向动作收益，它不应进入production热
路径。需要软信息时应作为离线/Shadow证据，或先转化为完整的攻击/非劣证书。

结构化证据见`config/engine-v3/base-policy-kernel-bp12-evidence.json`。
