# V2 Candidate 本地发布资格合同

状态：`ACTIVE / PRE-SIMULATION HARD GATE`，2026-07-17。

本文补充 [platform-operations-contract.md](platform-operations-contract.md)，规定任何新的 V2 Candidate 在官方 simulate 和 publish 前必须完成的 V1/V2 对照、性能调优和证据绑定。本文独立版本化，不修改已经绑定 IMP0–IMP9 历史验收的中央合同 hash。

## 1. 强制顺序

```text
结构修复版完整 V1/V2 对战（Pre-Tuning Arena）
  -> 预注册 fallback 参数矩阵
  -> 固定输入 V1/V2 性能 benchmark
  -> 每个参数候选的小规模玩法保护门
  -> 选择唯一 runtime profile
  -> 调优后完整 V1/V2 对战（Post-Tuning Arena）
  -> 本地资格报告
  -> 冻结 Candidate 并绑定精确 publish bytes
  -> 官方 simulation
  -> publish authorization
```

缺少任一步，IMP9 preflight 必须返回 `LOCAL_V1_V2_QUALIFICATION_MISSING` 或 `LOCAL_V1_V2_QUALIFICATION_NOT_BOUND`。性能提升不能抵消 Hard、错误、trace 缺失或未经 review 的玩法退化。

## 2. Pre/Post V1/V2 Arena

两个完整 Arena 均必须：

- 使用冻结 V1 字节及其 SHA-256；
- 从当前动态 V1 corpus 构造地图、出生位和历史星序列，不写死战斗数量；
- 至少两个 repetitions；
- 每张地图运行原技能换边和技能交叉换边四格；
- 串行运行，禁止用并发结果替代，因为 V1 会读取 wall clock；
- 报告源码 hash、参数 fingerprint、模拟器 commit/偏差和所有严格不变量；
- Post-Tuning 必须使用 `--trace actions`，每个模拟帧都有一条记录。

逐帧记录至少包含双方 action 与本地 callback 时间。V2 还必须包含 root、InformationState 完整性、selected Hard、允许动作数、Proof、完成深度、节点数、得分和 runtime mode。某一 seat 未收到 callback 时，该 seat 为 `null/HOLD_NO_CALLBACK`；这表示 freeze、poison cadence 或调度 HOLD，不是 trace 丢失。完整 V2 候选分数、状态和 replay 只对分层失败样本使用 `--trace full`，不强制写入全部对局。

Post-Tuning 的强制零容忍项：

- avoidable Hard reject = 0；
- root restore failure = 0；
- tracked hot allocation = 0；
- V2 timeout/error = 0；
- 每场 `actionTrace.length == frames`，frame index 连续；
- 参数 fingerprint 精确绑定性能矩阵的 selected profile。

## 3. 固定输入性能 benchmark

互动对战的不同动作会产生不同后续局面，因此不能单靠“每局总耗时”证明同局面性能。benchmark 必须先从预注册历史场景采集双方逐帧 ObservedRoot 序列，再将完全相同的序列串行回放给冻结 V1 和每个 V2 参数候选。

必须记录：

- context corpus fingerprint、场景数、序列数、观察帧数和 repetitions；
- 构造时间，以及单 callback 和单序列的 P50/P95/P99/max/total；
- 每个候选的全部 work threshold、frame floor 和四档 depth/node/proof/matrix 预算；
- runtime mode 分布、Hard/root/allocation 错误；
- 相同输入在 V1/V2 执行前后保持 byte fingerprint 不变。

性能候选必须同时满足：固定输入 V2 total < V1 total、V2 callback P95 < V1 P95、严格不变量为零。不能选择只在互动战局中因为更早死亡或更少 callback 而显得更快的配置。

Frame floor 是 work counter 的第二触发器，不是把平台 3 秒或 128 帧平均分配。Fallback 必须继续运行非零 Minimax；Emergency 可以关闭 Value/Proof，但不得关闭物理导入、Terminal、Hard、已提交危险闭包或最终动作门。

## 4. 参数选择与玩法保护

参数候选、选择顺序和小规模允许退化值必须在 benchmark 前写入计划。选择先排除性能或严格门失败者，再按预注册顺序比较原生胜局与耗时。最快候选不自动获胜。

Post-Tuning 必须与 Pre-Tuning 按 `matchId` 报告 `LOSS→WIN`、`LOSS→LOSS`、`WIN→LOSS`、`WIN→WIN`，并单独报告原生 poison V2 对 stun V1。只要原生净胜局下降或存在 `WIN→LOSS`，本地资格报告必须标记 `EXPLICIT_USER_REVIEW_REQUIRED`；不得由脚本自行认定性能收益足以接受玩法退化。由于 V1 wall-clock fallback 会导致重复波动，review 同时读取 repetition 稳定性，不能把所有转移都归因于参数。

## 5. 证据与 Candidate 绑定

重复入口：

```text
./tools/v1-v2-runtime-matrix.sh --progress-every 16
./tools/v1-v2-working-arena.sh --repetitions 2 --trace actions \
  --performance-report <runtime-matrix-report.json> --progress-every 64
./tools/v2-local-qualification.sh \
  --pre <pre-tuning-overview.json> \
  --performance <runtime-matrix-report.json> \
  --post <post-tuning-overview.json>
```

本地资格报告必须保存 requirements/contract/tool/source/parameter/input artifact 的 hash。它首先是 `PENDING_FROZEN_CANDIDATE`；Candidate 冻结后还必须产生 attestation，绑定 candidateId、CandidateManifest fingerprint 和精确 `publishArtifactSha256`。IMP9 官方 simulation 只接受同一绑定，不能复用另一个源码、参数或 minified hash 的本地报告。

## 6. 证据边界

本地绝对时间不是平台时间。即使 V2 在固定输入和互动对战都比 V1 快，仍必须通过官方整局 3 秒 simulation；平台 timeout 会否决本地性能 PASS。简化模拟器的 bomb phase 等已知偏差继续显式保留，本地炸弹死亡不能升级为平台物理真值。
