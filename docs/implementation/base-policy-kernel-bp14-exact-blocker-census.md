# BasePolicyKernel BP14：精确价值阻塞普查

## 结论

BP14把“搜索完成”拆成了可审计的精确性原因。固定16场景、32个真正V3宿主对局中，1,641个
bounded-policy根只有8个整根value-exact，覆盖率0.49%。1,633个阻塞根中，1,585个同时包含预算叶和
深度叶；即使不触发预算/Fast/Hard incomplete，仍有35个根包含启发式叶。

因此，增加经验margin或把`budget-complete`重新命名为“足够精确”都不成立。有限深度点值继续只能
用于排序；整根exact合同保持严格，但不再把“所有无关动作也必须闭合”当成提高覆盖率的唯一办法。

## 实现与口径

`NativeBoundedPolicySearchPoc`记录七类正交阻塞位：预算、Fast incomplete、Hard incomplete、深度叶、
动作宽度叶、策略拒绝叶和无动作叶。`base-policy-exact-blocker-census`验证根数、W/L/D、owner阻塞数和
mask总和后生成紧凑报告。

主要结果：

| 指标 | 数值 |
|---|---:|
| 根 | 1,641 |
| exact | 8（0.49%） |
| budget阻塞 | 1,592（97.01%） |
| depth阻塞 | 1,619（98.66%） |
| budget + depth | 1,585（96.59%） |
| budget-complete但仍含启发式 | 35（2.13%） |

本阶段不改变production动作。复现入口为`tools/base-policy-kernel-bp14.sh`，结构化证据为
`config/engine-v3/base-policy-kernel-bp14-evidence.json`。

## 决策

下一步只能使用候选级证书：启发式可以提出一个候选，但必须由独立ForcedWin，或候选/真实V3动作的
逐响应精确支配来授权。不能因整根exact稀疏而放宽成有限深度点值所有权。
