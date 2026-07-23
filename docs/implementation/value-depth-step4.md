# Value-depth comparison semantics（Step 4）

状态：2026-07-20 完成。Step 5（Information 递归）已暂停；本步只修浅层比较语义。

## 问题

`VALUE_DEPTH_NON_DISCRIMINATION`（23）在 Safety 风险元组相同（含 `escapeSlack`）时，
浅层 Information（多为 `p0-i1`）的 **tactical 侵略分** 压过 `rootScore`，让致命动作
Pareto 支配逃生动作。

## 修复（语义，不改风险门槛）

1. **`RiskAcceptanceController.populate`**：当 **Information** 搜索完成且该行有
   Safety 死亡压力（`immediate|horizon` mass > 0 或 `escapeSlack < 0`）时，
   `robustLower` 只取 `searchPart`；`expectedValue` 仍保留 tactical+search 混合（供
   safe-floor 内利用）。Physical depth 仍走原混合（多步递归已自带信号）。
2. **`strictlyDominates`**：任一端有死亡压力时，价值侧只比较 `robustLower`
   （禁止单靠 tactical/expected 支配）。
3. **`ProductionInformationSearch.adjustShallowLeaf`**：邻接（manhattan ≤ 2）叶上
   撤销朝敌 clear-line 奖金，并惩罚朝敌 / 奖励背敌。不进入 Physical `heuristic`，
   以免扰动 depth≥1 物理搜索。

## 现场验收（R21 冻结 23 例）

| 项 | 值 |
|---|---:|
| 选中改为固定续局存活 | **4** |
| 仍死（未改动作） | 18 |
| 改动作仍死（非 rescue） | 1（`6f49c211:15` CAST→GO，两者均死） |

存活翻转样例：`00be00d7:34` GO→FIRE；`0bca6b52:20` / `8bb15faa:20` FIRE→TURN_LEFT；
`c484c9b0:49` CAST_POISON→TURN_LEFT。

其余 19 例需 **Step 5** 预算化 Information 递归（叶/深度仍无法区分）。

## 门禁

- `test/sr4/value-depth-comparison.test.js`（4）
- `npm run test:4` → **194/194 PASS**（Step 4 验收时；其后 Step 5 纳入 sr5）
- 工作源 `workingSourceSha256`：`b049ae5720ee7e76f233d688dca3d4c71d147a097a6fde28ce478bddf7175a13`

## 非目标

- 不扩建 Information `completedDepth > 1`（见 Step 5）
- 不改 risk 阈值 / `minimumEscapeSlack`
- 不与 minify 体积流水线混验收
