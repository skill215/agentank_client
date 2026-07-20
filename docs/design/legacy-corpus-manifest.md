# DD9 遗产语料不可变清单与分组合同

状态：DD9 不可变快照合同，DD10 修订说明，2026-07-16。机器权威为 [dd9-legacy-corpus-manifest.json](dd9-legacy-corpus-manifest.json)，本文件只解释 `LEGACY-244-20260715.1`；当前及后续总语料以 [rolling-corpus-contract.md](rolling-corpus-contract.md) 的 MatchLedger、CorpusHead 与 CorpusSnapshot 为准。

## 1. 冻结结论

`LEGACY_CORPUS_VERSION = LEGACY-244-20260715.1`，对应历史回归指纹：

```text
965dcfe90d3605e848485dfc0d1a6926e01d52118f299110f8ef6c1491e04e85
```

该版本固定：

- 244 个去重平台对局，173 胜、71 负；
- 10,996 个 replay frame，10,752 个可比较决策帧；
- 23 个我方历史 codeHash；
- 每局各一份 `raw.json`、`events.json`、`summary.json`，共 732 个文件且无缺失；
- 聚合 manifest、analysis、CSV、v24 行为快照和历史回归报告的 SHA-256；
- 732 文件的确定性集合根 `c985073623505f9a463d97ca410fffea35e0ff5206593257bbfb7d1f65718f9a`。

新增下载不能覆盖该版本。任何文件、计数、去重、分组或角色变化都必须创建新的 corpus version；构建发现 hash 不符时直接失败，不允许“尽量读取”。

## 2. 证据边界

244 局在 DD0–DD8 和 v1 失败分析中已经被查看过，因此它们不是从未见过的盲测语料。DD9 现在锁定其中的 `FROZEN_REGRESSION`，含义是从锁定日起禁止用于 v2 参数调节，而不是篡改历史声称其从未被观察。

这解决了两个容易混淆的概念：

| 名称 | 能证明什么 | 不能证明什么 |
|---|---|---|
| frozen legacy regression | 固定历史场景不再随调参移动；检测已知机制和语义回退 | 未见分布上的泛化能力 |
| post-build forward validation | 构建指纹冻结后新产生、整批封存的平台结果 | 单独一批通过后的永久泛化保证 |

后来的 252 局快照比冻结集多 8 局。DD9 曾将其称为 `PREBUILD_QUARANTINE`；DD10 将活动语义统一迁移为 `DISCOVERY_APPEND`：它们可用于发现问题、生成 fixture 和能力校准，但因结果已经可见，永远不能充当该 candidate 的 forward gate，也不参与本次 244 局角色分配。机器 manifest 中旧标签保留作为历史记录，不是当前状态机枚举。

## 3. 去重和完整性

每个 match 是最小原子；该 match 的所有 frame、窗口、checkpoint 和双向反事实结果必须属于同一角色。

去重顺序：

1. 主键 `urlId`；
2. 次键平台 `replayHash`；
3. 相同键而内容冲突时 `FAIL_MANIFEST`；
4. 不随机拆 frame，不根据 outcome 删除样本；
5. error、timeout、runTime、star 和 crashed 全部保留。

artifact set root 使用每个文件的相对 match 名、字节数和 SHA-256 构造排序叶。机器 manifest 保存了总体、raw、events、summary 四个根；它们是 harness 的输入门，不进入生产坦克。

## 4. 相关组算法

本节分组只适用于冻结 244 快照，算法 id 为 `DD9_CORRELATION_DSU_HASH_V1`。初始每局为一个节点，满足任一条件就连边并取传递闭包：

1. 相同 `urlId` 或 `replayHash`；
2. 相同 `opponentTankId + mapHash + ownSkillId + enemySkillId + ourCodeHash`；
3. 相同 `opponentTankId + ownSkillId + enemySkillId + ourCodeHash`，按 UTC 时间排序后相邻对局间隔不超过 1,800 秒。

这同时处理 match、对手、精确地图、双方技能、代码版本和短时连续对战。它不会因“同一对手曾在另一天出现”把整个 corpus 连成巨型组，也不会让随机地图 hash 使同一轮连续挑战泄漏到不同集合。

v1 我方技能固定为 `stun`，证据来自 v1 输入检查和平台 `skill_cast` replay。旧聚合器把“未观察到敌方施法”的显式 `null` 规范化为 `none`，这是 legacy schema v1 的已知错误：未施法不能证明没有技能。迁移到滚动语料时必须写 `skillId=UNKNOWN` 并附 `skillProvenance`；只有平台公开输入捕获、构建 manifest、实际 cast，或满足同一 tank/build 的受控推断规则时才可填写技能。`SAME_TANK_INFERRED` 可用于 discovery 分层，不能支持严格 Proof 或独立 skill split。

## 5. 稳定角色分配

冻结 244 快照中的每个相关组：

```text
groupId = SHA256(
  "agentank-dd9-split-v1" + NUL
  + lexicographicallySorted(matchUrlIds).join(LF)
)

bucket = unsigned(groupId[0..7 hex]) mod 10000
```

分配区间：

- `0..4999`：`DISCOVERY`；
- `5000..7499`：`CALIBRATION`；
- `7500..9999`：`FROZEN_REGRESSION`。

结果为 162 个相关组，最大组 10 局：

| 角色 | groups | matches | frames | 胜/负 | 用途 |
|---|---:|---:|---:|---:|---|
| DISCOVERY | 89 | 125 | 5,739 | 90/35 | 找失败、生成 fixture/feature/模型假设 |
| CALIBRATION | 31 | 56 | 2,693 | 36/20 | 只调 Risk/Eval/Opponent/预算候选的软参数 |
| FROZEN_REGRESSION | 42 | 63 | 2,564 | 47/16 | 锁后只验证，不反向调参 |
| FORWARD_VALIDATION | 0 | 0 | 0 | — | 仅为 post-build 新平台局预留 |

分配指纹为 `46bd2d93615c77d4b87206670d7fb39621cbf8420a0c22fb839d664085ae29c8`。harness 必须从冻结 manifest 重新导出并核对该值，不维护第二份手写 match 列表。

哈希分配不保证每个稀有场景在 frozen 子集都足量，因此覆盖门使用两层：冻结集负责独立回退检查，DD4 RuleCorpus 和显式 composite/terminal fixtures 负责必须完整覆盖的罕见规则。禁止为“让分布好看”在看过结果后移动单局。

## 6. 四类数据的使用纪律

### 6.1 Discovery

允许查看完整轨迹、失败文档、TruthTrack 和反事实结果，生成新的 finding、fixture、feature 或算法假设。它不能独自让平台规则进入 Hard/Proof。

### 6.2 Calibration

只允许校准软层和工作量参数：风险表、评估权重、对手模型 alpha/confidence、action ordering 以及待 benchmark 的 profile 候选。规则 support、Terminal、Hard 和 Proof 量词不准通过 calibration 改写。

### 6.3 Frozen regression

先冻结 candidate manifest，再运行整批。整批结果揭示后：

- 通过可作为该 candidate 的冻结回归证据；
- 失败则该 candidate 不通过；
- 若根据失败修改设计、权重或代码，旧结果只可转为下一版本 discovery，必须用新的未检查数据重新建立验证证据；
- 不允许逐局试参直到 63 局通过。

### 6.4 Forward validation

真正 forward batch 必须满足：

1. 先冻结 v2 source/minified/build hash、Ruleset、Feature/Weight、Search/Runtime/Memory profile 和 simulator/framework provenance；
2. 再指定平台采集起始时间和 match 数量/场景计划；
3. batch 关闭前不读取结果并修改 candidate；
4. 只接收起始时间之后生成且未进入 discovery/calibration 的 match；
5. 任一修改都产生新 candidate 和新 forward batch。

该冻结快照的 forward count 永远为 0。活动 candidate 的 forward 资格和计数必须从预注册的 CorpusSnapshot/RunManifest 计算，不能回写本文件；当前实现仍为 `NOT_RELEASE_ELIGIBLE`。

## 7. codeHash 到可执行源码支持矩阵

“文件名叫 v24”不等于“等于平台历史 v24”。`EXACT_SOURCE` 的唯一判据是本地文件 SHA-256 与平台 match 中我方 codeHash 完全相等。

| 历史版本 | 局数 | 历史 codeHash 前缀 | 本地支持 | 允许用途 |
|---:|---:|---|---|---|
| v2–v19 | 198 | 各自 18 个 hash | REPLAY_ONLY | factual trace、窗口、事件/结果证据 |
| v20 | 17 | `a8e2a9832e77` | EXACT_SOURCE | 上述用途 + 精确 LegacyPolicyAdapter |
| v21 | 4 | `5621d5f6e95e` | label file hash mismatch | replay；本地文件仅作独立 legacy opponent |
| v22 | 15 | `05aea1188ea7` | label file hash mismatch | 同上 |
| v23 | 1 | `facf7eaa939b` | REPLAY_ONLY | factual evidence only |
| v24 | 9 | `08d63772ab04` | label file hash mismatch | replay；不能声称复现历史 v24 policy |

完整 23 hash 矩阵在机器 manifest 中。`tiny-tank-v24-published.js` 的文件 hash 是 `3ab856...`，它及 `v24-all-244.json` 构成 10,752 决策帧的本地行为快照，但不对应平台历史 v24 codeHash `08d637...`。这两种 provenance 必须分开记录。

## 8. 生产隔离

生产 bundle 不含：

- match id、corpus fingerprint、对手名或 replay 数据；
- split、finding、窗口、CounterfactualResult；
- LegacyPolicyAdapter 和任何 v1 源码；
- JSON/CSV parser、日志或离线缓存。

离线结果最多蒸馏为带 corpus/version 的小型整数 LUT 或通用先验，并且只影响 Risk、ExpectedValue 或 action ordering。开关蒸馏产物必须保持 Terminal/Hard/Proof、support 和动作合法性完全一致。

## 9. 验收检查

DD9 corpus harness 必须机械检查：

- 机器 JSON 可解析，所有计数与聚合源一致；
- 732 个文件存在且四个集合根一致；
- 244 个 match 恰好分配一次，frame/window 不跨角色；
- 相关组不跨角色，分配指纹一致；
- 8 个历史 quarantine id 与 252 快照差集一致，并在活动 ledger 中迁移为 `DISCOVERY_APPEND`；
- `EXACT_SOURCE` 的文件 hash 与历史 codeHash 相等；
- frozen/forward 被 calibration 读取时直接失败；
- production strip 后上述所有字符串、路径和数据均不可达。

当前已完成 manifest 与源数据的机械核对；counterfactual、v2 build strip 和 forward 平台运行仍是实施阶段证据，不由本合同伪报完成。
