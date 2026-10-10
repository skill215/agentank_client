# BasePolicyKernel BP6：stun 窗口 FIRE 漏斗

## 结论

BP6 不修改 FIRE 动作域或评分，BP5 enemy-disabled-only 继续作为诊断基线。

BP5 的绝对 FIRE 从 231 降到 186，不能直接解释为“Minimax 压低了攻击分”。
BP6 在 202 个新接入的远距离 stun 搜索根上逐层记录 FIRE，结果表明 FIRE 在
进入数值比较之前已经由 V1-shaped source domain 排除。

## 逐层结果

| 层 | 根数 |
|---|---:|
| enemy-disabled 扩展根 | 202 |
| committed 跳过 | 1 |
| 完整搜索 | 201 |
| FIRE 候选存在 | 201 |
| Hard 阻断 | 0 |
| source domain 阻断 | **201** |
| V2 owner domain 阻断 | 0 |
| Intent 阻断 | 0 |
| FIRE 进入 Minimax 排名 | 0 |
| FIRE 最终选择 | 0 |

这些根不是因为已有己方弹丸或 fire lock 不能开火：两项都为 0。删除来源是
BP3 为复现 V1 `tacticalActions` 而实现的 `fireUtility > threshold` 根动作域。

## 是否应该扩展 FIRE 域

对被 source domain 排除的 FIRE，继续读取已经计算好的 `CombatVector`：

| 证据 | 根数 |
|---|---:|
| direct kill | 0 |
| possible hit | 0 |
| intercept | 0 |
| aim setup | 0 |
| purpose completeness ≥ 4500 | 0 |
| post-fire escape | 201 |
| verified opportunity | **0** |

“开枪后能逃”只说明动作不会立即自杀，不说明子弹有战术目的。若仅因 post-fire
escape 就把 FIRE 加回根域，会重现此前“无目的多开火”的错误，而且会增大每个
stun 根的矩阵宽度。因此本轮没有运行 ACTIVE 扩域，也没有调 FIRE 分数。

## FIRE 总量的正确解释

BP4 的双方决策数为 2,907，BP5 为 2,736；新策略改变了轨迹并让部分战斗更早
结束。相同 BP5 轨迹中，V2 开火 186 次、V1 开火 172 次，V2 仍多 14 次；BP4
则是 231 对 219，多 12 次。绝对 FIRE 下降不能单独归因于攻击偏好下降。

后续攻击优化应寻找以下集合，而不是修改 stun 窗口：

```text
FIRE 已进入根域
∩ Hard/Risk/EO 允许
∩ CombatVector 有明确目的
∩ Minimax 排名低于非攻击动作
```

只有这个集合能回答“搜索的攻击价值是不是错了”。

结构化证据见
`config/engine-v3/base-policy-kernel-bp6-evidence.json`。
