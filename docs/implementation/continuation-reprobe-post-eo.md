# CONTINUATION re-probe after EscapeObligation

状态：2026-07-20 完成。相对 B0 源漂移允许；工作源
`aa036cef…`（EscapeObligation 同帧清出收窄 + fuse-only pressure）。

## 结论

对 Step 1 的 **8** 个 `CONTINUATION_ESCAPE_GAP` 先验样本现场重放：

| 项 | 值 |
|---|---:|
| 仍为 CONTINUATION | **8 / 8** |
| 选中动作相对 B0 改变 | **0** |
| 固定续写下存活 | **0** |
| 仍死亡 | **8** |
| 义务激活（选后） | 2 |
| selected `committedFatalMass` > 0 | 1 |

**EscapeObligation 当前作用域不足以清掉这 8 个单帧 CONTINUATION 死亡。**

## 已确认的接线缺陷与修正

初次接线后复测（旧版）发现：

1. `restrictRiskController` 依赖跨帧 `active`，**同帧从不收窄**。  
2. 用爆圈内 manhattan「进步」硬收窄会把历史存活的 `TURN_LEFT` 挤成撞死的 `GO`（`chance-geometry` fixture `8bb15faa:22`）。

已修为：

- **同帧硬收窄**：仅当存在 **pressure=0 清出爆圈/弹道** 的 first-action。  
- **压力**：只用 fuse 档，**不**对爆圈内 manhattan 分档。  
- 爆圈内步进仍靠 Safety 软质量；跨帧 `active` 仍可收窄。

`npm run test:4` → **188/188 PASS**。

## 为何 8 例仍不动

多数 CONTINUATION 帧上，单步无法 `BOMB_RANGE` 外清出；GO/TURN/FIRE 同 fuse 压力，硬收窄不触发，选中动作不变。  
单帧探针也看不到跨帧 `active` 链。

## 复现

```bash
./tools/fast-regression-toolchain.sh probe-death-categories \
  --allow-source-drift \
  --prior-report artifacts/fast-regression/reports/death-category-probe-b0/latest.json \
  --category-filter CONTINUATION_ESCAPE_GAP \
  --output-name death-category-continuation-post-eo
```

| 项 | 值 |
|---|---|
| 报告 fingerprint | `e350f54f71f5f4258f9ec48771d1e8617ea6d3bcc29063b1cc14f18625099ca0` |
| 路径 | `artifacts/fast-regression/reports/death-category-continuation-post-eo/latest.json` |

## 下一步（建议）

1. **DeadlineKernel / 多帧 Plan continuation**：在 fuse 窗口内强制逃生链（不靠单帧 manhattan 硬收窄）。  
2. **并行**：Information / value-depth（23+17），与 CONTINUATION 正交。  
3. 可选：多帧探针验证跨帧 `active` 收窄是否在真实对局中生效。
