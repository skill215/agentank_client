# DD8 Overview 与一致性审计

状态：DD8 COMPLETE（详细设计），2026-07-16；本文记录当时的DD9准入，DD9现已完成。

## 1. 阶段结论

DD8 已把性能从“尽量快”冻结为三个可审计合同：

```text
Cache Inventory
  11个canonical cache、完整key/cutoff/collision/lifecycle/off语义

RuntimeController
  Capability选择计量、累计work/time、NORMAL/DEGRADED/FALLBACK/EMERGENCY、不可缩减Hard核心

Production Build
  固定输入生成、单skill专门化、strip、source/minified、bytes/memory manifest
```

1.5秒等价预算的fallback是整局永久latch；fallback仍运行benchmark-selected缩减Minimax，深度不写死为2。当前无已确认安全墙钟，使用版本化校准work counter；首个保守build在2.5秒等价预算进入Emergency并保留500ms独立reserve，单callback约1500ms watchdog另设更早安全界。约3秒仅作证据参考，不作为可用deadline。

## 2. 产物

| 产物 | 冻结内容 |
|---|---|
| [cache-inventory.md](cache-inventory.md) | canonical names、key matrix、cutoff、collision、replacement、mode行为 |
| [dd8-cache-inventory.json](dd8-cache-inventory.json) | 11 cache的design-executable机器清单和alias迁移 |
| [runtime-fallback-contract.md](runtime-fallback-contract.md) | Capability选择clock/work counter、1500/2500等价门、callback watchdog、reserve、fallback Minimax、Emergency |
| [production-build-contract.md](production-build-contract.md) | build函数/CLI、生成、专门化、strip、differential、manifest |
| 本文 | DD8退出门、冲突审计与DD9准入 |

## 3. 退出门

| DD8退出条件 | 设计结果 | 说明 |
|---|---|---|
| Cache inventory/key matrix唯一 | PASS | 11 canonical ids；JSON字段/alias闭合 |
|关闭任一cache语义不变 | PASS | 每cache有direct recompute/cold start；full=miss/replace |
| strict cutoff资格明确 | PASS | complete bounds/coverage/full BR后才cutoff |
| normal/fallback共享Hard语义 | PASS | Fast/committed closure/Terminal/Hard不可缩减 |
| 1.5秒后快速fallback | PASS | 当前按校准work limit永久latched，当前callback工作量也计入；未来wall-clock模式保持同语义 |
| fallback仍是Minimax | PASS | pure interval + tactical closure，depth由benchmark选择 |
| EmergencyReserve不被search/cache占用 | PASS | 独立arena，初始500ms/2.5秒门 |
|同星runtime受控 | PASS |保守terminal policy+不解除fallback+runtime cost soft term |
| production剥离完整 | PASS | Reference/simulator/replay/v1/log/命名数据deny list |
| source/minified可判一致 | PASS | state/event/Hard/Proof/Value/Policy/Plan/runtime全字段差分 |
|构建可重复/可打包 | PASS |生成函数+薄CLI+canonical manifest/fingerprint |

这是详细设计门。没有JavaScript v2实现、平台source/minified benchmark或明确script byte limit时，不能把这些PASS解读为runtime/profile/release execution PASS。

## 4. Cache一致性审计

### 4.1 名称冲突关闭

- `PhysicsTT`规范化为`PHYSICAL_VALUE_TT`，只存physical stage value；
-物理transition patch只属于optional `TRANSITION_CACHE`；
- `InformationTT/ValueTT`合并为`INFORMATION_VALUE_TT`；
-matrix root reuse统一`STAGE_MATRIX_CACHE`，不再有未登记`RootCache`；
-`REGRET_WARM_CACHE`只warm start，default off；
-current HazardTimeline/HardViableSet是working set，不是可淘汰cache。

`OI-ARCH-007`关闭。

### 4.2 Semantic key与预算

`SearchSemanticProfileId`定义value是什么并进入ValueSearchKey；`SearchBudgetProfileId/runtimeMode`只决定算多少。fallback若改变Eval/horizon/basis，必须显式换semantic id/depth；不能用mode隐藏语义变化。

这样NORMAL/FALLBACK可以共享已完成相同horizon的TT/Proof，同时不会把较浅/不同evaluator结果错当同值。

### 4.3 事实与cache

active projectile/bomb、Possibility residual、root committed hazard和Plan header不能因cache满被淘汰。ENTITY_PLAN cache只存可重算trajectory/blast/escape派生；miss不会让实体消失或返回“无危险”。

## 5. Runtime一致性审计

```text
NORMAL -> DEGRADED -> FALLBACK(latched) -> EMERGENCY
```

-completed callbacks + current callback work共同计入accounted budget；未来wall-clock模式保持同语义；
-new match只有明确frame/fingerprint证据才reset，歧义保留累计；
-当前无已确认安全wall clock时固定使用校准work counter；若未来wall clock异常则切回匹配counter profile或fail closed；
-每个solver固定batch，batch P99必须装入remaining reserve；
-1500ms等价work limit后不可恢复normal，即使当前局形势简单；
-2500ms等价work limit后不继续general search；
-单callback约1500ms watchdog使用更早的独立work安全界；
-Emergency不依赖cache/Plan/OpponentModel，仍做root facts/committed Hard/emit；
-3秒comparator未知，因此不在2999ms尝试最后搜索。

同星时平台按runtime决胜；我们的默认仍按自身runtime更高保守。性能优化没有被降格为平均速度指标，而是终局正确性的一部分。

## 6. Fallback冲突关闭

| 潜在冲突 | DD8处理 |
|---|---|
| fallback只有2步 | depth是BENCHMARK_SELECTED profile参数，不写死2 |
| fallback变贪心 |仍运行pure Minimax/interval + TacticalClosure |
|缩深截断子弹/bomb | committed closure独立于depth |
|跳过每action Hard省时 |禁止；所有可提交action先Hard |
|低概率world在fallback删除 | lossless support或显式incomplete |
|缓存miss返回旧安全动作 |直接重算/当前root generation校验 |
|Emergency等于普通fallback |Emergency仅极限reserve路径，独立预分配、deterministic emit |

## 7. Build一致性审计

-构建由函数/薄CLI生成，不再手工编辑一个巨型bundle；
-RuleCorpus只生成confirmed/common handler，unknown概率保留interval/support；
-每个own skill输出一个专门bundle，敌方八descriptor保留但节点只查实际id；
-Table/Generated evaluator在同registry下A/B，production只能选一个；
-TypedArray bytes、scalar width、cache/emergency容量由manifest公式求解；
-Reference/replay/simulator/framework工具/v1/log/命名对手全部strip；
-生产拒绝Worker/async/Math.random/float semantic arrays/hot Map/Set；
-普通单文件`onIdle`，无外部runtime dependency；
-source/minified不只比较最终动作，而比较完整semantic fingerprint。

平台engine和exact byte limit仍未知，BuildManifest必须标`PLATFORM_LIMIT_PENDING`，不能拿framework参考值代替。

## 8. 跨文档冲突审计

| 主题 | 原冲突 | 当前处置 | 权威 |
|---|---|---|---|
| cache清单 |多文档名字/owner不一 |11 canonical JSON + aliases | Cache Inventory |
| PhysicsTT |value还是transition不清 |Physical Value与Transition分离 | Cache Inventory |
| runtimeMode cache key |预算变化导致全cache失效 |semantic/budget profile分离 | Cache + Runtime |
| fallback depth |v1 2-round常量影响v2 |明确不写死，benchmark选择 | Runtime |
| 1.5/2.5/约3秒 |MC/reduced/search混杂 |1500/2500为校准等价门、3000仅reference；单callback 1500 watchdog独立 | Runtime |
| cache与Emergency |cache挤占安全内存 |Emergency独立，cache不可借用 | Runtime/Manifest |
| build skills |八own模块或dynamic plugin |one own emitter + eight enemy descriptors | Build/Skill |
| production日志 |Opponent/Plan需要日志 |event model保留，字符串/log strip | Build/Opponent |
| source/minified |只比action掩盖错误 |全semantic differential | Build |
|多线程 |可能用于性能 |明确单线程同步，不保留Worker | Build |

未发现需要回退DD1–DD7的语义冲突。旧cache文档、memory layout、hybrid solver和roadmap已同步canonical names与profile key拆分。

## 9. 未关闭但不阻塞DD9

- cache entry counts/ways、normal/fallback depth、batch/iteration、degraded trigger：必须由实现benchmark选择；
-2.5秒/500ms reserve须平台P99验证，只可保守提前；
-平台JS engine、cold start和exact script byte limit：`OI-R3-008`，release blocker；
-TypedArray/explicit stack需production source/minified平台复核：`OI-R3-005`；
-Table/Generated evaluator、optional caches净收益：实现A/B；
-具体profile参数不能使用DD9 frozen split调优；
-尚无v2 production bundle，故DD9最终release report必须如实标NOT_IMPLEMENTED/NOT_RELEASE_ELIGIBLE。

## 10. DD9准入

DD9可以开始，因为：

1. historical/counterfactual runner可引用唯一Rule/Fast/Proof/Value语义和build fingerprints；
2.所有cache/runtime/build版本可进入immutable corpus/result manifests；
3. factual、TRACE/MODEL、ROBUST/STRICT标签已有准入层级；
4. v1 codeHash支持矩阵和244局split可独立冻结；
5.双向反事实能在分叉后使用Reference/Fast/policy adapter，不消费真实suffix；
6. release gate现在有明确cache-off、fallback、bytes、source/minified和platform forward证据槽；
7.由于本项目仍是设计阶段，DD9可以完成验证合同/manifest/report模板，但必须把缺少实现/平台运行列为真实阻塞，不能伪报发布通过。

DD9应依次冻结legacy corpus manifest/splits、counterfactual schema/量词、benchmark/release matrix，最后做DD0–DD9全局一致性审计。
