# 当前状态

更新时间：2026-07-23（Asia/Shanghai）。

## 工作区与恢复分支

- 唯一工作区：`/home/skill/workspace/git/agentank_client`。
- 当前恢复分支：`codex/v2-global-recovery`。
- `REJECTED` dirty 源码检查点：`17f0979`。
- Node：`v24.16.0`。
- V1、旧 IMP8 Candidate、官方 context/simulate attestation 和真实 `battle-records/`
  均保持只读。

本轮是 **GR0 全局恢复**。它替代 R21–R23 的逐帧 Capsule 工作流，不再把历史完整回归负载
当成长期资产。旧报告仍是历史说明，但其中被清理的 artifact 路径不再是可用证据入口。

## 已完成：旧证据瘦身

固定工具：

```bash
./tools/artifact-retention-toolchain.sh inventory
./tools/artifact-retention-toolchain.sh compact
./tools/artifact-retention-toolchain.sh verify
./tools/artifact-retention-toolchain.sh prune --manifest \
  artifacts/retention/gr0/verified-prune-manifest.json
```

结果：

| 项 | 结果 |
|---|---:|
| 删除文件 | 24,825 |
| 释放空间 | 4,592,945,690 bytes |
| 清理后 `artifacts/` | 约 16 MB |
| `battle-records/` | 约 162 MB，未删除 |
| Verified manifest | `493a144e2f6291844c2a71f8294322084ba6e1e403f11e96a94337d24bc94ccb` |
| Prune receipt | `0e84f433fc4bea60f9b1d595d7cd5d046fc7ae2f451f0d3cebcf4ef4bd2525ab` |

紧凑 `LegacyArenaBaselineV1` 保留：

| 基线 | 分母 | V2 胜 | V1 胜 | 平 |
|---|---:|---:|---:|---:|
| IMP8 common | 1,952 | 731 | 1,091 | 130 |
| working `0ed5c5…` common | 5,936 | 550 | 4,849 | 537 |
| SR3 final | 2,128 | 1,225 | 792 | 111 |
| SR4 final | 2,128 | 1,179 | 828 | 121 |

同时保留历史 55.6% 汇总及其源码指纹，并明确标记其精确源码字节缺失。紧凑基线位于本地忽略目录
`artifacts/retention/gr0/baselines/`；它们只保存逐局结果，不保存逐帧 state、candidate rows、
replay events 或重复地图/星序列。

## 已完成：GR0 结构修复

生产选择顺序固定为：

```text
Hard
→ Risk 多维可接受集
→ committed escape 交集
→ Pareto 支配
→ 最大 robustLower safe floor
→ StageMatrix
→ expected / tactical / 稳定行号
```

关键约束：

- Information 风险不再清空 tactical、不再降低 safe floor，也不禁用 mixed policy。
- `NO_ACCEPTABLE_ACTION` 只在 Risk 可接受集为空时按最小风险字典序回退，Hard 永不放宽。
- `EscapeObligation.evaluateCommitted(...)` 只绑定真实炸弹和敌方 committed 弹丸。
- 实体身份是 `kind + owner + id + generation`。
- possible projectile、future FIRE、己方弹丸和枪口朝向不创建 Escape obligation。
- ReverseViability 证明可活的 FIRE、NONE、技能和移动动作一律保留。
- support 不完整不限制动作；EO 不再制造 Safety 死亡概率。
- `null` 弹丸观察只对严格可见射线做反证；单数弹丸仍不代表完整集合。
- 同平台帧重复求值保持幂等，Physical TT 可以复用。

## 已完成：纯结构门禁

唯一入口：

```bash
npm run test:gr0
```

该脚本只做修改文件语法检查和纯 UT，不读取 `battle-records`、旧回归、Capsule、focused cohort
或对战模拟。当前结果：**122/122 PASS**。

覆盖：

- exhaustive 小型 Minimax max-min/min-max、simultaneous matrix、chance/hidden robust backup；
- Proof AND/OR、HiddenWorld/Chance/Observation 严格量词和所有预算前缀不产生假 Proof；
- StageMatrix exact bounds、exploitability、dominated row 和不完整矩阵语义；
- iterative deepening 中断只保留最后完整深度；
- root restore、状态复用、物理 TT、cache on/off；
- Risk 阈值、Pareto、robust floor、emergency lexicographic fallback；
- committed Deadline/EO、实体复用、possible/future threat 隔离；
- FIRE/NONE/技能 survivor 保留、Hard 不可恢复、Safety mass 不被 EO 修改。

## 下一步：唯一一次 6,608 局全量对战

GR0 源码提交后，直接执行：

```bash
./tools/v1-v2-working-arena.sh \
  --repetitions 2 \
  --trace compact \
  --progress-every 32 \
  --output artifacts/diagnostics/v1-v2-working/<content-addressed-directory>
```

固定目标分母为 `826 × 2 × 4 = 6,608`。只允许生成：

```text
manifest.json
working-arena-overview.json
matches.ndjson.gz
diagnostic-samples.ndjson.gz
```

运行通过或失败都不自动补丁、不进行第二轮、不执行官方 simulate/publish/challenge。完整门槛和
证据布局见 [GR0 全局恢复](implementation/gr0-global-recovery.md)。
