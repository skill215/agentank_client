# BP115–BP116：局部Minimax闭合，错误在POSITION目标身份

## 结论

把ObjectiveEpoch降为目标服务后，固定16场景发现309个“当前动作离开目标，但支持完整的同目标Option
仍存在”的根。其中70个当前动作是已验证攻击，必须让行；剩余239个根没有一次获得production现有
完整Minimax值。

为这239个根单独调度两Option、全敌方列、depth2、256节点的局部Minimax后，232个完整；230个目标
Option严格更差，0个相等，只有2个严格更优。问题不是Minimax性能或完整率，而是ObjectiveEpoch继承
了错误的目标身份：几乎全部冲突来自POSITION，它是执行姿态，不是长期战略目标。

全部路径为Shadow，动作、胜负、星、击毁、FIRE均零变化；production hash不变。

## BP115：只在既有严格Option中仲裁

Strict Option arbiter禁止生成新primitive，只读取：

```text
supportComplete
∩ Hard ALLOW
∩ Risk acceptable
∩ non-dominated
∩ same ObjectiveEpoch generation
```

3,030个决策的漏斗：

- inactive 75、committed/resource/terminal中断332；
- 没有严格Option 967；
- 当前已在目标Option内1,347；
- 当前离开目标309，其中70为支持完整的已验证攻击并正确让行；
- 剩余239个目标候选：TURN_LEFT 203、TURN_RIGHT 33、FIRE 3；
- 239/239没有可比较的production完整搜索值。

这说明全局Minimax调度没有覆盖稀疏的战略冲突根，但还不能证明目标候选值得执行。

## BP116：稀疏两Option Minimax

只在上述239根运行局部比较：incumbent与目标Option各一行，敌方根动作列完整保留，深度2、节点上限
256；HiddenWorld非单一物理支持、fallback、预算不完整或restore失败全部fail closed。

结果：

| 项目 | 数量 |
|---|---:|
| 请求 / 真正触发 | 239 / 236 |
| 完整 / 不完整 | 232 / 4 |
| support/runtime跳过 | 1 / 2 |
| 目标Option更差 | 230 |
| 相等 | 0 |
| 目标Option严格支配 | 2 |
| 总节点 / 平均每触发 / 最大 | 18,115 / 77 / 256 |
| root restore / 热分配 | 0 / 0 |

按目标类型：

- ATTACK：3次完整，3次更差；
- STAR_CONTROL：没有冲突；
- POSITION：236次请求，229次完整，227次更差、2次严格支配、4次不完整、3次跳过。

局部搜索完整率98.3%，所以不能把230个反驳解释成“搜索太浅或太早fallback”。相反，持久化POSITION
会让错误方向更稳定，这与BP114 H4独立切片退化一致。

## 身份模型修正

旧身份：

```text
Option kind + ledger generation
```

这会把同一个敌方目标下的`ATTACK_SETUP → POSITION → FIRE`误判成三个目标，把POSITION的短期姿态
变化升级成战略承诺。

新Shadow应使用：

```text
semantic target class + target signature + target generation
```

- ENEMY目标可由DIRECT_KILL、ATTACK_SETUP和指向同一敌人的POSITION共同执行；
- STAR目标可由STAR_CONTROL和指向同一颗星的POSITION共同执行；
- POSITION不再产生独立epoch；
- primitive变化只改变executor，不改变目标；
- Resource、Terminal、Committed rescue仍可中断目标但不能篡改身份。

Minimax只在同一semantic target的Option冲突根内按需运行。BP116证明这种调度性能可控，但2个严格
支配根仍只有Shadow证据，不能直接ACTIVE。

机器摘要：
`config/engine-v3/base-policy-kernel-bp115-bp116-option-arbitration-evidence.json`。
