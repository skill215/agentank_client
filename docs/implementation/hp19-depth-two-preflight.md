# HP19：P2规模预估与调度阻塞定位

## 目标

HP19不再让单层几何取得动作所有权，也不重复HP8已经失败的跨帧根PV排序。它验证另一个性能
假设：当前P2是否因为完整root matrix在剩余节点预算中必然放不下，从而适合切换到选择性P2。

实现是诊断专用Shadow。在完整P1的每个已应用后继上，复用现有deep action固定slab，仅生成代表
动作并计算下一层matrix节点下界；不应用新transition，不分配对象，不修改节点/work计数。所有
iteration support字段在计数后恢复。

## 等价性

16个Minimax固定根逐项比较CURRENT与Shadow：动作、best value、root score、root cells、节点、
work、完整支持深度、代表宽度和truncation全部相同。固定16场景、32局运行同样得到动作流、
W/L/D、星数、帧数和原因零差异；Hard、Risk domination、root restore和热分配均为0。

## Census结果

固定集共有73个Physical search root：

| 调度类别 | 根数 |
|---|---:|
| Direct-P2 eligible | 46 |
| node budget低于Direct门槛 | 14 |
| stun阻断 | 12 |
| immediate fire contact阻断 | 1 |

46个Direct根投影了1,104个P1后继，P2节点下界合计6,272，而P1完成后的可用节点合计20,638；
`projected > available`为0。因此“按节点下界判定P2不可能完成后改走Selective-P2”没有实际
触发面，不能进入production。

这46个根中，P2完成43个；其余3个全部由支持不完整早停。预算中断、transition incomplete和
其他失败均为0。全体Physical深度分布为`P1=19/P2=49/P3=1/P4=4`。19个只到P1的根并非主要
来自Direct-P2矩阵过大，而是14个低预算根、12个stun根所使用的旧调度路径与少量支持失败。

## 决策

- Shadow计数器保留，production默认不运行预估器；
- 拒绝按当前节点下界切换Selective-P2；
- 不增加矩阵深度、不放宽支持完整性；
- HP20转向低预算调度标定：比较旧width-2迭代和“先完成full-width P1，再使用剩余预算”的
  调度。它只优化完整深度与支持率，胜率/动作所有权继续作为独立阶段。

机器记录见`config/engine-v2/hp19-depth-two-preflight-evidence.json`。

## 验证

- Minimax：148/148；
- Diagnostics：107/107；
- GR0：282/282；
- IMP5：14/14；
- 24-profile深度标定通过，source fingerprint为
  `3b664292f8fe176bc00acdd982fb7e74cf4f03bbc67df66b004bc5da2c11f11b`；
- 冻结基线：`config/engine-v2/minimax-depth-baselines/after-hp19.json`。
