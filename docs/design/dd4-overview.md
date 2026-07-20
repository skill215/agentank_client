# DD4 Overview 与一致性审计

状态：DD4 COMPLETE，DD10平台回放修订，2026-07-16。DD5 READY。

## 1. 阶段结论

DD4 已把“规则来源列表”升级为可直接实现的 Reference/RuleCorpus 边界：每条规则有 handler、状态读写、事件、variant、fixture、UNKNOWN 行为、Proof 资格和生产行为。ReferenceKernel 与未来 FastKernel 共享 canonical semantics，但实现独立。

本阶段及DD10增量校准形成三个平台级结论：

1. overload member1 固定使用正轴垂直偏移：上下射击 `x+1`，左右射击 `y+1`；两弹独立；
2. 128-record 对局的 recordIndex 127 完整执行 seat action 与 projectile substeps，随后才按 star/runtime terminal。
3. poison四帧执行是相对施加时刻的`ACT-HOLD-ACT-HOLD`，不是绝对platform frame parity；仅empty-repoll边界仍未知。

剩余共享资源、move/star contest、timeout comparator、runtime exact tie、poison empty-repoll、teleport reveal deadline 和概率未知都保持显式 variant/unknown，不进入默认 Fast 规则。

## 2. 退出门

| DD4 退出条件 | 结果 | 证据 |
|---|---|---|
| R0 fixture 可执行描述 | PASS | platform aggregate/slice、replay-prefix、generated variant |
| confirmed rules 与 replay 一致 | PASS | 主 phase、projectile、bomb、terminal、overload、shield |
| external simulator 差异分类 | PASS | bomb phase、poison25、frame300 等 rejected；匹配项不越权升级 |
| R1 action/event support closure | PASS | confirmed / finite variant / typed unknown domain / production blocker |
| R2 support 与 probability 分离 | PASS | stun/teleport universal support；expected interval |
| UNKNOWN 行为完整 | PASS | Reference、Value、Proof/Hard、Fast、emitter 均有行为 |
| factual replay 不猜隐藏字段 | PASS | 固定 replayHash prefix-to-state；未知字段 typed unknown |
| Reference/Fast 独立 | PASS | canonical interface shared，helper implementation 不共享 |

## 3. RuleCorpus 完整性

[dd4-rule-corpus.json](dd4-rule-corpus.json) 包含：

```text
20 RuleDefinition
12 variant groups
21 fixtures
20 Reference handler bindings
6 SourceAdapter bindings
11 canonical phases
```

结构 validator 检查 rule↔fixture、rule↔variant、fixture↔rule、fixtureKind↔adapter、rule↔handler 全引用闭合。DD10修订后内容 SHA-256：`267f091d44060d5b04d9371be2f1fb0016adbb602e109b377f9cc93fa5f9440f`。

机械审计按当前design目录动态枚举Markdown：相对链接、code fence、DEC/OI引用必须通过；DD4 JSON可解析且上述数量/绑定全部匹配。

`DESIGN_EXECUTABLE` 表示数据和接口足以无歧义实现，不表示本阶段违反“先通过设计再写代码”的约束去实现 JavaScript ReferenceKernel。

## 4. 跨文档冲突审计

| 冲突主题 | 原状态 | DD4 处理 | 当前权威 |
|---|---|---|---|
| frame limit active candidate | `BEFORE_ACTION_128` | replay 否定；改为完整 recordIndex127 后 terminal | RuleCorpus + calibration report |
| overload geometry | UNKNOWN/RuleVariant | 五 replay 收敛固定 offset | RuleCorpus + RuleRegistry |
| shield 1 hit 旧 Guide cache | 旧页面摘要仍可能显示 1 hit/30 cooldown | 2026-06-27 Update 与当前 Guide 覆盖为 2 hit/25 | RuleRegistry evidence order |
| external bomb-before-action | simulator default | 平台 38 bomb 样本否定 | platform phase table |
| external poison25/frame300 | simulator constants | official20/platform128 覆盖 | RuleCorpus rejected defaults |
| stun/teleport 50/50/uniform | simulator probability | 只保留 support，不保留 exact probability | R2 interval rules |
| Reference clone vs DD3 zero-object | 看似实现冲突 | Reference 是冷层，Fast 才受 DD3 热路径 ABI | design authority |

现行规范中不再存在把 overload geometry 或 128 before/after 列为开放实验的条目。历史描述只在校准报告中作为被否定候选保留。

## 5. 未关闭但不阻塞 DD5 的规则

- move contest、swap、star contest：DD5 只实现无争用 common path；争用返回 unsupported；
- projectile/bomb shared resource：variant 输出相同时可走 common path，差异时 incomplete；
- timeout `>=`/`>` 与 runtime exact tie：终局精确边界 UNKNOWN；RuntimeController 不靠踩线；
- poison/ freeze/boost empty repoll：只实现 confirmed/common transition；poison非空队列相对cadence为exact；
- teleport reveal exact deadline：后续 visibility 依赖时 incomplete；
- stun/teleport probability：Value interval，Proof 穷举 support；
- future star model：DD7 soft only；
- projectile crossing：USER_CONFIRMED assumption bit，平台升级前不单独生成 strict Proof。

这些条目不会被 DD5 FastKernel 解释为默认安全、默认正常或默认 50/50。

## 6. DD5 准入与约束

DD5 可以开始，因为：

1. confirmed/common rule table 有确定 handler、phase 和 event；
2. FastKernel 对不支持 variant 有统一 `UNSUPPORTED_RULE`/incomplete 出口；
3. DD3 已冻结 TypedArray SoA、BranchMark、Event/Delta 和显式栈；
4. Reference canonical trace 定义了逐 phase 差分目标；
5. 已提交 projectile/bomb 生命周期、shield charges、terrain mutation 和 terminal 可进入 Hazard/ReverseViability 设计；
6. DD5 不需要也不允许解决风险、策略、对手模型或概率校准。

DD5 必须首先定义 generated integer rule table 和 Fast transition，再定义 Hazard/ReverseViability；不能用 hazard shortcut 代替 Reference/Fast 物理差分。
