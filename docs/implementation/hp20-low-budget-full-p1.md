# HP20：低预算full-width P1调度标定

## 假设

HP19发现14个Physical根因node budget低于250而不能进入Direct-P2。HP20只改变这一条调度边界：
把`DIRECT_DEPTH_TWO_MIN_NODE_BUDGET`从250降为192，保持搜索深度数组、节点预算、work charge、
Hard、Risk、值函数和stun/火线规则不变。

候选仍执行既有Direct顺序：先完成full-width P1，再用剩余预算尝试P2。它没有新增搜索算法，
只是让fallback的192-node档也能进入该顺序。

## 固定16场景结果

CURRENT与候选的32局动作、W/L/D、星、帧数和终局原因全部一致，硬不变量为0。审计显示候选
将9个根从旧调度切到Direct，P2 attempts由46增至55，P2 completed由43增至49。

但最终性能证据没有改善：

| 指标 | CURRENT | threshold=192 | 变化 |
|---|---:|---:|---:|
| Physical frames | 73 | 73 | 0 |
| Physical nodes | 24,366 | 24,457 | +91 |
| work units | 4,383,247 | 4,383,759 | +512 |
| complete value owner | 70 | 70 | 0 |
| evidence-only value | 3 | 3 | 0 |
| depth histogram | 19/49/1/4 | 19/49/1/4 | 0 |

这里的深度直方图依次是P1/P2/P3/P4。新增的6次Direct P2完成只是替代旧调度已经完成的同层
工作，没有让任何root获得更深结果或新的完整owner。因此阈值192是一条更贵的等价路径。

## 决策

- 候选`LOW_BUDGET_FULL_P1_192`标记REJECTED；
- production门槛保持250；
- 本地wall-clock因profile运行顺序和JIT出现的下降不用于推翻确定性nodes/work结果；
- HP21单独研究stun根。stun包含ChanceOutcome分支，必须先证明full-width P1支持和预算收益，
  不能把本阶段阈值修改与stun放宽组合测试。

机器证据见`config/engine-v2/hp20-low-budget-full-p1-evidence.json`。Minimax源码没有变化，
`after-hp19`深度标定仍为CURRENT。

## 验证

- Minimax：148/148；
- Diagnostics：107/107；
- GR0：282/282；
- IMP5：14/14；
- HP19 source fingerprint仍为
  `3b664292f8fe176bc00acdd982fb7e74cf4f03bbc67df66b004bc5da2c11f11b`。
