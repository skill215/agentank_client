# Escape Membership/Quality Phase0–4

状态：2026-07-21。按计划完成 Kernel 质量 API、Risk 接线、Membership 三值、
部分 demote 退役与度量分层。

## 结论

| Phase | 结果 |
|---|---|
| 0 Deadline per-successor API | **完成**（`SUCCESSOR_PROOF` / exposed / slack / branches / coverage） |
| 1 Risk 接线 | **完成**；vs R23b `NO_NET_CHANGE` |
| 2 Membership 三值 | **完成**；UNKNOWN 保留；vs R23b `NO_NET_CHANGE` |
| 3 退役 Temporary demote | **部分**：仅 3.1（facing 保 GO 降 TURN）退役；2/3/4 验证失败后恢复 |
| 4 度量分层 | **完成**（见 [escape-quality-metrics.md](escape-quality-metrics.md)） |

| 门禁 | 值 |
|---|---|
| `npm run test:4` | 209/209 PASS |
| CONTINUATION | 8/8（`death-category-continuation-eq-full`） |
| Capsule-all | ACCEPTED `76d27ff57304532ad1833da74f89f930ec07b66b5ce6b139d888c7f6a8880d64` |
| vs R21 | 50→87，S2D=0，`NET_IMPROVEMENT_NO_REGRESSION` |
| vs R22c | 75→87，S2D=0，`NET_IMPROVEMENT_NO_REGRESSION` |
| vs R23b | 87→87，S2D=0，`NO_NET_CHANGE` |
| focused 报告 | `native-poison-death-escape-quality-full` |

## 性能验证（相对 R23b，不得落后）

| 门禁 | R23b / 基线 | Escape Quality | 判定 |
|---|---:|---:|---|
| Capsule-all `totalRuntimeMicros` | 45,286,555（≈45.3s） | **44,279,284（≈44.3s）** | **更好**（−2.2%） |
| Capsule-all `capsuleRuntimeMicros` | 21,838,111 | **21,313,009** | **更好** |
| `npm run benchmark:multi-frame-risk` | PASS | **PASS**（combined P95 1235 < 3108；joint 106551 < 150000；hotAlloc=0） | 不落后 |
| `npm run benchmark:search-frontier` | adaptive P95 1405µs（文档基线） | **PASS**（adaptive P95 **1126µs**；480/480；hotAlloc=0） | 不落后 |

Capsule fingerprint（EQ）：`76d27ff57304532ad1833da74f89f930ec07b66b5ce6b139d888c7f6a8880d64`  
R23b 对照 fingerprint：`98043570462d9e5a046fad3b65c41b5f67ea30df5b8a2fb5dffdc9e301ba2a49`

结论：**无性能退化**；端到端墙钟与两个固定 microbenchmark 均未落后于 R23b / 既有门限。

## Quality 字典序（已落地）

高优先（committed only）：`proof` → `stillExposedAtDeadline`  
然后 Soft fatal / escapeSlack / mobility / robust…  
`successorSlack` / `branches` 仅在 mobility 近平局时作细 tie-break。

Domination / safeFloor 在 publish quality 后重算，避免 Soft mass 把清出 GO 标成 dominated。

## Phase 3 退役尝试摘要

| 项 | 结果 |
|---|---|
| 3.1 清出+朝向 → 降爆圈 TURN | **退役成功**（574bb 由 Quality 覆盖） |
| 3.2 清出+未朝向贴敌 → 降 GO | 失败（826c S2D）；**保留** |
| 3.3 corridorClearing | 失败（64c3 CONT）；**保留** |
| axisClearing / contactPrep | **保留**（未再拆） |

## 报告名

- focused：`native-poison-death-escape-quality-p3`
- CONTINUATION：`death-category-continuation-p3-final`
- vs R23b：`full-regression-eq-p3-vs-r23b`

工作源以 `sourceIdentity()` 为准。
