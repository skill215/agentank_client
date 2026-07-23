# Projectile/bomb-aware Deadline（CONTINUATION 增量）

状态：2026-07-20 完成接线与门禁。相对 [deadline-kernel](deadline-kernel.md) 的下一语义增量。

## 结论

加强 **committed projectile hit-tick** 与 **同帧收窄**：

1. `DeadlineKernel`：stay 格敌弹命中 tick（折合帧）进入 `deadlineTick` / `slack`。
2. `EscapeObligation`：hazard `isLethal` 补全暴露；GO 踏入 tick-1 致死格或仅剩侧向逃生时强制 Deadline first-action；**GO 贴敌且存在 TURN 逃生时降级 GO**；gate 清空时可把 Deadline first-action **提升进 emergency 可接受集**。

| 门禁 | 结果 |
|---|---|
| `test/sr3/deadline-kernel.test.js` + EscapeObligation UT | 9/9 PASS |
| `npm run test:4` | **205/205 PASS** |
| 工作源 | `8b22cc1747784a25313d152cb32e2f2a8b3a420e46536a7cd3b4ab511acbb57b` |

## CONTINUATION 8 再探针

相对 B0 先验 8 例（允许源漂移）：

| 项 | EO-only | +Deadline | **+projectile Deadline** |
|---|---:|---:|---:|
| 选中动作改变 | 0 | 1 | **3** |
| 固定续写存活 | 0 | 1 | **3** |
| 仍死亡 | 8 | 7 | **5** |

新增存活：

- `1723388c:13` CAST_POISON → **TURN_LEFT**（踏入弹道格 → 侧向强制）
- `1723388c:15` 现选 GO，固定续写存活（相对先验 TURN_LEFT 有动作变化）

原存活 `8bb15faa:20` 保持。

报告 fingerprint：`41cde3bfc4116032ba6c734ecf85e96b912b698cb901abc44ace4d2039fd605a`  
路径：`artifacts/fast-regression/reports/death-category-continuation-post-projectile-deadline/latest.json`

```bash
./tools/fast-regression-toolchain.sh probe-death-categories \
  --allow-source-drift \
  --prior-report artifacts/fast-regression/reports/death-category-probe-b0/latest.json \
  --category-filter CONTINUATION_ESCAPE_GAP \
  --output-name death-category-continuation-post-projectile-deadline
```

## 收敛残差 `826c5155:26`

短收敛 R22b 唯一主池 `SURVIVE→DIE`：committed 自雷 + 自弹，搜索偏 GO 贴敌。  
本步：Deadline/EO 降级贴敌 GO，并在 no-acceptable 时提升 TURN first-action → 现选 **TURN_LEFT**，固定续写 **存活**（与 R21 一致）。

## 实现

- `engine-v2/src/fast/deadline-kernel.js` — hit-tick deadline、`enemyAdjacent`
- `engine-v2/src/runtime/escape-obligation.js` — walk-into-lethal / lateral / GO 贴敌降级 / emergency promote
- `test/sr3/deadline-kernel.test.js`

## 边界

- 不替代 Hard；不把 possible/hidden 升格为 Hard。
- 自弹仍非 EO 绑定实体（owner===0）；仅敌弹 + 任意 bomb。
- 剩余 5 例 CONTINUATION 多为自弹-only、敌邻接开火、或 first-action 仍死于固定敌方续写。

## 下一步

1. 消化剩余 5 例 CONTINUATION（敌邻开火 / 自弹路径 / 多帧 continuation）。
2. 或对主池做 focused/全量回归确认 `826c` 回归已消。
3. 语义冻结后再做 Production 瘦身。
