# 当前状态

更新时间：2026-07-21（Asia/Shanghai）。

## 工作区

- 当前唯一工作区：`/home/skill/workspace/git/agentank_client`。
- Git 分支：`main`（HEAD `643ae1e9…`，提交说明 `draft`）。
- Remote：`git@github.com:skill215/agentank_client.git`。
- Node：`v24.16.0`。

## 结构修复基线 B0（已冻结）

语义修复开始前的锚点见
[structural-repair-baseline-b0.md](implementation/structural-repair-baseline-b0.md)：

| 项 | 值 |
|---|---|
| `workingSourceSha256`（B0） | `d2f0791de39267d6742a9c8e83dd70b441b25e7a631c98d51be3f265dbc9d892` |
| `npm run test:4`（B0） | 183/183 PASS |
| R21 Capsule 不变量 | 全部为 0 失败（19,136 根，证据未重跑） |
| `DOMINATED_RESCUE` / `NO_ACCEPTABLE_RESCUE` | 39 / 55 |
| production minified（现有产物） | 397,799 UTF-8 字节（超限；且相对工作源有 1 模块漂移） |

Production 压缩保持**独立流水线**，不与搜索语义改动共用验收指纹。

## 算法状态

V2 当前包括 Physical/Information 分离、committed/possible 弹丸、Safety/Hard/Proof、
多维风险、StageMatrix/Minimax、PersistentPlan + **EscapeObligation（Step 3a）**、Replay Capsule 等。

相对 B0 的语义改动：EscapeObligation + DeadlineKernel + Step 4–5 value-depth +
**短收敛 R22b** + **Step 6 ForcedWin→Info** + **projectile/bomb-aware Deadline** +
**CONTINUATION 清零 R23** + **短收敛 R23b** + **Escape Quality Phase0–4**。
当前工作源以 `sourceIdentity()` 为准；`npm run test:4` → **209/209 PASS**。

## Step 1–6 与 DeadlineKernel 进度

| Step | 状态 | 文档 |
|---|---|---|
| 1 死亡四类分桶 | 完成 | [death-category-probe-b0](implementation/death-category-probe-b0.md) |
| 2 事实层扫描 | 完成 | [fact-layer-scan-b0](implementation/fact-layer-scan-b0.md) |
| 3a EscapeObligation | 完成 | [escape-obligation-step3a](implementation/escape-obligation-step3a.md) |
| 3b value-depth 诊断 | 完成 | [value-depth-probe-b0](implementation/value-depth-probe-b0.md) |
| 3b 复访（残差+性能） | 完成 | [value-depth-residual-post-s5](implementation/value-depth-residual-post-s5.md) |
| 短收敛 R22b | 完成 | [value-depth-convergence-r22b](implementation/value-depth-convergence-r22b.md) |
| CONTINUATION 再探针（EO） | 完成 | [continuation-reprobe-post-eo](implementation/continuation-reprobe-post-eo.md)：0/8 |
| DeadlineKernel | 完成 | [deadline-kernel](implementation/deadline-kernel.md)：1/8 |
| Projectile Deadline | 完成 | [deadline-projectile-aware](implementation/deadline-projectile-aware.md)：3/8 |
| **CONTINUATION 清零** | **完成** | [continuation-cleared-r23](implementation/continuation-cleared-r23.md)：**8/8** |
| **短收敛 R23b** | **完成** | [short-convergence-r23b](implementation/short-convergence-r23b.md)：vs R22c S2D=0，主池 75→87 |
| **Escape Quality P0–4** | **完成** | [escape-quality-phases](implementation/escape-quality-phases.md)：Membership/Quality 拆分；部分 demote 退役 |
| 4 value-depth 比较语义 | 完成 | [value-depth-step4](implementation/value-depth-step4.md) |
| 5 Information 递归 | 完成 | [information-recursion-step5](implementation/information-recursion-step5.md) |
| 6 ForcedWin→Info | 完成 | [forced-win-information-step6](implementation/forced-win-information-step6.md) |

## 当前阻塞

1. **体积**：平台上限 204,800。

## 回归基线（已替换：742 场景）

2026-07-21 已 `sync-history` + V1/V2 working-arena + 全量 capture，**替换**本地回归证据
（不保留多份旧报告/run）。明细：[regression-refresh-742](implementation/regression-refresh-742.md)。

| 项 | 值 |
|---|---|
| History | **742** 场景 / **735** 地图（旧 598，**+144**） |
| Working-arena | 5936 场，V2 **1085** 胜 / 4851 负（≈**18.3%**） |
| 同局 vs IMP8 基线 | 1952 场：**731→368**（≈37.5%→18.9%，净 −363） |
| Capture run | `run-068b60d6…`：2968 场 / **23744** Capsule |
| Capsule-all | **ACCEPTED** `965111e7863987e2…`（失败 0） |
| Focused | `native-poison-death`：主池 58/64 固定续局可逃；控制 75/96 存活 |
| 玩法门 analyze-run | REJECTED（可靠性 PASS；分数门未过） |
| 工作源 | `0ed5c5b27938bf3e…`（与 capture 一致） |

胜率骤降分析：[v2-winrate-drop-analysis](implementation/v2-winrate-drop-analysis.md)
（主因整局星竞争崩，非新地图过拟合）。

星翻转消融：[star-flip-escape-ablation](implementation/star-flip-escape-ablation.md)：
Quality/demote 无效；关整段 EscapeObligation 胜率 8%→22% 仍远低于基线 51%，TURN 占比不降
→ 主因在 EO 外 Soft/Info/搜索栈。

旧 Escape Quality 对照（19,136 Capsule / 主池 87）已作废；后续 focused/compare 以本基线为准。

## 下一步

1. **开野 Soft 误触发**：`!committed && !stayExposed` 时禁止 Soft/deathPressure 压 GO（优先消融验证）。
2. EO 仅保留接触/committed；远距离帧不 `applyToSafety` / first-action restrict。
3. 整局星差 / frameLimit 胜率纳入门禁；focused S2D 不能单独合格。
4. 语义冻结后再做 Production 瘦身与 Candidate。
