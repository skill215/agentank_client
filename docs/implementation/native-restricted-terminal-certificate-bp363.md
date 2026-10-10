# BP363 — 单帧 stun 终局条件组合入口

## 验收结果

7 个冻结根重新运行，6 个领先根返回 `SUPPORTED_LOCAL_CERTIFICATE`，同星根返回 `BLOCKED`。支持根覆盖 45 个完整响应；同星根的 10 个响应仍被拒绝。7 个根预算设为 0 时全部拒绝。

双方自然动作流、参数、事件计数零漂移；错误、超时、root restore failure 均为 0。Minimax core UT：424/424。production tree 保持 `285f9863227d6af3638bed74e008f0260fd25440034d95eec5e3f8cac44d9120`。

证据：`artifacts/native-causal-audit/bp363-restricted-terminal-certificate/`，约 20 KiB。旧报告未覆盖。

## 接口与权限

新增 `tools/agentank/diagnostics/restricted-terminal-certificate.js`：

```js
evaluateRestrictedTerminal(engine, context, budget = 64)
```

接口现场计算观察边界和物理响应，不加载旧报告冒充证据；绑定 frame/hashLo/hashHi/FIRE，并校验求值后根未漂移。结果只给本地受控 POC 使用，不设置 general strictProof、不改 Hard/Risk、不清除 gap 8192、不自动覆盖动作。

内部 `foldRestricted` 导出仅用于故障注入 UT，不是接收外部序列化“证书”的信任入口。

## 合取条件

1. BP360 窄域开火入口通过。
2. BP362 观察边界通过，包括双方明确 bombActive=false 和独立能力完整性。
3. 当前根可见、双方 stun、FIRE 已生成且 Hard 允许。
4. 只允许 gap 0 或 8192；不因 tracker 为空假设无隐藏敌弹。
5. 依据当前 stun 状态独立计算完整响应分母：7 或 10。逐个检查动作、chance、唯一性；不能仅相信报告声称 seen=expected。
6. 冷却中的 stun 只能按已审核规则归一为 NONE，其他动作不许任意改写。
7. 每个分支必须实际 APPLIED_TERMINAL、WIN、敌方已毁，并有 `FRESH_SHOT_CLEAR_HIT` 见证（其中已包含行动后正星差）。
8. NONE 分支也必须支持，以覆盖未知敌弹抑制敌方 FIRE 的情况。

行动阶段提前终局暂不进入该入口，即使终局分数为胜。它不是本次六个根的必要条件，不能用未核实的阶段等价扩大证书域。

## 新增故障测试

4 个 UT 组覆盖：7/10 完整响应、同星/非胜、预算或响应截断、提前终局、实体容量不完整、隐藏炸弹、其他 gap、Hard 拒绝、技能域外、旧 frame/hash、重复响应、缺少 stun chance 和错误归一化。均为拒绝默认。

该检查器使用克隆状态、集合和报告对象；属于开发诊断，不是零分配 production 实现。本轮 diagnosticMicros 混有多次求值及审计，不能作为上线性能标定。

## 下一步

具备执行受控 ACTIVE POC 的前置条件：仅在同一个实时根重新求值通过后覆盖为 FIRE；保留同星拒绝对照，检查实际发射、终局和非目标帧动作一致性。首先验证这六个已知失败的因果恢复，不宣称它们代表独立胜率提升，也不扩大到全局 Risk 放宽。

未执行官方 simulate、publish、challenge，未修改 production 默认语义。
