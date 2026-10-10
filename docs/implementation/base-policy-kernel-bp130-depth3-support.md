# BP130：Depth-3不完整根因是代表动作宽度

BP130在BP129的同一211组固定pair上增加了不影响动作的出口遥测。遥测直接读取
`ProductionDepthSearch`已有的`iterationTruncatedCount`、`lastNonExactAbortReason`、完成深度、exact
support深度、预算中断和Fast/Hard不完整计数，全部保存到固定TypedArray。

## 分类结果

211个根中30个depth3完整，181个不完整。181个不完整根全部得到相同的事实分类：

- 181/181为`NONEXACT_ABORT_REASON.WIDTH`；
- 176个先在incumbent分支截断，5个incumbent完整后在candidate分支截断；
- incumbent截断中123个多出1个representative、53个多出2个；candidate的5个均多出1个；
- budget interrupt、Fast support、Hard support、root restore和未分类均为0；
- 这些不完整根合计只执行11,244节点，单根最大合计470，远低于2×2,048的pair预算。

当前depth3初始pass使用representative width 2。depth2已经存在exact owner时，depth3任一深层状态生成
超过两个代表动作，`exactOwnerEarlyAbort`便正确停止不可接管的非exact尝试。因此candidate分支通常
根本不需要运行。这是性能保护按设计生效，不是错误地提前耗尽时间。

## 结论

BP129“不是预算问题”的结论得到加强，但其宽泛的closure/leaf判断被BP130收窄：这181个根尚未走到
需要修改leaf或Fast/Hard语义的证据边界，首先阻塞它们的是代表动作宽度。

下一步BP131只做诊断宽度标定：同一pair、同一depth3和独立cache下比较W2/W3/W4，测完整率、节点数、
关系符号与BP128历史终局方向。只有宽度增加能以可接受成本形成稳定完整区间，才讨论production调度；
不会直接关闭fail-closed，也不会发布非exact点值。机器证据见
`config/engine-v3/base-policy-kernel-bp130-depth3-support-evidence.json`。
