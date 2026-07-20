# IMP9 官方 Simulation 与受控 Canary Overview

状态：`OFFICIAL_SIMULATION_FAILED / CANDIDATE_NOT_RELEASE_ELIGIBLE / NO_PUBLISH / NO_CHALLENGE`，2026-07-17。

## 结论

IMP8 前置已 `ACCEPTED`，实时 v2 context、tank 7214、poison、main、三个预注册 bot/map 清单和同 profile rollback 均验证通过。官方 cold-smoke 使用了冻结 Candidate 的精确 minified SHA-256 `45a96d1c4c7a2b5ae7957a2c7813fa1cc2840a9d1937f164e5df3fb982d2eea4`，但平台在 3012ms 返回 `timeout`，winner 为对手。

零容忍 runner 在第一例立即停止，因此 pressure-arena 与 robustness-random 没有执行，也没有生成 SimulationAttestation。总官方请求为 2：一次 context GET 和一次 simulate POST。publish POST、challenge POST、blind retry 均为 0。

全量 271/271 测试通过，但 Exact Candidate Simulation 门为 `FAIL`。最终 Gate fingerprint 为 `9fb49d4bc0cb37386b871e2714ed2bb40bd3bd99e000a111ea9b0f570ff5788d`；Acceptance 明确为 `REJECTED`，fingerprint `caa17fbcf392f2b2fbc140c8669c09b534c1b669289ac04954043219ad96f4a4`。失败证据位于 [simulation-run-report.json](../../battle-records/tanks/v2/runs/imp9-imp8-v2-a5ce6f8ef59abb61/simulation-run-report.json)，fingerprint `4a1cf68f71dde2315fbc711b8ec0a1329c7fe4182b461d6b6f206926f5862e15`。

## 门状态

| 门 | 状态 | 事实 |
|---|---|---|
| Exact simulation | FAIL | cold-smoke 使用精确字节，但 3012ms timeout |
| Live context/suite | PASS | tank/skill/branch 与三例 bot/map 清单验证通过 |
| Rollback | PASS | v2/main baseline hash `7daf591e…48b2` 逐字节可用 |
| Profile/hash isolation | PASS | wrong key、旧 attestation、错误 hash、跨 profile 均 fail closed |
| Publish authorization | BLOCKED | 没有 publish 授权与 intent |
| Publish reconciliation | BLOCKED | 未 POST，未进行发布后 GET |
| No challenge | PASS | client 无 challenge 方法，请求数 0 |

## 工具链修正

- IMP9 wrapper 现在复用 `load-agentank-local-env.sh`，与 platform/IMP2 一致加载本地 key；key 不进入报告。
- `reconcile-simulation` 会把中途停止的官方 suite 转换为确定的 PASS/FAIL/missing-case 报告。失败不会再丢失成 `NOT_RUN`。
- readiness 能识别失败 context/response，记录 `SIMULATION_RELIABILITY_FAILURE`；离线 preflight 本身仍解析 0 个 secret、发出 0 个请求。
- Gate 把可靠性失败标为 `FAIL`，而不是可被其他 PASS 抵消的 BLOCKED。

## 后续边界

当前 Candidate 不允许 publish。不能原地把 D3 改成 D2，也不能对同一失败 hash 盲重试。正确的下一轮是把本次 3012ms 平台证据送回 Discovery，预注册更严格的平台 runtime/fallback 候选计划，生成新的 Candidate identity，重新执行 Calibration、G10A、IMP8 acceptance，再由用户单独授权新的官方 simulation。

IMP9 失败后的离线诊断已使用冻结 V1/V2 精确脚本，在 244 个历史场景上完成 1,952 场双向换边/技能交叉对战，并对 24 个失败做逐帧镜像分析。结果确认 PersistentPlan、InformationState 深搜、递归 ForcedWin 和平台 runtime fallback 尚未在生产路径完整闭合；详见 [V1/V2 精确脚本成对失败诊断](v1-v2-exact-paired-failure-diagnostic.md)。该诊断属于 Discovery，不改变本 IMP9 的 `REJECTED` 状态。

本轮没有 publish 授权，因此不存在 intent 或远端代码变更；IMP9 明确保持非发布状态。
