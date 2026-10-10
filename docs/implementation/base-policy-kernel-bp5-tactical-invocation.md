# BasePolicyKernel BP5：战术搜索调用域修复

## 结论

BP5 接受 `enemy disabled only` 作为新的诊断基线，production 默认仍保持关闭。

这一步证明，BP3 的一个大方向问题不是 Minimax 本身太弱，而是它在对手已经被
stun、最适合进行战术计算的窗口里被控制模式错误地归入了战略导航。只补回这个
调用域，固定 16 场景就从 48.44% 提升到 53.13%。

## 为什么不能使用“敌人可见就搜索”

最初的 broad-visible POC 虽然消除了非接触漏搜，但把大量 V1 原本由
navigation、preemptive safety 或 stability 处理的根也送入了 Minimax：

| 调用域 | 搜索根 | 节点 | V2-only 根 | V1-only 根 |
|---|---:|---:|---:|---:|
| BP3 control | 1,448 | 266,617 | 144 | 621 |
| broad visible | 2,206 | 393,429 | 543 | 427 |

因此“敌人可见”不是战术搜索证据，只是信息可用条件。它会让 Minimax 重新吞掉
战略层所有权，也直接破坏此前完成的性能收敛。

## 三个触发位的 Shadow 消融

BP5 复用 `ControlModeRouter` 现有的零分配触发位，分别测试 stun、真实炸弹和
verified predictive attack。数组中的 `NON_CONTACT` 是真正漏掉的 V1 战术根，
`COMMITTED` 属于 BP4 已经证明不能直接授权的另一问题。

| 触发位 | V1-only NON_CONTACT | V2-only | 搜索根 | 节点 |
|---|---:|---:|---:|---:|
| 无扩展 | 214 | 144 | 1,448 | 266,617 |
| enemy disabled | 16 | 169 | 1,852 | 347,043 |
| committed bomb | 207 | 147 | 1,608 | 299,270 |
| predictive attack | 205 | 150 | 1,613 | 300,049 |
| 三者全部 | 8 | 172 | 1,843 | 346,240 |

主要缺口明确来自 stun，而不是预测射击。三者全开虽然把漏根再从 16 降到 8，
但是否应该拥有动作必须由 ACTIVE 整局结果决定。

## 固定 16 场景 ACTIVE

| 模式 | 胜/负/平 | 得分 | 我方被击毁 | FIRE | 搜索根 | 节点 |
|---|---:|---:|---:|---:|---:|---:|
| BP3 control | 15/16/1 | 48.44% | 14 | 231 | 1,448 | 266,617 |
| enemy disabled only | 16/14/2 | **53.13%** | **11** | 186 | 1,538 | 290,322 |
| all triggers | 14/16/2 | 46.88% | 12 | 183 | 1,549 | 292,276 |

enemy-disabled 相对 BP3 的逐局转换为：

- `V1_WIN → V2_WIN` 3 局；
- `V2_WIN → V1_WIN` 1 局；
- `V1_WIN → DRAW` 1 局；
- `V2_WIN → DRAW` 1 局；
- `DRAW → V1_WIN` 1 局；
- 13 个 V2 胜和 12 个 V1 胜保持不变。

得分净增 4.69 个百分点，星数不变，我方被击毁减少 3 次。搜索节点增加
8.89%，预算叶增加 12.77%，仍是一个有界扩展，而不是 broad-visible 的全局扩张。
Hard、Risk domination、root restore、timeout/error 和热分配不变量全部为 0。

## 架构判断

正确组合不是“只要可见就让 Minimax 接管”，而是：

```text
战略/安全早期所有者
→ 精确战术事件触发
→ policy-local Minimax
→ 原有最终门
```

stun 是离散、已提交、低歧义的战术事件，能合理扩大搜索调用域。炸弹属于
committed escape 所有权，预测命中属于软攻击证据；把后两者也直接解释成
Minimax 调用/动作所有权会产生负交互，本轮拒绝。

本轮 FIRE 从 231 降到 186，说明胜率改善来自少死和更合适的战术窗口，不代表
攻击能力已经解决。下一步应在已接受的 stun-only 调用域内审计 FIRE 候选为何被
Minimax 压低，分离“搜索何时运行”和“搜索如何评价攻击”两个问题。

复现命令：

```bash
bash tools/base-policy-kernel-bp5.sh oracle /tmp/bp5-stun-shadow 1
bash tools/base-policy-kernel-bp5.sh native /tmp/bp5-stun-active 1
bash tools/base-policy-kernel-bp5.sh native /tmp/bp5-all-active 7
```

结构化证据见
`config/engine-v3/base-policy-kernel-bp5-evidence.json`。
