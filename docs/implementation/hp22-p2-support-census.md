# HP22：P2支持中止归因

## 结论

HP22没有发现新的Minimax性能瓶颈。Discovery与独立Tactical Holdout合计196次P2尝试：
175次完成，其中165次拥有精确P2值；其余21次全部因Fast `UNSUPPORTED_RULE`中止。预算中断、
动作宽度、Hard incomplete、容量、restore和其他失败全部为0。

116个失败cell全部包含`GO`。主要组合为`GO/GO=51`、`TURN_LEFT/GO=19`、
`TURN_RIGHT/GO=16`、`GO/TURN_RIGHT=14`。新增UT复现占据格、同目标和交换位置的GO争用，
验证Fast按合同返回unsupported并事务式恢复root；非GO对照正常执行。

因此不能通过增加节点、提高depth或取消早停解决这21次中止。这样做只会更晚遇到同一个规则边界。

## 两批独立证据

固定16场景Discovery中，56次P2尝试有49次精确完成、3次非精确完成、4次规则中止；29个失败
cell全为`UNSUPPORTED_RULE`。固定32场景Tactical Holdout中，140次P2尝试有116次精确完成、
7次非精确完成、17次规则中止；87个失败cell仍全部是`UNSUPPORTED_RULE`。

两批CURRENT与诊断Shadow的动作序列、参数、终局、帧数和星数逐项零差异。诊断数组只在
`diagnosticDepthTwoPreflight`启用时构造，production保持`null`，热分配为0。

10次“完成但非精确”的尝试全部来自没有精确P1 owner的root；它们不是P2把已有精确值算坏，
也不是P2性能退化。只有3个root曾因该规则缺口阻断已有principal的进一步计算。

## 官方证据重解释

`MOVE_CONTEST_V1`在RuleRegistry中仍是`UNRESOLVED_FINITE`，候选包括顺序阻挡、intent阻挡和
碰撞击毁。外部固定模拟器采用阻挡占据格与swap intent的实现，但它本身只能提供候选规则。

重新检查不可变的官方raw replay发现，旧分析器错误地把同一record内的speech/GO关系偏移到下一帧。
真实事件从第12帧起连续22次显示：我方标记并提交进入敌方当前格的GO；敌方执行FIRE且位置不变；
我方没有移动也没有碰撞死亡。这条证据可闭合`STATIC_OCCUPIED_BLOCK`公共子规则，离线reconcile结果
为`CONCLUSIVE`，原始response及SHA-256没有变化。

它仍不能决定双方都GO时的同目标、swap或“对方将要腾空”的语义。因此本阶段不直接把整个
`MOVE_CONTEST_V1`选成某个variant；只允许下一阶段实现“对方动作确定不改变位置时，GO被阻挡为
no-effect”的公共路径，其余争用继续unsupported。

## 决策与下一步

- HP22接受为诊断阶段，不改变production默认、物理、深度、预算或动作所有权；
- 新增中止原因、Fast状态和动作对计数，后续修改Minimax可立即区分性能失败与规则失败；
- 下一步实现stationary occupied block公共路径，并用同一P2 census测量减少的规则中止和新增owner；
- `GO/GO`、teleport腾空、同目标和swap继续fail closed，不以搜索优化猜规则。

24-profile标定已冻结为`config/engine-v2/minimax-depth-baselines/after-hp22.json`。完成深度、
值支持深度和节点分布与HP21一致；本机跨时墙钟漂移不用于性能结论。机器证据见
`config/engine-v2/hp22-p2-support-census-evidence.json`。

## 验证

- Minimax：155/155；
- Diagnostics：108/108；
- GR0：289/289；
- IMP5：14/14；
- 24-profile calibration：PASS，restore/cache/allocation不变量全部为0。
