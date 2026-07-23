# EscapeObligation 接线（Step 3a）

状态：2026-07-20 完成接线与门禁。语义相对 B0 的**首个算法改动**（非诊断）。

## 结论

在生产根路径接入 `EscapeObligation`：把 **committed bomb / 敌方 projectile** 几何压入 Safety，并在义务激活时把 Risk 可接受集合收窄到 **first-action**（离开爆圈/弹道对齐的 ALLOW 动作）。

Hard 仍是唯一 `REJECT_PROVEN` 权威；本模块不把 possible/hidden 升格为 Hard。

| 门禁 | 结果 |
|---|---|
| `test/sr3/escape-obligation.test.js` | 3/3 PASS |
| `npm run test:4` | **186/186 PASS**（B0 为 183；+3 EscapeObligation UT） |
| 工作源指纹 | `cbcac584cb3220f2be8bd0779824082c5b2e26ded4d1a97334867df31fc317c3`（80 文件；B0 为 `d2f0791d…` / 79） |

本步**不**宣称 CONTINUATION 可避免死亡已清零。再探针见
[continuation-reprobe-post-eo](continuation-reprobe-post-eo.md)（8/8 仍死）。

同帧硬收窄仅在存在 **清出爆圈** 的 first-action 时生效；爆圈内 manhattan 分档已去掉
（避免挤掉历史存活 TURN）。

## 行为摘要

1. `bindEntities`：绑定场上 bomb / 敌方 projectile generation，deadline 取最近爆炸或 `SAFETY_HORIZON`。  
2. `evaluate`：对每行 Hard.evaluate + 投影格 bomb/弹道暴露 → `committedPressure`、`escapeSlackDelta`、`firstAction`。  
3. `applyToSafety`：向 `horizonFatalMass` 注入 committed 质量（修复「有雷但 committedFatalMass=0」的软层证据空洞）。  
4. `activateAfterSelection`：选中仍暴露或处于义务链时跨帧 `active=1`。  
5. `restrictRiskController`：`active` 且实体仍在时，只保留 first-action 可接受行。

## 接线点

`engine-v2/src/runtime/production-root.js`：

- 构造 / `resetMatch`（`decide` + `observeOnly` 新对局）  
- `refineObservationSafety` 之后：`evaluate` + `applyToSafety`  
- `gate` 之后：`restrictRiskController`  
- `finalGate.select` 之后：`activateAfterSelection`

## 实现

- `engine-v2/src/runtime/escape-obligation.js`
- `test/sr3/escape-obligation.test.js`

## 下一步

- 对 Step 1 的 8 个 `CONTINUATION_ESCAPE_GAP` 做源漂移允许的再探针或 focused 回归。  
- Step 3b value-depth / Information 语义（与 EscapeObligation 正交）。
