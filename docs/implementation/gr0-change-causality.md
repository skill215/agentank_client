# GR0 未提交变更因果审计与选择性恢复

状态：选择性修复已进入 working source；纯 UT 通过；尚未执行新的 6,608 局全量资格对战。

## 1. 问题边界

官方实战胜率下降不能直接归因于整个 Git 变更区间。对 `643ae1e`、`17f0979` 和 GR0 working
source 使用相同场景、换位、技能和分析语义做因果对照后，旧父提交在 184 局样本中为
`40/124/20`（V2胜/V1胜/平，27.17%），当前默认为 `42/119/23`（29.07%），而且旧父提交
本地总耗时约为当前的 2.3 倍。因此整段回退既不恢复历史 55.6%，也会删除已经证明的正向修改。

本审计只接受三类结论：

- 同输入只改变一个开关；
- 逐局结果可比较；
- 先在 46 个高信息量场景发现，再在不重叠的 96 场景 holdout 验证。

所有运行都只保存紧凑终局和聚合计数，不保存逐帧 state 或 replay。

## 2. 正向修改

| 修改 | 因果结果 | 决策 |
|---|---|---|
| Information depth 2 continuation | 降为 depth 1 后 42/119/23 → 38/123/23，29.07% → 26.90%，且更慢 | 保留 |
| 所有 inexact contact 进入 Information search | 恢复旧 visible shortcut 后变为 36/128/20，25.00%，且明显更慢 | 保留 |
| 近距离 clear-line `+1200` 反转 | 关闭后变为 42/120/22，29.07% → 28.80%，击毁结果也变差 | 保留 |
| committed-only EscapeObligation | 关闭后 184 局逐局胜负完全相同；只减少部分 `NO_ACCEPTABLE`，未制造退化 | 因正确性保留 |
| Projectile、Hard、Risk、StageMatrix、root restore 的 GR0 结构约束 | 123 个纯 UT 全部通过，关键 invariant 为零 | 保留 |

## 3. 负向修改

`adjustShallowLeaf` 曾在 clear-line 反转之外，再对“面向近距离敌人”无条件扣 `800`。这相当于对
同一姿态重复惩罚，并且不区分 committed danger、可开火窗口和星数目标。

高信息量 184 局：

| 默认 | 删除 `-800` |
|---|---:|
| V2/V1/平 | 42/119/23 | 44/119/21 |
| 分析得分 | 29.07% | 29.61% |
| 单方击毁负/胜 | 30/12 | 28/11 |

独立 96 场景、384 局 holdout：

| 默认 | 删除 `-800` |
|---|---:|
| V2/V1/平 | 54/284/46 | 60/277/47 |
| 分析得分 | 20.05% | 21.74% |
| 单方击毁负/胜 | 91/21 | 89/27 |
| 本地总耗时 | 74,007,713 µs | 71,683,080 µs |

因此 production 默认已删除该 `-800`，并加入精确 UT：clear-line 姿态只能反转 `1200`，不能再
叠加旧惩罚。

## 4. 不能整体删除的混合修改

背向敌人的 `+400` 脱离奖励单独关闭后：

- 高信息量样本为 `43/119/22`，29.34%；
- holdout 为 `55/285/44`，得分仍为 20.05%，但负场增加；
- 与 `-800` 同时关闭时，高信息量样本的单方击毁负场从 30 增到 37。

因此两个子项有显著交互，不能删除整个 shallow adjustment。只删除已在发现集和 holdout
同时验证为负面的 `-800`，保留 `+400`。

## 5. 证据入口

可重复工具：

```bash
node tools/agentank/diagnostics/gr0-change-ablation.js \
  --current <compact-matches.ndjson.gz> \
  --modes CURRENT,<mode> \
  --limit-per-class 16

node tools/agentank/diagnostics/gr0-change-ablation.js \
  --current <compact-matches.ndjson.gz> \
  --modes CURRENT,<mode> \
  --holdout-count 96
```

本地紧凑报告：

- `24b245...`：depth、旧 Information 路由和 EO；
- `eeffada...`：clear-line 与组合 facing；
- `3182d286...`：`-800` 和 `+400` 子项发现集；
- `c54a8bc...`：96 场景独立 holdout；
- `parent-643ae1e.json`：旧父提交精确同样本结果。

这些报告位于被 Git 忽略的 `artifacts/diagnostics/gr0-change-ablation/`。

## 6. 尚未解决

选择性修复是相对改善，不是资格通过。GR0 的 6,608 局结果仍为 1,125 胜、4,630 负、853 平，
分析得分 23.47%，远低于 60% 门槛；固定 266 场景的 V2 单方击毁胜仅 111，也未达到 358。
本次因果审计证明“大段回退”不是答案，后续必须继续找独立结构原因。

临时 production 构建的 source/minified 行为指纹一致，但 minified 为 427,475 bytes，超过平台
204,800 bytes 限制。代码体积仍是独立发布阻碍；本轮不以改变搜索语义的方式处理它。
