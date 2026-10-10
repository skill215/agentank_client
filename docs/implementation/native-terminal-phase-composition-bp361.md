# BP361 — 独立模拟器阶段组合与隐藏敌弹单调性

## 结论

在固定本地模拟器的限定规则域内，六个领先根的开火条件已经可以用阶段性推导解释，而不只是“多跑一些样本没输”。本轮没有赋予 production、Hard 或 ForcedWin 新权限。

7 个历史根、55 个完整敌方动作/chance 响应：

| 条件 | 分支数 | 根数 |
|---|---:|---:|
| 行动后仍领先，新发子弹在无遮挡两步射线上命中 | 45 | 6 |
| 行动后星差不为正，拒绝组合 | 10 | 1 |

所有 45 个支持分支在实际模拟器中都产生我方胜利。六个根的 NONE 分支也通过，覆盖“未知敌弹存在时敌方 FIRE 被抑制”的响应映射。7 场自然续局双方动作流、参数和事件计数与冻结 BP349 完全相同；错误、超时、状态恢复失败、见证假阳性均为 0。

Minimax core UT：415/415。不是新全量竞技成绩，也不是胜率提升声明。

## 本轮实现

- `tools/agentank/diagnostics/simulator-terminal-phase-witness.js`：直接读取模拟器行动后、弹丸推进前的状态，不依赖 FastKernel 的终局评分。
- `tools/agentank/diagnostics/terminal-phase-composition-audit.js`：重建冻结根，遍历 NONE/GO/LEFT/RIGHT/FIRE/BOMB/STUN 及 stun chance，在真实阶段边界采集见证，并比对真实结算。
- `test/minimax-core/terminal-phase-composition.test.js`：4 个测试，覆盖新旧弹、障碍、盾、炸弹、提前终局、躲闪与拿星抹平领先优势。
- 证据：`artifacts/native-causal-audit/bp361-terminal-phase-composition/`，仅 manifest、overview 与压缩分支摘要。

运行：

```sh
node tools/agentank/diagnostics/terminal-phase-composition-audit.js <不存在的新目录>
node --test --test-isolation=none test/minimax-core/*.test.js
```

## 条件化推导，不是有限穷举替代证明

前提：除额外敌方弹丸以外，地图、双方 pose、星、效果、开火资格及炸弹事实均正确；双方 stun；本轮入口无活动炸弹或域外效果；我方 FIRE 被允许且没有我方旧弹阻止发射。额外敌弹可以有多个，不能据此假设固定实体池一定有容量。

1. **行动阶段不依赖敌弹的空间位置。** 普通移动只检查地图和坦克，不检查弹丸；FIRE 只按所属方检查已有弹丸。因此额外敌弹不阻止我方 FIRE，也不改变 GO/turn/STUN/BOMB 的物理行动结果。敌方 FIRE 可能变成不发射，与已经覆盖的 NONE 行动结果对应。这里不包括 teleport/boost 等域外技能。
2. **必须区分提前终局。** 模拟器行动过程中若坦克碰撞终局，会跳过弹丸推进。此分支必须独立检查敌方已毁、实际 winner 与正星差，不能借用尚未执行的命中见证。本轮 55 个分支均进入弹丸阶段，提前终局接口仅由反例测试约束。
3. **清晰射线对额外敌弹具有单调性。** 对已发出的我方新弹，额外敌弹不会抵消它，也不移动坦克、不创建墙/土/盾。敌弹可以毁土，但不会把已清晰的射线变成障碍。若敌人先被其他弹丸击毁，目标已达成；否则我方新弹沿已检查射线命中。若我方先被毁，本地模拟器仍处理我方已经发出的弹丸。
4. **结算在完整弹丸阶段后。** 本地 `moveBullets` 用延迟结算处理击毁，不在我方先死时提前停止剩余弹丸。故敌方必毁；我方可能存活或同毁。只要行动后星差严格为正，两种结果都赢。弹丸阶段不改变星数；敌方死亡后不存在再拿星抹平领先的问题。
5. **不能用根星差代替行动后星差。** 新测试让敌方 GO 拿星，根领先 1 变为同星，该分支必须拒绝。另一个测试让敌方横向离开射线，也必须拒绝。

这证明的是给定前提和固定规则语义下的单调关系。分支执行检查行动后见证，源码审查给出对任意额外敌弹的扩展理由；45 个样本本身不构成无限隐藏世界的穷举。

## 审查规则位置

固定 vendor `agentank-simulator-1ef804eb2c187138c4c8e5229fb37cd0126beddf`：

- `src/engine.js`：`step` 的炸弹/行动/碰撞/弹丸阶段；`applyPlayerAction` 的 owner-local FIRE；`canTankMoveTo` 不依赖弹丸；`moveBullets` 的无弹丸互消和延迟结算；`resolveCrashResult` 的同毁星数结算。
- `src/constants.js`：`BULLET_STEPS_PER_FRAME = 2`。
- `src/bot-runner.js`：stun 技能宿主的可输出动作；`back` 是 stun 对 GO 的内部反转，不是漏掉的独立 API 动作。

## 仍未关闭的上线边界

**适配器只有 gap 8192，不等于已证明其余事实完整。** 还需要确认能力完整性是独立字段还是包含在 gap mask、隐藏炸弹是否能被遗漏、可见 pose/星/技能是否严格绑定同一个根，以及 FastKernel 和平台行动阶段是否一致。当前检查器读取的是本地模拟器真值，不能用这些真值替代 production 能获得的观察。

因此结果保持 `PINNED_SIMULATOR_CONDITIONAL_LEMMA`，`strictProof=false`、`productionAdoption=false`。下一步应做一次“观察字段 → 入口前提”的来源审计，列出缺失字段并失败关闭；不继续扩大随机弹丸压力测试，也不直接清除 information gap。

production tree SHA-256 未变：`285f9863227d6af3638bed74e008f0260fd25440034d95eec5e3f8cac44d9120`。
