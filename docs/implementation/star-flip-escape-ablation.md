# Star-flip Escape 消融探针

状态：2026-07-21。Discovery only，**不是门禁**。样本：相对 IMP8 基线的
`WIN→LOSS` + frameLimit + 星领先翻转，取 24 个 historicalMatchUrlId × 4 变体 = 96 场/模式。

报告：`artifacts/diagnostics/star-flip-escape-ablation/latest.json`
（fingerprint `c6209f1be64752e6…`）。

## 同局样本锚点（arena 全量，非探针）

| 源 | 场数 | 胜率 | 星差(V2−V1) | TURN/(GO+TURN) |
|---|---:|---:|---:|---:|
| IMP8 基线 | 192 | **51.0%** | **+0.68** | **25.7%** |
| 当前 arena | 192 | 9.9% | −1.58 | 42.8% |

## 消融结果（探针 96 场/模式）

| 模式 | 胜 | 胜率 | 星差×1000 | TURN 占比 |
|---|---:|---:|---:|---:|
| current | 8 | 8.3% | −1615 | 42.9% |
| noQuality | 10 | 10.4% | −1573 | 42.8% |
| noGoDemote（上轮） | 7 | 7.3% | −1615 | 42.4% |
| noSoftEscape（上轮） | 10 | 10.4% | −1573 | 43.0% |
| kitchen sink demote（上轮） | 11 | 11.5% | −1531 | 42.4% |
| **noEscapeObligation** | **21** | **21.9%** | **−1354** | **43.3%** |

## 判定

1. **Escape Quality 词典序不是主因**（+2 胜，可忽略）。
2. **GO Temporary demote / softEscape 开关几乎无效**。
3. **整段 EscapeObligation（evaluate + Soft Safety + restrict）关掉后胜率 8%→22%**，说明 EO
   Soft/限制有实质伤害，但**仍远低于基线 51%**，且 **TURN 占比几乎不动**。
4. 因此：星竞争崩盘的主因在 **EO 之外的 Soft / Information / 搜索与选择栈**
   （multi-frame Soft、observation Safety、deathPressure 词典序、Info 叶值等）；
   EO 是叠加损伤，不是 TURN↑ 的根。

## 不要做什么

- 不要整包回退 Escape Quality（证据不足）。
- 不要只关 Quality 指望整局胜率回升。
- 不要用 focused 死亡窗存活替代整局星差门禁。

## 建议的下一刀（按证据排序）

1. **开野 Soft 误触发**：在 `!committed && !stayExposed` 时禁止 Soft fatal / deathPressure
   改写 GO vs TURN（与 EO 解耦的 Safety/Risk 路径）。
2. **EO 收窄**：保留接触/committed 逃生；禁止对远距离吃星帧 `applyToSafety` / first-action restrict。
3. **整局门禁**：同局星差 + frameLimit 胜率进回归，与 focused S2D 并列。
4. 再对「关 Soft-open-field」做同款 24 场景消融，确认 TURN 份额回落后再动语义。

## 探测开关（仅 Discovery）

`ProductionRootEngine` / `EscapeObligation` 选项：

- `diagnosticDisableEscapeQuality`
- `diagnosticDisableGoDemote`
- `diagnosticDisableSoftEscape`
- `diagnosticDisableEscapeObligation`

```sh
node tools/agentank/diagnostics/star-flip-escape-ablation.js 24
```
