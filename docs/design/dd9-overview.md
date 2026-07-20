# DD9 Overview 与一致性审计

状态：DD9 COMPLETE（历史快照），DD10 已修订活动语义，2026-07-16。DD9 的 244 快照、hash 和 split 继续不可变；动态总数、post-244 角色、技能 provenance 与平台运行/发布流程以 [rolling-corpus-contract.md](rolling-corpus-contract.md) 和 [platform-operations-contract.md](platform-operations-contract.md) 为准。v2 实现尚未开始，发布状态为 `NOT_RELEASE_ELIGIBLE`。

## 1. 阶段结论

DD9 把 v1 代码、244 局平台记录和未来验证从“可参考资料”冻结为三组不可混用的合同：

```text
Immutable Legacy Corpus
  hash、去重、相关组、discovery/calibration/frozen/forward、防泄漏

Bidirectional Counterfactual
  Truth/Observed双轨、窗口、checkpoint、分叉、对称量词、结果准入

Release Evidence Matrix
  函数/复合/全景/终局/完整对局/build/platform的非加权硬门
```

244 局已经在历史分析和前序设计中被看过，因此 frozen 子集被如实定义为“从 DD9 锁定日起不再调参的非盲历史回归”，而不是伪称 pristine blind test。真正 forward validation 必须在 v2 candidate/build fingerprint 冻结后采集，当前合格数量为 0。

## 2. 产物

| 产物 | 冻结内容 |
|---|---|
| [legacy-corpus-manifest.md](legacy-corpus-manifest.md) | corpus version、hash roots、分组/角色、防泄漏和源码支持边界 |
| [dd9-legacy-corpus-manifest.json](dd9-legacy-corpus-manifest.json) | 机器可检查的计数、完整性、split、quarantine、23 codeHash 矩阵 |
| [counterfactual-validation-contract.md](counterfactual-validation-contract.md) | DualTrack、Window、Checkpoint、Result、分叉和双方严格标签 |
| [release-gate-report.md](release-gate-report.md) | 七层 evidence matrix、G0–G10、阻塞和当前判定 |
| [dd0-dd9-consistency-audit.md](dd0-dd9-consistency-audit.md) | 全局 owner/invariant/冲突/未决项审计 |
| 本文 | DD9 退出门和阶段概览 |

## 3. 语料冻结结果

### 3.1 不可变快照

```text
LEGACY_CORPUS_VERSION = LEGACY-244-20260715.1
corpus fingerprint    = 965dcfe90d3605e848485dfc0d1a6926e01d52118f299110f8ef6c1491e04e85
artifact set root     = c985073623505f9a463d97ca410fffea35e0ff5206593257bbfb7d1f65718f9a
split fingerprint     = 46bd2d93615c77d4b87206670d7fb39621cbf8420a0c22fb839d664085ae29c8
```

244 个 match、10,996 帧、732 个 raw/events/summary 文件完整。聚合源中的 23 个历史 codeHash 合计 244 局和 10,996 帧，与机器 manifest 交叉一致。

### 3.2 相关组与 split

按 match 原子、opponent、exact map、own/enemy skill、our codeHash 和 30 分钟连续 session 建立并查集；稳定哈希得到：

| role | groups | matches | frames | 使用权限 |
|---|---:|---:|---:|---|
| Discovery | 89 | 125 | 5,739 | 发现与假设 |
| Calibration | 31 | 56 | 2,693 | 软参数选择 |
| Frozen regression | 42 | 63 | 2,564 | 锁后只验证 |
| Forward validation | 0 | 0 | 0 | post-build 才能采集 |

252 局快照新增的 8 局不改变 244 局版本，也不充当最终 forward。DD9 的历史标签为 `PREBUILD_QUARANTINE`；活动 ledger 已迁移为 `DISCOVERY_APPEND`。

### 3.3 v1 源码支持

只有 `tiny-tank-v20-published.js` 的文件 SHA-256 与历史平台 v20 codeHash 精确相等。v21/v22/v24 本地文件与同名历史版本 hash 不相等：

- v20 可进入 exact LegacyPolicyAdapter；
- 其余历史 codeHash 只作 replay/factual 证据；
- v21/v22/v24 label 文件仍可作独立 legacy league 对手，但不能声称复现历史 policy；
- v24 的 `3ab856...` 行为快照与平台历史 v24 `08d637...` provenance 分开。

`OI-ARCH-012` 因此可关闭：缺源码不是靠猜测补齐，而是由支持矩阵显式降级。

## 4. 反事实合同结果

### 4.1 双轨和分叉

- TruthTrack 只供 Oracle/定位，不可进入 policy；
- OUR/ENEMY 各有自己的 ObservedTrack 和 InformationState；
- 动作、队列、物理、实体、观察或 chance prefix 任一不同即分叉；
- 分叉后历史后缀消费帧必须为 0；即使以后回到同 cell 也不能恢复旧后缀；
- 后继由 Reference/Fast 与声明 policy/search 产生。

### 4.2 标签层级

| 标签 | 证据 | 能影响 |
|---|---|---|
| TRACE_AVOIDABLE | 实际下一回应 witness | Risk/Eval/反例 |
| MODEL_AVOIDABLE | Trace/通用 nominal policy | Risk/Eval/Opponent |
| ROBUST_AVOIDABLE | 全 support + DD6 Safety/ForcedNonloss | Safety/Proof fixture |
| STRICT_UNAVOIDABLE | DD6 ForcedLoss 或更强 InevitableLoss | Proof；后者才是 Hard 候选 |
| UNKNOWN | 任一规则/重建/容量/搜索未闭合 | 诊断，不升级 |

DD9 修正了遗产草案中一个容易产生假证明的表述：simultaneous StrictUnavoidable 必须存在单一敌方 response policy 同时覆盖全部我方 rows；不能“每个 row 分别找一个 column”。

### 4.3 双向运行

每个死亡窗口同时分析历史死亡方是否可逃，以及历史被击杀对手是否本可逃脱。后者能把“对手失误形成的击杀”与 ForcedWin 分开，也能保护真正的正向 kill mechanism。

当前 runner 未实现，所以以上是 design-executable schema 和准入合同，不是已产生的 244 局反事实结论。

## 5. 发布结论

当前唯一准确判定：

```text
DETAILED_DESIGN_HANDOFF_READY
V2_IMPLEMENTATION_NOT_STARTED
V2_RELEASE_NOT_ELIGIBLE
```

已实际完成的发布相关证据只有语料完整性/split 和 DD3 架构原型。以下全部仍 NOT_RUN/BLOCKED：

- v2 Reference/平台 fixture；
- Reference/Fast 全字段差分；
- Terminal/Hard/Proof false-positive suite；
- cache-off、stale、overflow、root restore；
- 244 局重建与双向反事实；
- 正向机制保护；
- v2 六层 benchmark、1.5/2.5/3 秒平台 runtime；
- production strip、bytes、source/minified；
- frozen candidate 批次和 post-build platform forward。

发布采用 G0–G10 全部 PASS 的 AND，不采用加权分数。胜率、开火数或平均速度不能抵消任何硬错误、timeout 或证据缺失。

## 6. DD9 退出门

| 退出条件 | 设计结果 | 说明 |
|---|---|---|
| `LEGACY_CORPUS_VERSION` 唯一且不可变 | PASS | aggregate/artifact roots 和计数冻结 |
| match/opponent/map/skill/codeHash/time 防泄漏 split | PASS | 162 组、244 局恰好一次，稳定 fingerprint |
| codeHash→source 支持矩阵 | PASS | 仅 v20 exact，其余如实降级 |
| Truth/Observed/Window/Checkpoint/Result schema | PASS | owner、provenance、整数语义、版本字段明确 |
| 分叉后不消费 replay suffix | PASS_DESIGN | predicate/assert/test 已冻结；实现待运行 |
| 双方对称 avoidability 量词 | PASS | 直接引用 DD6 Proof；关闭 per-row response 漏洞 |
| 正负机制同时验证 | PASS_DESIGN | Failure/Positive 成对门已冻结 |
| release evidence matrix | PASS | 七层 + G0–G10，空结果不算 PASS |
| 当前发布状态真实 | PASS | 明确 NOT_RELEASE_ELIGIBLE |
| production 隔离 | PASS_DESIGN | strip deny list/测试明确；实际 bundle 待实现 |

DD9 退出是详细设计退出，不是 implementation/release exit。

## 7. 与 DD0–DD8 的一致性

| 前序合同 | DD9 使用方式 | 冲突检查 |
|---|---|---|
| DD1 Scheduler/Timeline/Terminal | factual phase、terminal 和 perspective | 不重新定义 phase/outcome |
| DD2 Physical/Information/Result ABI | 双 ObservedTrack、checkpoint、mixed result refs | Truth 不泄漏，world support 不压扁 |
| DD3 TypedArray/Delta/BranchMark | 离线 compact trace、checkpoint delta、分叉 apply/undo | 离线可并行，生产仍单线程 |
| DD4 RuleCorpus/Reference | 重建 assumptions 和平台升级门 | replay 结果不自行改 ruleset |
| DD5 Fast/Hazard/Hard | committed death/escape、branch restore | trace/model 不升级 Hard |
| DD6 Value/Matrix/Proof/Risk | robust/strict 标签唯一量词 | per-row ForcedLoss 冲突已修正 |
| DD7 Eval/Opponent/Skill/Plan | calibration 与正向机制 | 对手模型只给 MODEL，Plan 不拥有事实 |
| DD8 Cache/Runtime/Build | result key、平台性能、strip/manifest | offline cache 不进入 production |

未发现要求回退 DD1–DD8 的新语义冲突。发现的 corpus blindness 与 codeHash/source 命名冲突已在 DD9 内显式消解。

## 8. 未关闭项

详细设计完成不消灭外部事实和实施证据缺口：

- R0/R1 有限 RuleVariant 和 R2 概率仍按 DD4 UNKNOWN/interval/support 行为处理；
- Risk/Eval/Opponent 参数、搜索深度、batch、cache/capacity 仍需 Discovery/Calibration 与 benchmark；
- platform JavaScript engine、exact byte limit、runtime P99 仍未知；
- v2 实现、runner、production build、frozen/forward 报告均不存在。

这些项目阻塞发布，但不阻塞从 DD9 进入按依赖顺序的实现。实现若证明状态不可表达、规则不可执行或性能结构不成立，才回退相应 DD 修改。

## 9. 阶段 handoff

下一步不再继续增加并列架构概念，而应按 [release-gate-report.md](release-gate-report.md) 的执行顺序实现：Reference → Fast/Hard → Search → soft modules → Cache/Runtime/Build → historical harness → calibration/frozen/forward。

任何实现选择都必须携带本阶段的 corpus/split、规则、搜索、runtime 和 build fingerprints，确保失败可定位、参数可回退、证据不可混用。
