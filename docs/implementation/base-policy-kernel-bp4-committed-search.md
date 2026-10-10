# BasePolicyKernel BP4：committed danger 内的受限搜索

## 结论

BP4 的 ACTIVE 所有权被拒绝，BP3 继续作为当前最佳基线。

这一步验证了一个重要区别：真实炸弹或已提交弹丸存在时，继续计算
Minimax 在结构上是允许的；但是 `ReverseViability.member[row]` 只证明第一步
仍可活，不能证明当前短深度 Minimax 有权替换已经选出的逃生续链。

## 实现边界

诊断模式 `--bounded-policy-committed-search viable` 做了以下工作：

- 严格 Proof、严格救援和直接击毁证书仍先于该模式；
- EO 必须为 `COMPLETE`，否则完整回退；
- 根动作复用 EO 的固定 `member` TypedArray，不构造临时动作列表；
- 只有 `PROVEN_VIABLE` 根动作可进入选择；
- 深层仍使用 BP3 的 V1-shaped policy-local Minimax；
- production 默认保持 `off`，production root 字节未改变。

## 固定 16 场景 A/B

| 模式 | 胜/负/平 | 得分 | FIRE | 搜索根调用 | 节点 |
|---|---:|---:|---:|---:|---:|
| BP3 control | 15/16/1 | 48.44% | 231 | 1,448 | 266,617 |
| committed viable ACTIVE | 12/20/0 | 37.50% | 212 | 1,780 | 326,581 |
| stage-prefix + committed | 10/19/3 | 35.94% | 232 | 1,839 | 336,531 |

调用覆盖确实得到修复：control 中 V1 搜索而 V2 因 committed 跳过的根为
406；ACTIVE 后该桶归零，只留下 14 个 EO 不完整或其他 fail-closed 根。
实际 committed 根共 383 个，其中 368 个完整、15 个不完整，选出非 EO
成员的次数为 0。

但整局因果结果明确为负：

- `V1_WIN → V2_WIN`：6；
- `V2_WIN → V1_WIN`：9；
- `DRAW → V1_WIN`：1；
- 净得分下降 10.94 个百分点；
- 搜索节点增加 22.49%，FIRE 减少 19 次。

全部 Hard、Risk domination、root restore、timeout/error 和热分配不变量仍为
0。这说明退化不是物理安全越界，而是动作所有权证据不足。

## 架构判断

`EO membership → Minimax 最大值` 不是正确的 committed 所有权合同。后续若要
在危险链内使用 Minimax，应作为证据服务或严格比较器：保留当前逃生动作，
只有完整搜索证明候选在全部敌方响应上不劣，并且对续逃 deadline/slack 有严格
改善时才允许替换。不能再用“第一步可活”直接授权。

复现命令：

```bash
bash tools/base-policy-kernel-bp3.sh native /tmp/bp4-control
bash tools/base-policy-kernel-bp4.sh native /tmp/bp4-committed
```

结构化证据见
`config/engine-v3/base-policy-kernel-bp4-evidence.json`。
