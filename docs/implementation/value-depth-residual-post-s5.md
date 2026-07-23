# Value-depth residual diagnosis（Step 3b 复访 + 性能）

状态：2026-07-20。锚定 R21 的 23 例 `VALUE_DEPTH_NON_DISCRIMINATION`；在 Step 4/5
之后做**现场**诊断与性能修复（非离线探针）。

## 结论（为何还有很多“检测不出”）

原先把残差归为 `STUCK_DEPTH1_NO_PHYS` **误诊**。实测主因是三条路径/语义问题：

| 根因 | 含义 | 残差占比（修前） |
|---|---|---:|
| **ADOPT_PHYSICAL_DEPTH1** | `!exact && enemyVisible` 走 Physical-adopt，烧光 128 节点停在 depth 1，分数几乎打平 | **9** |
| **MATRIX_TACTICAL_RESELECT** | 死亡压力下 StageMatrix 仍把 tactical 打进混合策略，robust 打平后又选回 GO/FIRE | 多数 INFO 路径 |
| **SELECT_EXPECTED_TIEBREAK** | `select()` 在可接受集上最大化 `expected`/`tactical`，抵消 Step 4 的 search-only robust | 多数打平例 |
| 真·搜索偏致命 | Info depth 2 仍给 GO 更高 `rootScore` | 少数 |
| PHYS_ONLY / NO_SEARCH | exact Physical depth 1；或 contact/nominal 未进搜索 | 2 |

离线 Step 3b 探针看到的 `p0-i1` 与“预算不够”有关，但**更大的洞**是可见+inexact
根本不跑 Information 递归。

## 性能诊断

| 指标 | Step 5 后（修前） | 本次后 |
|---|---:|---:|
| 23 例平均节点 | ~119 | **~54** |
| 23 例平均 inspect ms | ~14 | **~12** |
| INFO_D2 路径 | 9 | **21** |
| 固定续局存活 | 5 | **12** |

热路径浪费：Physical-adopt 用满 128 节点做 depth-1 宽度扩展，却不提供逃生区分。
改为 Information + 预留 continuation 后，矩阵更瘦、叶更公平，节点近乎腰斩。

## 已落地修复

1. **`production-root`**：inexact contact **一律**走 Information search（可见单世界也走）；
   Physical-adopt 仅作 Info 失败回退。
2. **`ProductionInformationSearch`**：continuation **先预留**；敌列 soft-top（≤4）；
   每行公平 continuation 池；soft-top 列用 retained-worst 填 sentinel，避免 `-32000`
   污染 envelope。
3. **`continuationValue`**：trap-first + Physical depth 1 / width 2；Info 叶上再套
   `adjustShallowLeaf`。
4. **死亡压力选择**：
   - StageMatrix 在 Info+death 下仍求解（门禁计数），但 **清空 policy 采样**，改走
     lexicographic；
   - 矩阵格在 death 行用 **search-only**（不注入 tactical）；
   - `lexicographicRiskLess` / `select`：robust 打平时按逃生机动性
     `TURN > GO > FIRE > bomb/poison`，禁止 index/expected 把 GO/FIRE 抬回来。

## 现场验收（R21 23 例）

| 项 | 值 |
|---|---:|
| 存活翻转 | **12 / 23** |
| 仍失败 | 11 |
| `npm run test:4` | **197/197 PASS** |
| 工作源 `workingSourceSha256` | `5c5168728b5f31e9c7f9f330138eef638ec7aef1e46e40fbe6f2813a1db846a6` |

### 仍失败的类型

| 例 | 现象 | 下一杠杆 |
|---|---|---|
| `03be1028:41` `a10a7bd3:90` `96bc0bb3:12` | search 仍偏 GO | 更强叶判别 / bomb-horizon leaf |
| `10cba935:78-79` `29bda884:85` | 选了 TURN，rescue 是 GO | Safety/search 与真实续局不一致 |
| `3447fe62:52` | search 强偏 TURN_RIGHT | 对称转向叶 |
| `1723388c:13` | exact PHYS depth1 烧 128 | Physical 预留 depth2 / 窄宽 |
| `96bc0bb3:11` | NO_SEARCH | contact/nominal 门未进价值搜索 |
| `d6671240` `d9ecf0e2` | GO 无 deathPressure，robust 最高 | Safety 漏标 / 非 fire 死亡 |

## 非目标

- 不把 decisionDepth 提到 10
- 不与 minify 体积流水线混验收
- 完整 observation-split Info 递归仍非本步
