# V2 胜率骤降分析（742 场景刷新后）

状态：2026-07-21。证据来自本次 working-arena（`0ed5c5b2…`，5936 场）相对冻结
IMP8 同局基线（1952 场），以及 capture `run-068b60d6…`。

## 结论（先看这个）

1. **下降是真的、且很大**：同局可比 1952 场上，V2 胜场 **731 → 368**（约 **37.5% → 18.9%**，净 −363）。
2. **不是「新地图过拟合」为主因**：Discovery / Calibration / Frozen / Rolling 胜率都在 **18–20%**，新增 498 场景与锁定 244 场景几乎同差。
3. **主因是整局星竞争崩了**（frameLimit），不是单纯「又死得更多」：旧胜→现负里 **464/569 是吃星超时负**，其中约 **474** 场发生「基线时领先星 → 现在不领先」。
4. **与 focused 死亡窗回归方向一致、整局目标冲突**：Escape Quality / 逃生优先把策略打成高 TURN、低开野推进；死亡窗存活升了，**开野吃星这个曾经的强项被打穿**。
5. **不建议整包回退 Escape Quality**。消融见 [star-flip-escape-ablation](star-flip-escape-ablation.md)：
   Quality/demote 几乎无效；关整段 EO 仅部分回升，TURN 占比不降 → 主因在 EO 外 Soft/Info 栈。

## 数字对照

| 切片 | 场数 | V2 胜 | 胜率 |
|---|---:|---:|---:|
| 冻结 IMP8 基线（同局） | 1952 | 731 | 37.5% |
| 当前 working（同局可比） | 1952 | 368 | 18.9% |
| 结构修复峰值（文档，同框架） | 1952 | 1082 | 55.4% |
| 当前全量 arena（742×2×4） | 5936 | 1085 | 18.3% |
| 当前 capture r1 | 2968 | 546 | 18.4% |

角色分层（当前）：

| Role | 场数 | 胜率 |
|---|---:|---:|
| DISCOVERY | 1000 | 18.7% |
| CALIBRATION | 448 | 19.6% |
| FROZEN_REGRESSION | 504 | 18.5% |
| ROLLING_DISCOVERY | 3984 | 18.0% |

转移（相对 IMP8 基线）：`WIN→LOSS` **569**，`LOSS→WIN` 仅 **206**。

## 机制：星竞争 vs 单崩

全 arena 终局：

| 原因 | V2 胜 | V1 胜 |
|---|---:|---:|
| frameLimit | 789 | **3820** |
| crashed | 296 | 1031 |

frameLimit 星差（V2 星 − V1 星）：

- V2 领先仅 **292** 场，V1 领先 **3818** 场，平星 499。
- 锁定子集 frameLimit 胜场：基线 V2 **470** / V1 247 → 当前 V2 **277** / V1 **1270**。

`WIN→LOSS` 拆解：frameLimit **464**，crash 105；星领先翻转为不领先约 **474**。

单崩仍差：V2 独死 **942** vs V1 独死 **229**（逃生修复未换成整局活下来更多）。

开火：V2/V1 FIRE ≈ **0.74**（相对旧「约 0.60」略好，但远不足以解释星竞争崩盘）。

## 是否过拟合？

| 假说 | 判定 |
|---|---|
| 过拟合到新增 144/498 地图 | **否**（各 role 均匀差） |
| 过拟合到 focused 64 死亡窗 / 固定续局存活 | **是（目标函数过拟合）**：词典序/ demote 偏向 TURN·逃生，牺牲开野 GO/吃星 |
| 参数漂移 | **否**（arena 仍用冻结 Candidate 参数 + 当前源码） |
| 与旧文档 55.6% 直接比 | **不可比**（不同源码世代 + 分析重分类含平局）；应用同局 1952 转移矩阵 |

## 要不要回退？

| 选项 | 建议 |
|---|---|
| 回退回归数据到 598 | **否**（新语料有效；问题在策略） |
| 整包回退 Escape Quality / R23 逃生链 | **不建议先整包回退**；先做同局 A/B（关 Quality 词典序 / 恢复被退役 demote 前的行为）量星竞争与 focused 存活 |
| 认为「主池 87、S2D=0」已合格 | **否**；整局玩法已严重退化 |
| 下一步 | ① 把 frameLimit 星差 / 同局胜率纳入门禁；② 抽 `WIN→LOSS`+星翻转样本看 GO 是否被 escape Soft/demote 压掉；③ 分离「接触逃生」与「远距离吃星」策略，避免同一套 Membership 压全局 |

## 证据路径

- Arena：`artifacts/diagnostics/v1-v2-working/0ed5c5b27938bf3e-…/working-arena-overview.json`
- 基线：`artifacts/diagnostics/v1-v2/imp8-v2-a5ce6f8ef59abb61/…/exact-match-report.json`
- Capture：`artifacts/fast-regression/battle-runs/run-068b60d6…/manifest.json`
