# Death-category probe B0（Step 1）

状态：2026-07-20 完成。锚定 [structural-repair-baseline-b0](structural-repair-baseline-b0.md)
（`workingSourceSha256 = d2f0791d…`）。未改算法、未 publish。

## 结论

在 R21 可避免死亡池（115 根）上做 25 根分层抽样并现场重放后：

| 类别 | 数量 | 含义 |
|---|---:|---|
| `HARD_REJECT_SELECTED` | 0 | 未发现 FinalActionGate 选中 Hard reject |
| `HARD_VIABILITY_LEAK` | 0 | 未发现 ALLOW 但 `reverseViable===0` |
| `FACT_LAYER_MISMATCH` | 0 | 本样本无「观察有弹/雷、PhysicalState 无实体」 |
| `CONTINUATION_ESCAPE_GAP` | **8** | 已有 committed 危险且选后仍存在/不完整逃生链 |
| `INFORMATION_ONLY` | **17** | 无 committed bomb/projectile，死亡来自 possible/hidden/未来开火等 |

**现场可避免死亡在本样本中不表现为 Hard 接线失败。**  
主因分裂为：

1. **约 1/3**：committed 逃生链存在（或 viable incomplete）却未跨帧强制 continuation → EscapeObligation / DeadlineKernel。  
2. **约 2/3**：无 committed 实体，属 Information/Safety/价值比较 → 与 `DOMINATED_RESCUE` 的 value-depth 工作对齐，而不是先修 Hard。

## 抽样与复现

```bash
./tools/fast-regression-toolchain.sh probe-death-categories \
  --limit 25 --seed 1 --output-name death-category-probe-b0
```

| 项 | 值 |
|---|---|
| 报告 fingerprint | `07e6426033f8da8af1804d61d4696c382659e20d0ca3ecc19be148865cca767e` |
| 路径 | `artifacts/fast-regression/reports/death-category-probe-b0/latest.json` |
| 源 focused | R21 `ffcc3b1b…`（与工作源指纹一致） |
| 池 / 层 / 样本 | 115 / 37 / 25 |

危险类型：bomb 4、projectile 4、possible 10、none 7。  
选择桶：`DOMINATED_RESCUE` 10、`NO_ACCEPTABLE_RESCUE` 10、`LOWER_ROBUST_RESCUE` 5。

### 子类型

| subtype | 数量 |
|---|---:|
| `COMMITTED_ESCAPE_EXISTS_AFTER_SELECTED` | 6 |
| `COMMITTED_VIABLE_INCOMPLETE` | 2 |
| `POSSIBLE_OR_HIDDEN_ONLY` | 10 |
| `NO_COMMITTED_HAZARD` | 7 |

分类规则（修订后）：**不以 `rescuingActions` 是否非空判定 continuation**（可避免帧几乎总有救援动作）。  
以 committed PhysicalState + `HardGate.lastViable` 区分 CONTINUATION 与 INFORMATION。

## 对后续步骤的含义

1. **Step 2 事实层烟雾**：本 25 根未击中观测/实体丢失；仍建议对全池或 bomb/projectile 子集做轻量扫描，但**不应阻塞** EscapeObligation。  
2. **EscapeObligation（原 P0）**：优先针对 8 个 CONTINUATION 样本（尤其 6 个 `lastViable===1` 且 `escapeSlack` 常为 -1）。  
3. **DOMINATED_RESCUE / Info 语义（原 P0）**：17 个 INFORMATION_ONLY 与 23 个 value-depth 桶同向；应并行推进，且不要假设全是 EscapeObligation。  
4. **不要**为此把 decisionDepth 拉到炸弹 fuse，也不要新增生产 DeathChecker。

## 实现

- `tools/agentank/fast-regression/death-category-probe.js`
- CLI：`probe-death-categories`（`fast-regression-ops.js`）
