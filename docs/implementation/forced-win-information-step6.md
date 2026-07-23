# ForcedWin → Information（Step 6）

状态：2026-07-20 完成。建立在短收敛（R22b）之后。

## 目标

把生产 ForcedWin 从「仅 exact Physical 单例」扩到 **InformationState 上对
HiddenWorld 的 AND 证明**，且不把 inexact 可见单世界误授权成硬胜（那会跳过
Value/Risk，并在门禁夹具上假阳性）。

## 机制

1. `ProductionForcedWinSearch.searchInformation(...)`
   - 要求 `supportComplete`；
   - **禁止 soft-top**：`worldCount > 4` 直接 `UNKNOWN`（部分世界覆盖不能 PROVEN）；
   - 对每个候选我方 row，**所有** world 上 `proveRow` 皆 PROVEN 才授权该 row；
   - 还原 enemy pose / hash / mark。
2. `production-root` 接线：
   - `exact && enemyVisible` → 原 Physical `search`（行为不变）；
   - `!enemyVisible && hiddenRiskSupportComplete && 2≤worldCount≤4 && 未截断`
     → `searchInformation`（**不**改写 `hiddenSupportComplete`，以免 Safety/Risk
     语义漂移）；
   - 可见但 inexact 的单世界：**不**跑授权 ForcedWin。

## 验收

| 项 | 结果 |
|---|---|
| `test/sr6/forced-win-information.test.js` | 4 PASS |
| `npm run test:4` | **203/203 PASS** |
| Focused vs R21（含收敛） | 主池 50→**75**（+25），`SURVIVE→DIE` **1**，控制 68 无退化 |

Step 6 本身在当前 corpus 上几乎不改变存活差（小而完整的隐藏信念极少）；
本步交付的是**可授权的 Info ForcedWin 管道**与门禁，而不是强行抬存活。

## 非目标

- 完整 observation-split 策略图 / DFPN
- 对 `worldCount>4` 的近似 ForcedWin
- 可见+inexact 单世界硬授权
- minify 体积

## 残差

短收敛后仍有 1 例主池 `SURVIVE→DIE`：`826c5155:26`（committed bomb+projectile，
search 强偏 GO）。属 CONTINUATION / Deadline 轨道，不在 Step 6 范围。
