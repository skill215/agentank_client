# DD10 构建、候选、运行与证据血缘合同

状态：DD10 最终实施前规范，2026-07-16。本文统一 BuildManifest、CandidateManifest、RunManifest、SimulationAttestation 和 ReleaseEvidenceReport；禁止各工具复制同名字段后独立解释。

关联：`DEC-0070`、`DEC-0072`、`DEC-0080`、`DEC-0082` 至 `DEC-0089`；[production-build-contract.md](production-build-contract.md)、[platform-operations-contract.md](platform-operations-contract.md)、[release-gate-report.md](release-gate-report.md)。

## 1. 唯一血缘

```text
source modules + generated inputs
  -> BuildManifest
  -> CandidateManifest
  -> RunManifest[]
  -> ReleaseEvidenceReport

CandidateManifest
  -> SimulationAttestation[]
  -> PublishIntent/PublishVerification
  -> ForwardBatch
```

每层只拥有新增事实，下游通过hash引用上游，不复制上游全文作为第二权威。

| Artifact | 唯一owner | 新增事实 | 不得拥有 |
|---|---|---|---|
| BuildManifest | build generator | source/minified hash、生成输入、ABI/容量、strip/differential/bytes | corpus角色、发布授权、平台对局结果 |
| CandidateManifest | candidate freezer | 选定build、发布字节、profile、snapshot、test plan、rollback候选 | 可变“latest”路径、运行结果 |
| RunManifest | platform ops runner | 某次validate/simulate/publish/challenge/download/analyze状态与artifact | 修改candidate参数或重新选择发布字节 |
| SimulationAttestation | simulation qualifier | 精确发布字节在指定suite/capability/ruleset下的结果 | 对不同hash的继承资格 |
| ReleaseEvidenceReport | release gate evaluator | G0–G11证据引用、分母、结论 | 新规则或软参数 |

`ReleaseCandidateManifest` 是旧称，当前规范名唯一为 `CandidateManifest`。

## 2. Canonical hash

所有manifest使用`CANONICAL_JSON_V1`：RFC 8785/JCS兼容子集、UTF-8、对象key canonical排序、只允许JSON安全整数、字符串、布尔、null、数组和对象；禁止浮点、NaN、Infinity、locale格式和绝对工作区路径。

一般manifest计算fingerprint时删除对象顶层自身的`fingerprint`字段，其他语义字段全部参与。BuildManifest和CandidateManifest的`buildId`/`candidateId`是fingerprint的纯派生展示字段；为避免自引用循环，它们也从各自fingerprint payload排除：

```text
defaultFingerprint   = SHA256(CANONICAL_JSON_V1(manifest - fingerprint))
buildFingerprint     = SHA256(CANONICAL_JSON_V1(BuildManifest - fingerprint - buildId))
candidateFingerprint = SHA256(CANONICAL_JSON_V1(CandidateManifest - fingerprint - candidateId))
```

ID只由fingerprint派生：

```text
buildId     = "bld_"  + fingerprint[0..23]
candidateId = "cand_" + fingerprint[0..23]
```

`runId`是操作实例ID，不是语义fingerprint；RunManifest仍必须保存自身fingerprint。相同CandidateManifest重复冻结必须得到相同candidateId。

## 3. BuildManifest 到 CandidateManifest

CandidateManifest必须引用：

```text
buildManifestPath/buildManifestSha256/buildId
targetTankProfileId/targetTankId/targetSkillId/branch
sourceSha256/minifiedSha256
publishArtifactKind
publishArtifactSha256
publishArtifactBytes
ruleset/ABI/feature/weight/search/runtime/memory/cache hashes
platformCapabilityProfileId/hash
corpusSnapshotId/hash
candidateTestPlanId/hash
rollbackCandidateId/publishArtifactSha256
rollbackMode
forwardCollectionNotBefore
fingerprint/candidateId
```

`publishArtifactKind`只能是`PRODUCTION_SOURCE`或`PRODUCTION_MINIFIED`。默认选择`PRODUCTION_MINIFIED`；选择source必须在CandidatePlan记录原因。`publishArtifactSha256`必须等于所选BuildManifest字段，不能是重新读取后临时压缩的第三份代码。

Candidate freezer按hash复制发布artifact到candidate目录。后续所有平台请求只读取该只读副本；源模块或build输出变化不会静默改变candidate。

Candidate的own-skill specialization必须与目标TankProfile的`PLATFORM_CONTEXT` skill一致；不同tank即使使用同一源码也生成不同CandidateManifest。`rollbackMode`通常为`VERIFIED_BASELINE`；平台无既有main代码时才允许显式`FIRST_PUBLISH_NO_ROLLBACK`，并由平台运行合同施加额外授权和simulation门。

## 4. Simulation 与发布字节同一性

最终强制SimulationAttestation必须绑定：

```text
candidateId
publishArtifactKind
publishArtifactSha256
suiteVersion
rulesetVersion
platformCapabilityProfileHash
case request/response artifact hashes
qualifiedAt/verdict
```

可读source simulation只能作为诊断。若最终上传minified，则至少一轮完整强制suite必须直接发送minified的精确UTF-8字节；source通过不能替代minified attestation。

发送publish前重新计算请求`code`字节hash，必须等于`publishArtifactSha256`。发布后GET返回代码时按UTF-8原字节或平台明确的规范化规则核对；若平台只返回文本且会规范化换行，CapabilityProfile必须先冻结`publishedCodeHashNormalizationId`，否则状态为`PUBLISH_VERIFY_INCOMPLETE`。

## 5. RunManifest

RunManifest引用tankProfileId/tankId、candidateId/fingerprint和publishArtifactSha256。TankProfile、Candidate target、SimulationAttestation与GET context必须完全一致；任何镜像字段不等即`LINEAGE_MISMATCH`，不得采用“Run中较新值”。同一bundle在两个tank上使用时只允许共享上游BuildManifest；从CandidateManifest开始必须分叉血缘。

每次状态推进原子写新revision：

```text
run-manifest.r000.json
run-manifest.r001.json
...
run-manifest.json -> latest committed revision
```

revision保存`previousRevisionSha256`，形成单向链。恢复只能从最后一个schema/hash/previous均有效的revision继续。

## 6. Evidence 与发布

ReleaseEvidenceReport中的每个PASS必须引用：

```text
candidateId/publishArtifactSha256
gateId
runId + runManifestSha256
evidenceArtifactIds/hashes
sample denominator
test/benchmark/analyzer versions
verdict
```

两个candidate即使源码相似也不能共享结果；只有合同明确允许的不可变规则fixture、平台能力事实或历史CorpusSnapshot可以作为共同输入。SimulationAttestation、Frozen执行结果和ForwardBatch都绑定candidate。

## 7. 失效与回滚

以下任一变化产生新candidate并使旧simulation/frozen/forward运行结果不可继承：

- publish artifact字节；
- ruleset、ABI、feature/weight/risk、search semantic、runtime或memory profile；
- capability profile中影响代码执行的事实；
- minifier版本/选项；
- candidate test plan的强制suite。

仅增加不影响语义的报告、注释或Discovery artifact，不修改CandidateManifest。回滚必须指向既有CandidateManifest和其精确发布字节，并重新核对当前平台能力/规则时效；禁止从文件名猜旧版本。

## 8. 验收门

- 同输入重复build/candidate freeze得到相同hash；
- source/minified/publish三者关系唯一；
- 强制simulation请求字节hash与publish请求字节hash相同；
- Run任何镜像字段篡改都触发lineage failure；
- revision断链、artifact hash缺失或candidate交叉引用阻塞恢复；
- ReleaseEvidenceReport不能引用其他candidate的运行结果；
- production bundle不含任何manifest、路径、candidateId或证据字符串。
