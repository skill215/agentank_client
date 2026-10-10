# BP362 — 终局证明的观察来源边界

## 结果

7 个冻结根均通过观察边界检查：能力完整性为 1、原因位为 0；双方明确报告 `bombActive=false`；可见炸弹为空；frame、地图、pose、星数、技能冷却与适配后的 FastState 一致。全部保持 gap 8192，不清除缺口，不把 `informationComplete` 改成 true。

与 BP361 组合后，仍是 6 个领先根满足条件化获胜关系；同星根不能获胜认证。55 个物理分支结果未变化，双方完整自然动作流、参数、事件计数零差异；错误、超时、restore 均为 0。

Minimax core：420/420。production tree 不变：`285f9863227d6af3638bed74e008f0260fd25440034d95eec5e3f8cac44d9120`。

## 真实漏检与反例

`ProductionObservationAdapter.setTank` 检查 `status.bombActive` 是布尔值，但并不将“bombActive=true 且未追踪到炸弹”自动转换成信息缺口。`copyTrackedEntities` 只能复制已知炸弹。固定模拟器的 `visibleBombsFor` 不返回敌方草中炸弹，而 `agentSnapshot.status.bombActive` 根据所属方所有未爆炸炸弹计算，不受可见性限制。

新增可重复 UT 建立敌方草中炸弹：

- `game.bombs=[]`；
- `enemy.status.bombActive=true`；
- adapter `informationGapMask=0`；
- BP360 旧入口返回 `CONDITIONAL_ENTRY_SUPPORTED`；
- 新边界返回 `BLOCKED / BOMB_ABSENCE_UNPROVED_1`。

所以“只有弹丸 gap”不能单独证明其他物理事实完整。这里确认的是证明入口的漏检风险，并未证明它导致了六个目标根的失败；六个根双方 bombActive 都明确为 false。本轮不修改全局 adapter 或 Hard 行为。

## 新边界检查

`tools/agentank/diagnostics/terminal-observation-boundary.js` 只消费原始 callback context 与适配器，不读取 simulator 隐藏状态：

| 前提 | 观察来源及检查 |
|---|---|
| 无炸弹 | 双方 bombActive 必须严格等于 false；可见列表为空；还需 BP360 排除已追踪炸弹 |
| 能力支持 | 独立的 enemyCapabilitySupportComplete=1、reason=0；不能用 gap mask 替代 |
| 当前可行动 | 双方 canActThisFrame=true、actionSpeed=1、fireLocked=false |
| 同一个根 | game.frames 与 FastState frame 相同；双方 pose、星、skill cooldown 逐项一致 |
| 地图与星 | 完整地图逐格一致，star 坐标或 null 一致 |
| 限定技能域 | 双方 stun，self effect 为 null，debuff 只允许 null/stun；其余效果继续由 BP360/gap 阻断 |
| 我方弹丸 | 原始 me.bullet 必须 null 或空数组；结合 BP360 检查己方已追踪弹丸 |
| 未知支持 | tracker complete 必须为 1；gap 只允许 0/8192，但不据此提升 strictProof |

所有检查只用于诊断，允许分配报告对象；没有引入 production 热路径开销。边界检查不是独立充分证书，必须与入口、完整响应域及 BP361 阶段见证组合。

## 测试与证据

新增 5 个 UT：真实快照只读检查、隐藏炸弹反例、独立能力位、缺失 bombActive 与根值漂移、缺失弹丸/effects 字段。全量 minimax core 420/420。

不可变结果目录：`artifacts/native-causal-audit/bp362-observation-boundary/`。manifest 绑定新检查器源码；overview 包含每根观察边界结果；压缩样本保留 55 个响应分支。旧 BP360/BP361 artifact 未覆盖。

执行命令：

```sh
node tools/agentank/diagnostics/terminal-evidence-shadow-run.js <新目录> --normalize-cooldown --inspect-ballistics
node --test --test-isolation=none test/minimax-core/*.test.js
```

## 下一步边界

物理阶段关系和观察来源已有明确限定，不再通过增加随机弹丸样本推进。下一步将这些检查组合成一个拒绝默认的、仅适用于 stun/正星差/单帧终局的诊断证书入口，先验证六个根可通过、同星/隐藏炸弹/技能域外/支持中断必拒绝，再进行受控动作覆盖 POC。不能直接把本轮报告当作 general ForcedWin 证书，也不能清空全局 Risk 或信息缺口。

未执行官方 simulate、publish、challenge；未改变 production 动作或做全量竞技胜率声明。
