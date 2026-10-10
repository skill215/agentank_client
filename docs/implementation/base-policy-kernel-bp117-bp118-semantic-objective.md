# BP117–BP118：语义目标身份成立，单证书ACTIVE尚未资格化

## 结论

ObjectiveEpoch不应由Option类型或POSITION generation标识，而应由`semantic target signature + target
generation`标识。POSITION只是到达敌人或星星目标的执行姿态，不能创建独立长期目标。

改成语义身份后，固定16场景中的局部两Option Minimax从18,115节点降到243节点（减少98.66%），
候选根从239个降到4个；4个根全部是同一敌人目标下的FIRE，3个被Minimax反驳，只有1个严格支配。
把这1张证书接到诊断ACTIVE后，唯一覆盖把一局83帧单方被击毁改成128帧同星平局，没有负转换。
得分增加1.56个百分点，低于动作所有者3个百分点资格门，因此production默认仍不改变。

## BP117：目标身份修复

语义映射固定为：

```text
ENEMY target → ATTACK
STAR target  → STAR_CONTROL
POSITION     → 对应target的执行alias
```

StableOptionLedger同时修复了一个诊断事实错误：过去只要地图存在星星，选中的POSITION就可能被直接
推断为STAR。现在必须读取该行完整portfolio alias；唯一target才绑定，多target时显式返回ambiguity，
禁止猜测。本cohort歧义数为0。

3,030个决策的主要结果：

- epoch由旧模型189段降到112段，最长114帧；
- 1,996次延续中有433次跨Option类型，证明primitive/kind变化不等于目标切换；
- strict执行支持由1,662帧增至2,025帧，gap由1,293降至930；
- 当前动作离开语义目标Option的根由309降至24；20个是已验证攻击并正确让行；
- 剩余4个根全部完成depth-2局部比较：3个候选更差，1个严格支配；
- 搜索总节点243、单根最多63，root restore和热分配均为0。

这证明此前BP116的性能不是Minimax本身造成，而是错误目标身份制造了236个POSITION伪冲突。

## BP118：唯一严格证书ACTIVE

ACTIVE包装器只允许“本帧新完成的严格局部支配”覆盖，并在发出动作前重新经过Hard和FinalActionGate。
固定16场景、32局结果：

| 指标 | CURRENT | ACTIVE | 变化 |
|---|---:|---:|---:|
| 胜 / 负 / 平 | 2 / 28 / 2 | 2 / 27 / 3 | 0 / −1 / +1 |
| 分析得分 | 9.38% | 10.94% | +1.56pp |
| 星差 | −40 | −40 | 0 |
| candidate crash | 13 | 12 | −1 |
| FIRE | 151 | 156 | +5 |

唯一转换发生在`mat_I2Z8t6EspmMENRW5H`、candidate seat 1：第48帧ATTACK目标下，当前GO的
局部值为−50，FIRE为5,750，搜索62节点并严格支配。CURRENT在第83帧单方崩溃；ACTIVE存活到
第128帧并以同星计平局。证书1、覆盖1、FinalGate拒绝0、负转换0；Hard、Risk domination、restore、
timeout和热分配均为0。

## 保留与停止

保留语义目标身份、POSITION alias、严格Option域和稀疏局部Minimax。ACTIVE包装器继续默认关闭：
1张证书只证明方向和一条因果链，`+1.56pp`没有达到`+3pp`动作所有者门。

下一步不能扩大全局搜索或把3个反驳候选强行启用。应改善上游语义ATTACK target/Option生成，让
“接敌、占位、开火”共享同一目标，并继续由当前局部interval证书逐根决定是否取得动作所有权。

机器摘要：
`config/engine-v3/base-policy-kernel-bp117-bp118-semantic-objective-evidence.json`。
