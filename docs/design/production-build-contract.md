# DD8 Production Build、生成与剥离合同

状态：DD8 规范合同，DD10 平台能力修订，2026-07-16。冻结规则/ABI/技能/评分/容量生成、单文件组装、source/minified差分、离线代码剥离、bundle/memory manifest和可重复构建门；不在设计阶段伪定平台未知字节上限。

关联：`DEC-0023`、`DEC-0038`、`DEC-0040`、`DEC-0047`、`DEC-0059`、`DEC-0062`、`DEC-0080`、`DEC-0082`、`DEC-0086`、`DEC-0087`；`OI-R3-005`、`OI-R3-008`、`OI-PLAT-001`、`OI-PLAT-005`；[memory-capacity-manifest-schema.md](memory-capacity-manifest-schema.md)、[runtime-fallback-contract.md](runtime-fallback-contract.md)、[platform-operations-contract.md](platform-operations-contract.md)。

## 1. 产物类型

```text
REFERENCE_DEV
  ReferenceKernel、RuleVariant、可读trace、fixture adapters；永不发布。

BENCHMARK_SOURCE
  Fast+diagnostic counters+fault injection+profile hooks；永不发布。

PRODUCTION_SOURCE
  可读但已剥离离线模块的单文件onIdle bundle。

PRODUCTION_MINIFIED
  与PRODUCTION_SOURCE同语义的最终上传候选。
```

生产只有普通单线程同步JavaScript，入口`onIdle(me,enemy,game)`。不使用Worker、SharedArrayBuffer、异步任务、动态import、网络、文件系统或运行时依赖。

## 2. 构建流水线

```text
1. validate source manifests and RuleCorpus
2. select frozen RULESET/phase/terminal variants
3. generate integer ids/ABI/tables
4. generate own-skill specialized emitter + enemy descriptors[8]
5. generate Table/Generated evaluator candidate
6. solve capacity formulas and scalar widths
7. assemble deterministic modules
8. strip reference/replay/simulator/log/dev branches
9. emit PRODUCTION_SOURCE
10. minify with pinned tool/options
11. run source/minified semantic differential
12. run byte/init/memory/forbidden-symbol audit
13. emit build manifest/fingerprint
```

任一阶段失败不输出上传候选；不得沿用上一次成功bundle配新manifest。

## 3. 生成/打包接口

实现阶段必须提供可独立调用的函数和薄CLI脚本，而不是手工复制粘贴：

```text
validateRuleCorpus(input) -> validated model
generateIntegerAbi(model, capacityProfile) -> abi artifact
generateFastRuleTables(model, selectedVariants) -> rule artifact
generateSkillBundle(ownSkillId, ruleArtifact) -> skill artifact
generateEvaluator(evalMode, profileSet) -> evaluator artifact
generateMemoryManifest(artifacts, profile) -> manifest
assembleProductionSource(artifacts) -> source
stripDevelopmentCode(source, stripProfile) -> production source
minifyProduction(source, pinnedOptions) -> minified
verifyBuild(source, minified, manifest, fixtureSet) -> gate report
```

建议CLI职责名：`build-agentank`, `verify-agentank-build`, `print-agentank-manifest`。函数是语义owner，CLI只解析参数/写artifact；不得在CLI复制规则。本文定义接口，不在“先通过设计”的阶段实现这些脚本。

## 4. 生成输入

所有输入固定标识：

```text
Guide snapshot hash + official updates manifest
RuleCorpus fingerprint / RULESET_VERSION
phaseOrderId / terminalPolicyId
DD3 physical ABI + DD5 Fast ABI
State/Entity/Action/Event/Result/Policy/Proof/Matrix/Plan ABIs
FeatureRegistry/Eval/Strategy/Risk/Opponent versions
Cache inventory schema/fingerprint
Runtime profile version
MemoryCapacityProfile
ownSkillId
evaluatorMode
source template/module hashes
Node/minifier versions and exact options
platformCapabilityProfileId + calibration artifact hash
build salt for deterministic PRNG seeding
```

浮动URL、latest branch、当前时间、绝对路径、Git dirty内容和环境locale不能改变生成代码。build timestamp可放非语义外部报告，不能进bundle fingerprint。

`ownSkillId`不是命令行猜测值：首次为某TankProfile生成Candidate前，平台runner必须先以该profile的key读取GET context并取得`PLATFORM_CONTEXT`证据，再选择或生成相同ownSkillId的BuildManifest。BuildManifest本身可被具有同一已确认skill和相同全部构建输入的多个tank共享；CandidateManifest从此处开始按目标profile/tank分叉，并再次核对`targetSkillId == BuildManifest.ownSkillId`。因此共享构建不会导致共享simulation、forward或rollback资格。

## 5. RuleTable 与UNKNOWN build gate

-production只包含confirmed/common integer handlers；
-variant输出分歧的capability标unsupported/incomplete或禁用emitter；
-每个reachable action/event有RuleDefinition/handler/UNKNOWN行为；
-概率unknown但support完整可保留support+interval，不猜50/50/均匀；
-strict eligibility/assumption mask由生成器校验；
-source evidence文本、URL、match id不进入table；
-RuleCorpus/handler/table引用不闭合直接build fail。

## 6. 技能build matrix

八个own-skill production候选分别构建：

```text
own emitter/own strategy descriptor: exactly one skill
enemy physical/strategy descriptor: all eight compact ids
shared Fast/Hard/Search: one implementation
```

Dead-code elimination必须证明其他own emitters不存在；仍保留敌方八descriptor不代表节点枚举八技能。每个bundle运行own skill fixtures + 全部enemy skill descriptor lookup fixtures。

## 7. Evaluator build选择

TableEvaluator与GeneratedEvaluator由同一FeatureRegistry/profile source生成。production profile只能选择一个：

- correctness raw/score differential零错误；
-function/composite/full-state/source-minified净性能；
-exact UTF-8 bytes与init成本；
-zero-weight feature elimination；
-修改weights后的rebuild reproducibility。

Generated更快但bundle过大、或Table较小但P99过慢时，由多目标发布门决定；不能混合两者feature语义。

## 8. Capacity/Memory build gate

生成器求解所有整数AST公式和array bytes：

```text
MatchArena
PersistentArena
Root/FrameArena
SearchArena
CacheArena by canonical cache id
EmergencyReserve
total TypedArray bytes
estimated JS source/static table bytes
```

每个capacity标PLATFORM_CONFIRMED/RULE_DERIVED/BUILD_CONFIGURED/BENCHMARK_SELECTED等来源。位宽不足升级ABI/build profile，不能saturate。EmergencyReserve独立分配，CacheArena不能借用。

生产数值只有平台/benchmark证据完整时标`RELEASE_ELIGIBLE`；DD3 conservative profile仍是候选，不是平台上限。

## 9. Production strip allow/deny

### 必须剥离

- ReferenceKernel、RuleVariant runner、external simulator adapter；
- replay/download/SQLite/corpus/window/counterfactual工具；
- v1 source/LegacyPolicyAdapter/命名对手或match数据；
- source URLs/evidence prose/fixture comments；
- console/log/speech诊断、performance counters、fault injection；
-开发assert的长字符串和对象friendly codecs；
-benchmark clocks（只保留RuntimeController由Capability选择的counter或低频wall-clock实现）；
-未选Evaluator/own skill emitters/optional default-off cache代码（除非profile启用）。

### 允许保留

-生成整数Rule/Skill/Feature/Risk/Strategy tables；
-固定TypedArray/Arena/Cache代码；
-RuntimeController整数work counter；经Capability确认后可保留低频wall-clock检查；
-compact error/reason flags；
-可选、经A/B的小型通用legacy prior LUT及其version（默认不保证启用）。

## 10. Forbidden production constructs

静态/运行审计至少拒绝：

```text
eval / Function constructor / dynamic import
Worker / SharedArrayBuffer / Atomics
Promise/async scheduling in decision path
Math.random
Float32Array / Float64Array for semantic state/value
Map/Set/object allocation in declared hot functions
console.* / file/network/database APIs
runtime rule strings or skill string dispatch below root adapter
embedded replay/match/opponent identifiers
Math.imul as a required platform capability
```

根平台对象作为函数参数允许，进入Adapter后搜索不得保留引用。

## 11. Source/minified differential

两bundle在相同seed/input/profile下比较：

-Rule/ABI/build fingerprints；
-canonical Fast events/state/terminal/observation；
-Hard/Proof/Coverage；
-Value intervals/matrix gap/Policy entries；
-Opponent/Strategy/Plan state；
-cache-off/on语义；
-Runtime mode boundary synthetic clock；
-最终ActionProgram与PRNG state。

minifier不得mangle平台入口、依赖函数名的adapter或改变uint32、shift/add乘法与rounding。`Math.imul` 只允许出现在离线差分/拒绝能力 fixture，不得进入生产 bundle。任何semantic mismatch阻塞发布；不能只比较最终动作，因为相同动作可能掩盖内部差异。

## 12. Bundle与初始化

记录exact UTF-8 bytes、gzip仅作参考、parse/init/cold first callback、steady callback、TypedArray bytes和peak。平台脚本字节上限/引擎仍UNKNOWN时build状态`PLATFORM_LIMIT_PENDING`，不能因framework约200KiB参考值宣称通过。

初始化要求：

-只分配manifest arrays和小固定tables；
-大型派生table若lazy生成，成本计入first callback/runtime且结果确定；
-无JSON parse、regex扫描Guide、动态编译或网络；
-new match只generation reset/必要map build，不重复全bundle init；
-init异常进入最小Emergency路径，不发stale action。

## 13. BuildManifest

```text
buildId/fingerprint
artifactKind/sourceHash/minifiedHash
all input fingerprints/versions
ownSkillId/evaluatorMode/cache enable mask
SearchSemantic/Budget/Runtime profile ids
scalar widths/capacity values/source kinds
arena/cache/emergency bytes
exact bundle bytes/init measurements
platform code measurement=UTF8_BYTES, maximum=204800, warning=190000, headroom
strip audit and forbidden-symbol results
fixture/differential/benchmark report ids
platform engine/calibration ids
platform capability profile id/hash
publish artifact selection eligibility
releaseEligibility + blockers
```

Manifest使用canonical key order；相同inputs重复构建的source/minified hash必须相同。

## 14. 性能/发布参数选择

DD8不凭设计文本冻结depth/cache bytes。每个候选build按：

1. function correctness/perf；
2. composite high-water/fault；
3. full-state pipeline；
4. terminal/fallback/emergency；
5. full-game local league；
6. source/minified平台calibration。

只有correctness、no allocation/stale/overflow和runtime reserve先通过，才按depth/quality/win rate选。参数结果写manifest且不能用DD9 frozen test反向调参。

## 15. 必须测试

-同inputs可重复source/minified hashes；
-最终提交的minified artifact按UTF-8字节验证：204800通过、204801拒绝；多字节字符不得绕过；
-八own skill builds各只一个emitter、敌方八descriptor可查；
-RuleCorpus unknown/build gate；
-capacity formula/width/bytes与实际TypedArray一致；
-Reference/replay/simulator/log/v1/命名数据strip审计；
-forbidden constructs/hot allocation审计；
-Table/Generated选择前语义一致；
-source/minified全字段differential；
-optional cache off/default-off构建；
-cold init/new match/emergency；
-在不提供`Math.imul`的目标 sandbox 中完成 parse/init/fixture；
-exact bytes/platform limit status；
-manifest input/output闭合且release blocker不被忽略。

## 16. 冻结结论

构建不再是手工复制的大JS文件，而是一组可调用生成函数和薄脚本：从固定RuleCorpus/ABI/profile生成单skill专门化的普通单文件JavaScript，剥离所有Reference、回放、日志和命名数据，再以source/minified差分和manifest决定是否具有`SIMULATION_ELIGIBLE`资格。Candidate freezer再从BuildManifest唯一选择`PRODUCTION_SOURCE`或`PRODUCTION_MINIFIED`为publish artifact；血缘遵守[artifact-lineage-contract.md](artifact-lineage-contract.md)。真正发布还必须满足DD10对该精确字节的服务器simulation attestation、发布后读取核对和发布门状态机；BuildManifest单独不能授权上传或挑战。
