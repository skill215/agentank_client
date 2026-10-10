# BP102–BP106：策略时域压缩与攻击所有权边界

## 结论

本轮把“让 Minimax 更深”与“让 Minimax 选择更正确”拆开。所有实现均为默认关闭的诊断路径，
production bundle、Hard、Proof、Risk、EO、Information depth 和发布行为没有改变。

固定16场景、32局、相同`intent-known` Risk、V1-shaped动作域、stun量词、叶值和128节点总预算：

| 深层我方时域 | 胜/负/平 | 得分 | 节点 | FIRE | 击毁 | 每万发击毁 |
|---|---:|---:|---:|---:|---:|---:|
| 当前混合截断、完整动作域 | 22/10/0 | 68.75% | 315,030 | 172 | 14 | 814 |
| 共同完整深度、完整动作域 | 16/14/2 | 53.13% | 220,158 | 168 | 9 | 536 |
| 固定BasePolicy | 16/15/1 | 51.56% | 240,010 | 153 | 13 | 850 |
| 固定Combat-first | 10/17/5 | 39.06% | 268,049 | 172 | 7 | 407 |
| 每层Base/Attack二选一 | 10/18/4 | 37.50% | 245,259 | 188 | 7 | 372 |
| 根绑定Base/Attack身份 | 13/16/3 | 45.31% | 247,849 | 167 | 7 | 419 |
| 根绑定、只允许直接FIRE | 16/15/1 | 51.56% | 240,010 | 153 | 13 | 850 |

主要证据如下：

1. 固定BasePolicy把深层我方分支压成1，仍有1,364个根完成P2–P4，候选本地总耗时比当前混合
   截断下降约24.2%。因此策略时域压缩是有效的性能架构，不是最终动作质量方案。
2. 固定Combat-first不能恢复攻击。它保持172次FIRE，却把击毁从13降到7，证明“攻击排在星前”
   不是一个可独立执行的策略合同。
3. 每个深层节点重新在Base/Attack之间二选一进一步降至37.50%。有限视界允许策略随层切换，
   产生不可持续的短期动作链；增加我方动作反而降低整局结果，是典型horizon pathology，而不是
   精确零和Minimax应有的单调性。
4. 根绑定策略身份恢复7.81个百分点，证明Option identity必须跨路径保持；但仍低于固定BasePolicy。
5. 只允许AttackPose的根建议为FIRE时绑定攻击策略，结果与固定BasePolicy逐项相同。3,359次
   GO/TURN类setup被过滤，只剩7个攻击根行，且没有改变最终行为。负收益来自未闭合
   `ATTACK_SETUP`，不是直接FIRE漏失。

## 叶值消融

在根绑定策略上进行了两个不调权重的因果消融：

- 总和截断改为逐分量截断：仍为13/16/3、45.31%，击毁仍为7；排除“总和饱和抹掉维度”是本批
  退化主因。
- 删除非终局attack分量：降为12/17/3、42.19%，碰撞/击毁由7升至15；attack信号整体有益，
  不能删除或统一降权。问题是通用scalar leaf不能为未闭合setup提供长期尾值。

## 架构决定

保留以下结构：

```text
root primitive domain保持完整
→ 深层BasePolicy可作为高性能共同默认续行
→ Option identity从根绑定并跨路径保持
→ DIRECT FIRE沿BasePolicy现有路径处理
→ ATTACK_SETUP默认Shadow，必须有多帧hit/kill/nonloss bootstrap才可取得身份
```

拒绝以下方向：

- 在每层重新组合策略；
- 固定Combat-first优先级；
- 用事件quiescence只延长FIRE/弹丸动作，形成动作相关视界；
- 删除attack分量或扫描其权重；
- 继续提高共同完整P2/P3预算并把更深等同于更正确。

下一步不是第三条策略，而是建立终局反事实价值语料：同一Physical root、同一Hard允许动作，固定
BasePolicy/V3响应后运行到终局，分别保留nonloss、击毁、星差和失败类型。它用于检验和蒸馏
horizon bootstrap；训练/校准与盲测场景必须分开。Runtime只消费最终冻结的整数小模型，不能在
callback内运行长rollout。

## 验证与复现

- 针对性UT：56/56通过；
- 新路径`hotAllocationCount=0`、`rootRestoreFailure=0`、timeout/error=0；
- `tools/base-policy-kernel-bp102.sh`统一复现current、iterative、quiescence和策略时域模式，并允许
  `BP_LEAF_CLAMP`、`BP_LEAF_ABLATION`做明确消融；
- 全部运行产物保存在`/tmp`，不进入Git。

机器摘要：
`config/engine-v3/base-policy-kernel-bp102-bp106-policy-horizon-evidence.json`。

