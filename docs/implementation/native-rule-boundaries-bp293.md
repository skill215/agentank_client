# BP293：完整层支持不足的真实边界

## 结果

在BP292相同18根、54次运行中加入原因和有限见证采集。动作、结果、工作量及提交行值与BP292逐项一致，诊断漂移0。没有修改production物理规则、Hard、搜索预算或默认策略。

正序样本的4个支持不足根：

| 根 | 深度 | 次数 | 原因 |
| --- | ---: | ---: | --- |
| 47l3，seat1，root75 | 2 | 2 | GO/GO，stun/chance影响下腾空不被plain GO证据覆盖 |
| EqI2，seat1，root88 | 3 | 1 | GO/GO，后移动者目标已被先移动者占据 |
| DQoo，seat0，root59 | 2 | 3 | GO/GO，后移动者目标已被先移动者占据 |
| 38Xn，seat1，root32 | 3 | 2 | Hard reverseViable=-1，narrowProofComplete=0 |

前三类FAST_STATUS均为UNSUPPORTED_RULE，failureReason均为JOINT_TANK_RELOCATION；细节分别为VACATE_NOT_STRICTLY_SUPPORTED和OCCUPIED_AFTER_EARLIER_MOVE。

最后一类：hazardComplete=1、horizon=4、maxTicks=20。不是容量不够，也不是危险截止期超界；源码中敌弹遇土堆会将narrowProofComplete置0。当简化格点模型没找到可活路径时，此时返回UNKNOWN而非死亡，属于正确保守边界。

## 与已有证据的关系

这不是新发现的底层回归。旧文档`base-policy-kernel-bp132-depth3-transition-support.md`已经记录联合移动和土堆后的窄证明未知。
`joint-vacated-follow-and-rule-variant-poc.md`只用官方历史闭合了普通GO、无复杂effect、非swap的确定腾空跟随；同目标、swap和复杂effect仍未证明。旧三世界POC还显示支持闭合不自动产生动作收益。

因此不能为减少INCOMPLETE而直接采用本地模拟器某一种同目标规则，更不能把未知改为Hard死亡或安全。若未来扩展这些规则，应先增加对应官方事件证据和reference oracle。

## UT

新增`test/minimax-core/search-rule-boundaries.test.js`：

1. 从当前见证提炼的同目标GO/GO仍显式unsupported，并恢复全部物理数组/hash。
2. stun影响的腾空不冒充已确认的普通GO跟随。
3. 敌弹遇土堆导致窄证明不完整：负可活结果保持-1；正可活见证仍返回1。

三个规则UT和七个完整层调度UT，10/10通过。它们约束当前未知边界，不证明平台真实碰撞语义。

## 决策

本轮不修物理生产代码，因为尚无证据证明这些保守出口错误；禁止以降低INCOMPLETE计数为验收目标。

后续性能工作应优先减少已支持分支的重复转换和无效加深，不通过删掉不确定敌方动作、放宽Hard或无限加预算伪造完整性。完整层失败原因已可分别归为预算不足、规则未知、窄证明未知。

同时，depth2/3的胜局退化仍需独立分析评估函数和对手备份目标，不能期待修物理边界必然解决胜率问题。

证据：`artifacts/native-causal-audit/bp293-rule-failure-witnesses.json`，311816字节；每层最多8个见证，没有保存完整replay。
