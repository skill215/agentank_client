# BP140-Q1：拒绝暴露已进入局部价值，但单一攻击策略只够做负向验证

BP140-Q1没有改变production。它在BP139的固定重规划攻击策略上，将“必须最终FIRE”的布尔Proof改为
有限horizon字典序向量。维度依次为terminal、committed安全、已结算攻击、反击安全、射线控制、敌方
机动压缩、接触距离、星差、星路径和资源差。维度先分开计算，只用固定mixed-radix打包执行整数比较；
任何低位最大值都不能跨越高位边界，因此它不是可调权重分数。

每个根仍保留完整enemy action、ChanceOutcome和三种移动规则世界。我方深层动作使用BP139的单一确定性
重规划策略。局部正证书要求三世界中candidate的最坏值都更高，并且相同根enemy列逐项支配；只提高
最坏值但列间有正负交换的根明确标为tradeoff。

## 性能修复

首版向量搜索没有Proof的反例短路，715,852节点且24/35根不完整。两项语义中性优化依次加入：

1. 值0是terminal死亡的绝对下界，遇到0立即停止剩余min分支；节点降至464,618，不完整降至8根。
2. 使用固定容量`hashLo + hashHi + remainingDepth` TT，只缓存完整packed vector；10,594次命中后节点
   降至333,717，35/35根、105/105规则实例全部完整，单搜索最大3,265。

相对首版节点减少53.38%，root restore失败0、热路径分配0。没有提高4096预算，也没有缩减enemy或
chance域。

## 语义结果

- 25根局部相等；
- 8根最坏值有方向但同列存在tradeoff；
- 2根为`LOCAL_ROBUST_INCUMBENT`，都证明candidate存在绝对死亡分支而原动作可活；
- `LOCAL_ROBUST_CANDIDATE=0`；
- incomplete和规则世界分歧均为0。

因此Q1成功解决“敌方拒绝暴露也要结算局部代价”和向量搜索性能，但单一追击策略没有产生正向动作
证书。两条incumbent证书可保留为负向verifier，不能反向宣称Q1能生成更优动作。下一步不是扩大primitive
分支或加预算，而是测试少量持久命名策略组成的portfolio：每个策略保持确定性、单独求完整区间，再在
根上选择完整策略；这样把我方策略表达力从1提高到少数几个，同时避免每层primitive笛卡尔爆炸。

机器证据见`config/engine-v3/base-policy-kernel-bp140q1-refusal-interval-evidence.json`。
