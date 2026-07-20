# DD4 规则校准报告

状态：DD4 校准报告，DD10 平台回放修订，2026-07-16。确认主规则、收敛可收敛的 RuleVariant，并为剩余未知规定 Reference/Value/Proof/Fast/production 行为。

关联：[reference-kernel-contract.md](reference-kernel-contract.md)、[dd4-rule-corpus.json](dd4-rule-corpus.json)、[rules-registry.md](rules-registry.md)、`DEC-0043` 至 `DEC-0046`。

## 1. 输入与方法

证据顺序严格为：Official Update > 当前 Guide > platform replay/simulation > external simulator > user/inference。

本轮使用：

- 2026-07-15 本地 Agent Guide 快照，SHA-256 `47016cf5...323d90`；
- 当前官方 Updates archive，对 2026-06-03 cooldown、06-06 bomb、06-15 bullet cone、06-18 teleport reveal、06-27 shield 两 hit 复核；
- 冻结 244 局 corpus，fingerprint `965dcfe9...e04e85`；
- DD10增量证据快照`ALL_252_20260716`中的30个完整poison applied→expired样本；该快照只作Discovery/evidence，不改写冻结244；
- 对选定 immutable replay hash 做 prefix-to-state/event slice；
- 外部 simulator commit `1ef804e...`，只做差异候选；
- DD1/2/3 的 phase、状态、event、incomplete 和 ABI 合同。

校准比较 canonical event、state patch、observation relation 和 terminal；不使用总体胜率或 v1 动作一致率决定规则。

## 2. 本轮新增确认

### 2.1 Overload 两弹几何

五个独立平台 replay 覆盖 up/right/down/left：

| match | record | direction | tank cell | member 0 first move | member 1 first move |
|---|---:|---|---|---|---|
| `mat_HW3D4d66XPm97IFz7` | 24 | left | [10,10] | [9,10] | [9,11] |
| `mat_3YVgw5Pezak5qdX6x` | 28 | right | [9,7] | [10,7] | [10,8] |
| `mat_8d1aKO08AtpFDKE7X` | 28 | down | [15,1] | [15,2] | [16,2] |
| `mat_HxFHRkraX3dE5DW0E` | 26 | up | [7,10] | [7,9] | [8,9] |
| `mat_KoPXFU71cY352oRSh` | 27 | right | [8,8] | [9,8] | [9,9] |

结论：member 0 从 tank cell 发射；member 1 的生成 cell 使用固定正轴垂直偏移：上下方向 `x+1`，左右方向 `y+1`；方向相同。两弹有独立 objectId、独立轨迹和独立 stop frame。该结果与外部 simulator 的 `overloadSpreadOffset` 候选一致，但升级资格来自平台 replay。`OI-R1-002` 可 CLOSED。

### 2.2 128 record 边界

`mat_JzdHcZRYeuH2cAy3S` 有 128 个 records。recordIndex 127 仍包含：

- seat0 创建 projectile；
- seat1 turn；
- projectile substep 0 和 1。

随后才按 3:3 同星、runtime 197ms 对 2160ms 判 seat0 胜。结论：平台允许完整执行 recordIndex 127 的 action/projectile/bomb/terminal phase，然后触发 frame-limit 结算。旧 `BEFORE_ACTION_128` active candidate 被否定，规范名改为 `AFTER_COMPLETE_RECORD_INDEX_127`。如果输入只提供模糊 `frame=128` 而没有 record/platformFrame 映射，仍返回 input-shape incomplete；这不是规则继续未决。

### 2.3 Shield 一次命中后仍存活

`mat_0PIB3JDbGLE9fuVgL` record 32 施放 shield；record 33 projectile 到达 shielded tank cell 后停止，tank 存活，shield 没有 hit 后立即 expired，直到 record 36 timed expiry。结合 2026-06-27 官方“两次 bullet hit”更新，冻结 `hitsRemaining=2`；bomb hit 按 Guide 一次消费整个 shield。共享同 substep 多 hit 的内部顺序仍归 R0 shared-resource variant，不影响 skill support 已关闭。

### 2.4 Bomb 相位与动作后位置

`mat_3lj0fhcHSdaLyCpCL` record 46 的顺序为 seat actions、projectile substep/土堆破坏、bomb explosion、tank bomb crash。结合 38 个 paired bomb 样本，确认：

- placed→exploded record 差为 10；
- action 与 star collection 在前；
- projectile 在 bomb 前；
- blast 使用 action 后 tank position。

外部 simulator 的 bomb-before-action 顺序继续标记 REJECTED。

### 2.5 Poison 相对 cadence

增量快照的30个完整`skill_applied`到`skill_expired`样本，在四个相对effect frame上全部呈现`ACT-HOLD-ACT-HOLD`，且HOLD不dequeue。样本跨越不同绝对platform frame parity，因此外部simulator的“绝对偶数帧执行”候选被拒绝。队列在effect中途变空后是否同帧重新poll、以及精确ready边界仍缺定向证据，保留独立`POISON_EMPTY_QUEUE_REPOLL_V1`。

## 3. 已确认主规则

| 域 | 结果 | strict 资格 |
|---|---|---|
| command 提交/下一帧执行、seat0→seat1 | CONFIRMED | 是 |
| timed expiry → star spawn → actions → star collect → projectile → bomb → terminal | CONFIRMED | 是；内部共享 variant 除外 |
| projectile 创建帧两 substep、逐 substep stop | CONFIRMED | 是 |
| current star collection、10 record respawn delay | CONFIRMED | 当前已知 star 是；future position 否 |
| single due bomb fuse/blast/damage | CONFIRMED | 是 |
| 单 crash、双 crash、frame limit 的 star/runtime 优先级 | CONFIRMED | exact runtime tie 除外 |
| 128 record 最后一条完整执行 | CONFIRMED | 是 |
| shield/freeze/stun support/overload/cloak/boost 基本状态机 | CONFIRMED | 各自未知边界除外 |
| poison四帧相对`ACT-HOLD-ACT-HOLD`、HOLD不出队 | CONFIRMED | empty-repoll/ready边界除外 |
| teleport 合法目标与 star 邻格 support | CONFIRMED | universal support 是，概率与 reveal deadline 否 |
| singular enemy.bullet 对多物理弹 | set-valued relation | relation 完整时是 |

`projectile crossing` 仍只有 USER_CONFIRMED，不能单独支撑 strict Proof；已在 corpus 中作为 assumption bit，而不是偷偷提升为 PLATFORM_REPLAY_CONFIRMED。

## 4. R0 RuleVariant 处置

| group | DD4 状态 | Reference | Value | Proof/Hard | Fast/production |
|---|---|---|---|---|---|
| move contest/swap | UNRESOLVED_FINITE | 3 variants | 外扩 interval | UNKNOWN | contested 时 unsupported |
| star contest | UNRESOLVED_FINITE | 3 variants | interval | UNKNOWN | 只启用无 contest common path |
| projectile shared dirt/shield/tank | UNRESOLVED_FINITE | sequential/batch | common 或 interval | 差异时 UNKNOWN | common result only |
| multiple due bombs | UNRESOLVED_FINITE | placement/batch | common 或 interval | 差异时 UNKNOWN | common result only |
| frame limit before/after last record | **RESOLVED** | after complete record 127 | exact | eligible | generated terminal table |
| timeout `>=`/`>` 3000 | UNRESOLVED_FINITE | 两 comparator | exact boundary interval | boundary UNKNOWN | RuntimeController 不踩线 |
| exact runtime tie | UNRESOLVED_DOMAIN | DRAW/secondary unknown | interval | UNKNOWN | strict terminal unsupported |
| multi visible projectile singular API | RELATION | one-of-visible-set | InformationState | 全 relation coverage | set-valued adapter |

这里“unresolved”不是允许实现者任选。每个 group 都已进入 [dd4-rule-corpus.json](dd4-rule-corpus.json) 的 executable variant、fixture 和 productionBehavior。

## 5. R1 skill support 处置

| issue/skill | DD4 状态 | support closure | 剩余未知及行为 |
|---|---|---|---|
| OI-R1-001 shield | CLOSED | 2 bullet charges；bomb 全消费；duration/cooldown 已知 | shared-hit order 归 R0 variant |
| OI-R1-002 overload | CLOSED | 两独立 projectile、固定几何、同向、独立失效 | singular observation 归 relation |
| OI-R1-003 freeze | VARIANT_DEFINED | apply/suppress/expire/queue hold 事件齐全 | empty queue polling 与 ready 精确边界；依赖时 unsupported |
| OI-R1-004 stun | CLOSED for support | GO/turn={normal,reversed}；其他 command normal | 概率归 OI-R2-001 |
| OI-R1-005 poison | PARTIALLY_CLOSED | 30 个完整平台样本确认施加后相对节拍 `ACT-HOLD-ACT-HOLD`，hold 不 dequeue | 仅空队列后同帧repoll/ready边界；依赖时Value interval、Proof unknown |
| OI-R1-006 teleport | VARIANT_DEFINED | valid/invalid、star 邻格 landing support、locks、reveal event | landing probability、reveal exact deadline |
| OI-R1-007 cloak/grass | VARIANT_DEFINED | hidden/visible/reappeared relation 与 handle 生命周期齐全 | teleport reveal deadline 影响后续 observation 时 incomplete |
| OI-R1-008 boost | VARIANT_DEFINED | 2-cell GO、free turn + queued main 已确认 | queue 变空后的 same-frame repoll 未确认 |
| OI-R1-009 failed cast | VARIANT_DEFINED | invalid teleport 消耗 cooldown | 其他 family 的失败消费逐 family unknown |

DD4 对“support closure”的定义是：没有未登记的 action/event family；每个未确认 deadline/outcome 都是有限 variant、typed unknown 或 production blocker。它不等于所有 R1 issue 都 CLOSED，也不允许 FastKernel猜默认值。

## 6. R2 概率

### Stun

support `{NORMAL, REVERSED}` 对 GO/TURN 已确认；外部 simulator 的 50/50 不升级。每个 outcome 概率区间为 `[0,10000]` 且总和 10000。Proof universal AND 可使用完整 support；ExpectedValue 只能返回外扩 interval。

### Teleport star landing

support 是所有当前合法 cardinal adjacent cells；外部 uniform 只作候选。每 cell 区间 `[0,10000]`，总和 10000。strict kill/escape Proof 覆盖每个合法 landing；不能只选最近或最高概率格。

### Future star

平台生成器仍未知。它不进入物理 Hard/ForcedWin，只有 DD7 soft StarSpawnModel 可以使用历史先验。当前已经生成并被观察的 star 是物理事实，不受该未知影响。

## 7. 外部 simulator 差异

| 项 | simulator `1ef804e` | 平台/官方 | 处理 |
|---|---|---|---|
| bomb phase | expiry/bomb before action | bomb after action/projectile | REJECT |
| poison cooldown | 25 | 20 | REJECT |
| default frame limit | 300 | 128 records | REJECT |
| local bot timeout | 20/100ms style | whole-match约 3s | REJECT |
| overload spread | positive perpendicular axis | 五 replay 一致 | MATCH，但证据升级来自 replay |
| shield charges | 2 | official update 2 | MATCH |
| poison cadence | absolute even platform frame | replay确认相对施加时刻 `ACT-HOLD-ACT-HOLD` | REJECT absolute parity；仅保留empty-repoll variant |
| stun probability | 50/50 | 未确认 | support only |
| teleport landing probability | uniform | 未确认 | support only |
| teleport reveal | one enemy decision frame | “briefly”，精确 deadline 未确认 | candidate + unknown domain |
| movement intents | simulator-specific | contested outcome未确认 | 只生成 differential fixture |

ExternalSimulatorAdapter 必须覆盖 simulator 的 event 命名与 phase 差异；不得先把平台输入改成 simulator 的顺序再声称一致。

## 8. RuleCorpus 完整性

[dd4-rule-corpus.json](dd4-rule-corpus.json) 当前包含：

- 20 个 RuleDefinition；
- 12 个 variant group；
- 21 个 platform aggregate/slice/generated fixtures；
- 20 个 Reference handler bindings；
- 6 类 SourceAdapter binding；
- confirmed 常量、phase table、terminal policy、rejected external defaults 和 build gate。

结构验证要求：rule↔fixture、rule↔variant、fixture↔handler 全引用闭合；JSON 可解析；外部证据 fixture 不得 strict eligible；未决概率不得产生 exact Expected。文件内容 SHA-256 由每次 overview 校验记录，不写回文件自身。

`DESIGN_EXECUTABLE` 表示规则数据、handler contract、source reconstruction 和 expected/variant 均已无歧义，足以直接进入后续实现；不表示 ReferenceKernel JavaScript 已在本轮实现。用户已明确先通过详细设计再取代码，因此 DD4 不修改 Tank v1 或生成生产 Kernel。

## 9. 未解决时的生产行为

- shared resource/move/star contest：Fast 返回 `UNSUPPORTED_RULE`，Hard/Proof 为 incomplete/unknown；
- probability unknown：完整 support + outward interval；
- observation relation：保留所有 alternatives；
- teleport reveal unknown domain：依赖后续隐身判断的 branch incomplete；
- timeout exact boundary：1.5 秒 fallback 政策避免靠近 3 秒，但 terminal proof 仍不得猜 comparator；
- exact runtime tie：TerminalResolution UNKNOWN_RULE；
- future star：不进 strict physics/proof。

## 10. DD4 退出判断

详细设计层面的 DD4 退出条件满足：

1. R0 主规则和 last-record boundary 有 executable fixture；
2. 所有剩余 R0 差异都成为明确 variant/production blocker；
3. 八技能 action/event support 已确认或显式 variant/unknown-domain 化；
4. R2 support 与 probability 分离；
5. ReferenceKernel 输入、ordered algorithm、unknown、observation、terminal 和 trace 合同完整；
6. simulator 差异全部分类；
7. 没有把 synthetic/external/v1 结果升级为平台事实。

DD5 可以进入 FastKernel 与硬物理层的详细设计。实现阶段若 executable fixture 发现新 event family 或状态无法表达，必须回退 DD4/更早阶段，而不是在 FastKernel 增加私有规则。
