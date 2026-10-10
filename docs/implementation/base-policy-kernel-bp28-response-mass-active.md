# BasePolicyKernel BP28：逐根响应质量ACTIVE因果验证

## 结论

BP28只让BP27中的完整、不同首动作、AttackPose候选逐维严格支配根获得动作资格。权衡、不完整、
possible-hit和aggregate mass都不能接管。候选行必须已经通过原Hard/Risk集合，并在实际发射前再次
通过FinalActionGate。

固定16场景从BP27 Shadow的`16/14/2`、53.13%变为`18/14/0`、56.25%，净增3.12个百分点。
这证明响应质量结构产生了真实正向信号，但只相当于净增加1个等价胜场，尚不足以进入production。

## 因果结果

ACTIVE轨迹共评估558个配对根，其中470完整、88不完整；44个候选严格支配并全部实际覆盖：GO 12次、
TURN_LEFT 15次、TURN_RIGHT 17次。44个候选最终Hard复核全部通过。结果转换为3个`LOSS→WIN`、
1个`DRAW→WIN`、2个`WIN→LOSS`和1个`DRAW→LOSS`；其余11负局、14胜局不变。

正向不是“更多开火”本身：被接管的首步全部是GO/TURN，收益来自更可能进入攻击事件、减少中止/未决，
而不是直接提高FIRE分数。这符合长期Option的原始目标。

## 发现的Hard所有权缺陷

首轮ACTIVE出现1次`avoidableHardReject`。逐帧定位到`mat_EqI2gfxnpT68zisaY` frame 127：V2 production
选择唯一Hard允许的FIRE，但V3 host在FinalActionGate之后把它覆盖成已证明死亡的TURN_LEFT。该帧有
真实炸弹，BP28正确跳过，违规来自宿主总线没有统一末端Hard closure。

修复包含三部分：

1. 诊断Hard审计绑定精确候选row，不再按动作类型取最后一个重复行；
2. BP28候选在返回前复核自己的row；
3. 所有V3/native owner的最终提案在发射前统一复核，失败恢复production已经验证的动作。

最终1,403个host提案中1,398个通过、5个拒绝：1个恢复production动作，4个属于全动作Hard拒绝的
不可避免状态；缺少门或有安全行却无法恢复的失败为0。公开四项硬不变量全部归零。

## 决定

BP28通过已知Discovery，但不进入production。原因是样本只有32局、结果变化仅7局，且诊断成本很高。
下一步必须冻结当前源码和资格规则，在未用于调参的独立场景切片运行一次；若净转换不再为正，整个
ACTIVE owner退回Shadow。无论结果如何，都不能用独立切片继续调dominance阈值。

复现入口为`tools/base-policy-kernel-bp28.sh`，机器证据为
`config/engine-v3/base-policy-kernel-bp28-active-evidence.json`。

> 后续状态：BP29独立32场景的公平`GUARDED_SHADOW`对照中，ACTIVE下降7.81个百分点，已否决动作
> 所有权。BP28只保留为已知Discovery弱正向证据。
