# DD10 Overview：动态语料与平台运行闭环

状态：DD10 COMPLETE（详细设计），2026-07-16。实现尚未开始，发布状态仍为 `NOT_RELEASE_ELIGIBLE`。

## 1. 触发原因

DD9 完成后，持续增长的 v1 历史头、真实 v25/v26 平台运行和新建v2 tank计划暴露了六类不能留给实施临时处理的问题：

1. 244 是有效不可变快照，但不是永远的历史总数；
2. DD9 DSU 的 groupId 随成员列表变化，不能直接用于 append-only head；
3. 未观察到敌方施法被错误编码为 `none`，历史技能身份缺 provenance；
4. 平台真实 SCRIPT_ERROR 证明 `Math.imul` 不可用，而生产合同仍要求它；
5. simulate、发布、challenge、下载和分析尚无统一事务/错误/保存合同；
6. v1、v2及未来tank使用不同key，但候选身份、secret隔离、限流、语料分母和回滚尚未按tank隔离。

DD10 不修改 Minimax、InformationState、Hard、Proof 或 Risk 的量词，只修复证据与平台执行边界。

## 2. 产物

| 产物 | 作用 |
|---|---|
| [rolling-corpus-contract.md](rolling-corpus-contract.md) | append-only Ledger、动态 Head、不可变 Snapshot、稳定 Cohort、技能/终局 provenance |
| [platform-operations-contract.md](platform-operations-contract.md) | validate→simulate→publish→challenge→download→analyze→ingest 状态机 |
| [dd10-platform-run.schema.json](dd10-platform-run.schema.json) | run manifest、阶段、artifact、错误和 attestation 机器 schema |
| [dd10-corpus.schema.json](dd10-corpus.schema.json) | Ledger/Policy/Head/Snapshot/Cohort/Forward机器schema |
| [dd10-platform-capability.schema.json](dd10-platform-capability.schema.json) | 平台JS/API/限制事实与证据schema |
| [dd10-tank-registry.schema.json](dd10-tank-registry.schema.json) | v1/v2/未来tank的非密钥profile、secretRef、skill与branch baseline schema |
| [artifact-lineage-contract.md](artifact-lineage-contract.md) | Build→Candidate→Run→Evidence唯一hash血缘与发布字节同一性 |
| [dd0-dd10-consistency-audit.md](dd0-dd10-consistency-audit.md) | 前序 owner 与 DD10 修订的一致性审计 |

## 3. 已关闭的设计冲突

| 冲突 | DD10 处理 |
|---|---|
| 固定 244/252/255 | 数量只从 MatchLedger 派生；244 保留 Snapshot |
| 追加后旧 split 漂移 | `APPEND_STABLE_SESSION_V1`，关闭 cohort 永不改角色 |
| enemy skill null→none | `UNKNOWN` + evidence enum，严格重建不跨局回填 |
| 新 match 永久 quarantine | 已查看且非 forward 的数据进入 `DISCOVERY_APPEND` |
| Math.imul 平台崩溃 | capability profile 标 absent，生产 BitMath 改为 shift/add |
| Poison parity 全未知 | executed cadence closed；empty repoll 单独保持 UNKNOWN |
| result=error 无 fixture | SCRIPT_ERROR adapter 支持缺失非故障方 runtime |
| 发布前 simulate 仅建议 | 新 hash 无 SimulationAttestation 时 publish 硬失败 |
| POST 网络歧义盲重试 | context/matches reconciliation 后再决定重试 |
| 技能报告表/文不一致 | 同 machine analysis 生成/校验，schema/version/hash绑定 |
| 单key/默认tank脚本 | 显式TankProfile；key只通过secretRef；每次调用核对GET context identity |
| 多key绕过限流 | ownerScopeId共享调度；未知owner关系保守串行 |
| v1证据污染v2发布 | Candidate/Run/Snapshot/Forward/rollback按profile和tank绑定 |
| 新tank可能无回滚基线 | 先归档main；确无代码才允许独立授权的`FIRST_PUBLISH_NO_ROLLBACK` |

## 4. 性能影响

DD10 平台 runner、JSON、HTTP、hash、报告和 Ledger 全部离线执行，不进入 3 秒生产路径。生产变化只有：

- 移除不可用的 `Math.imul`；
- 构建产物引用平台 capability profile；
- 无新增日志、网络、文件、replay 或对手命名数据；
- Poison 确定 cadence 可减少不必要的 RuleVariant/Value interval 分支。

TypedArray SoA 设计保持，平台仍需 source/minified benchmark 选择容量和性能参数。

## 5. 两级发布语义

Forward real battle 必须使用已发布代码，因此不再使用“所有 forward 通过后才首次 publish”的循环定义：

```text
CANARY_PUBLISH_ELIGIBLE
  G0..G9 + G10A frozen + exact-artifact simulation
  + verified rollback，或显式无基线首次发布例外
  + profile-bound authorization

RELEASE_ACCEPTED
  published exact hash + G10B closed forward batch + G11
```

Canary publish 会影响排名，必须显式授权并保存 intent/response/verify；它不是最终 release acceptance。

## 6. 当前实施阻塞

- 统一 `agentank-ops` CLI 尚未实现；
- 多TankProfile Registry、secret adapter、identity/ownerScope锁与跨profile污染测试尚未实现；
- 现有下载/分析脚本尚未迁移原子写、hash、provenance 和错误分层；
- append-only ledger/head/cohort store 尚未实现；
- platform capability suite 尚未形成可复现 manifest；
- v2 TankProfile需在用户创建新tank后由context登记；CandidateManifest、production bundle 和 ForwardBatch 尚不存在。

因此准确状态是：

```text
DD0_DD10_DESIGN_COMPLETE
PLATFORM_OPS_IMPLEMENTATION_NOT_STARTED
V2_RELEASE_NOT_ELIGIBLE
```
