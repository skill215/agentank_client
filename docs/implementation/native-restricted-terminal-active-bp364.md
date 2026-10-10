# BP364 — 受限终局证书 ACTIVE 因果 POC

## 结果

7 个冻结历史目标根，现场重新求值证书；6 个通过并覆盖 FIRE，全部在目标帧终局。1 个同星根拒绝，保持原动作与完整对局结果。

| 结果转移 | 局数 |
|---|---:|
| V1_WIN → V2_WIN | 6 |
| V1_WIN → V1_WIN（同星拒绝对照） | 1 |
| WIN → LOSS | 0（本组原本没有胜局） |

六个转胜均为 `MUTUAL_CRASH_STARS`：双方同毁，我方 1 星、对手 0 星。不依赖耗时获胜，也不是新增六场单方击毁胜利。原动作是 TURN_LEFT/RIGHT，覆盖为 FIRE；已检查实际新增一颗我方弹丸。

目标帧前双方完整动作前缀一致；对手目标帧动作一致；所有参数一致。同星对照完整动作流与事件计数一致。错误、超时、root restore failure 为 0。UT 426/426。

## 因果含义

这验证了一个具体缺陷：在可确认以同毁获胜的局面，原选择没有利用开火结束比赛的机会。修复来自终局胜负语义，而非降低一般风险阈值或提高全局 FIRE 分数。

这是预选失败样本，不能把 6/7 写成全局胜率，不能声称独立显著性，也没有验证原本获胜的局面是否退化。它不证明所有导航或 Risk 问题都来自同一原因。

## 执行接口

新增 `tools/agentank/diagnostics/restricted-terminal-active-poc.js`：

```sh
node tools/agentank/diagnostics/restricted-terminal-active-poc.js <不存在的新目录>
```

只在冻结目标的 frame 上、调用原 `emit` 之前运行 `evaluateRestrictedTerminal`。证书绑定实时根 hash/frame，再检查 FIRE 行、Hard ALLOW 和原 FinalActionGate。通过后更新选中行/intent，并调用原 emit，因此沿用实际发射与 pending 实体记录路径。其余帧完全沿用 NAVIGATION_FAMILY 实验基线；所有包装在 finally 恢复。

目标 ID/frame 只用于实验定位，不存在 production 特判。没有把旧报告的支持状态直接当作覆盖指令。

## 证据与限制

目录：`artifacts/native-causal-audit/bp364-restricted-terminal-active/`，约 16 KiB，包含 manifest、overview、matches.ndjson.gz；不保存完整 replay。

manifest 绑定生产树、候选与证书依赖、输入摘要。production SHA-256 保持 `285f9863227d6af3638bed74e008f0260fd25440034d95eec5e3f8cac44d9120`。未改变 production 默认，未调用平台 simulate/publish/challenge。

诊断证书当前使用克隆/集合/对象分配，不具备生产热路径性能资格。当前仅能说定点恢复成立。

## 下一步

移除实验的目标帧定位限制，先在一个预先固定且包含原胜局的开发 cohort 上审计全帧触发覆盖率与成本，再进行同 cohort 的开/关配对对战。必须同时报告 LOSS→WIN、WIN→LOSS、同毁星数胜、单方击毁及新增计算开销；不能只继续筛选可改善的失败根。达到无退化及预算条件后再考虑原生零分配实现与独立验证。
