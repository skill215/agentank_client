# IMP2 规则输入、状态模型与 ReferenceKernel Overview

状态：`G1_PASS / ACCEPTED / IMP3_ELIGIBLE / RELEASE_NOT_READY`，2026-07-16。

本 Overview 记录[实施计划](../design/implementation-plan.md)中 IMP2 的实现结果。阶段资格只由[IMP 验收合同](../design/imp-acceptance-contract.md)和不可变 AcceptanceReport 决定；官方probe完成度与RuleVariant是否已被证明是两个独立维度。

## 0. 验收结论

执行：

```text
./tools/implementation-toolchain.sh accept --stage IMP2
```

最终结论为`ACCEPTED`。`A2-01`至`A2-08`全部PASS，IMP3取得准入资格，但发布仍为`NOT_RELEASE_ELIGIBLE`。最终gate fingerprint为`72142d5354bb976bda0e50dd54db4bdb6fe1181cd83e6fb1680187860323a974`，Acceptance fingerprint为`bb3e36daed3858749474f9407486cdd4b466145778231889f207630e1c465475`。

current报告位于[imp2-acceptance-report.json](../../artifacts/reports/acceptance/IMP2/imp2-acceptance-report.json)，不可变验收报告为[imp2-acceptance-bb3e36daed3858749474f9407486cdd4b466145778231889f207630e1c465475.json](../../artifacts/reports/acceptance/IMP2/history/imp2-acceptance-bb3e36daed3858749474f9407486cdd4b466145778231889f207630e1c465475.json)，实现门位于[imp2-gate-report.json](../../artifacts/reports/imp2/imp2-gate-report.json)。

## 1. 已实现的 Reference Oracle

- 平台对象只在 `ObservationAdapter` 根调用中读取；输出为整数化、无外部引用的 `ObservedRoot`，`null`、absent 和 invalid 分离；
- `TrackedState` 使用 shadow reconciliation，只有完整关联才 commit；frame 回退和 ruleset 变化整体重建；
- `SearchState = PhysicalState | InformationState`，InformationState 保存联合 worlds、残余 support 和关联关系，不压成单一最可能世界；
- 固定地图为 column-major 静态 terrain；tank、projectile、bomb 为独立动态实体，overload 两弹拥有独立 ID 和共同 shot group；
- entity association 使用二部候选关系，singular bullet 输入不会贪心吞掉其他 projectile；
- seat 0/1 scheduler、effect expiry、star、两 projectile substep、bomb、terminal、observation 按冻结 phase 运行；
- shield/freeze/stun/overload/cloak/poison/teleport/boost 八技能均有 Reference handler；chance support 与 probability 分离；
- exact runtime tie、3000ms comparator、共享 projectile/bomb、争用移动/星、empty repoll 和 teleport reveal 等未知均返回 variant/unknown/unsupported；
- Reference 是冷层对象实现，不导入 Fast；未来 IMP3 Fast 只能按 canonical trace 差分，不能复用这里的 helper。

## 2. RuleCorpus 与轨迹证据

RuleCorpus 当前含 20 条规则、12 组 variant、21 个 fixture 和 20 个可解析 handler binding。Guide 字节 hash 已核对；外部 simulator 与 framework 固定到精确 commit 且只能生成 candidate，不能进入 strict truth。

四条 canonical trace 覆盖：

1. record index 127 完整执行 action/projectile 后再 frame-limit；
2. 同星按更低 runtime 决胜；
3. projectile batch 双毁后按星结算；
4. skill → 两段 projectile → bomb → terminal 复合顺序。

每条 trace 均保存 parent signature、ordered events、state patch、双方 observation relation 和 terminal；同输入重跑 byte-identical 并可独立 replay。

## 3. 官方probe与runtime新事实

IMP2新增仅允许`GET /agent/tank + POST /agent/tank/simulate`的probe client；命令必须携带`--authorize-official-simulate`，使用TankProfile secretRef、ownerScope共享限流和脱敏内容寻址raw evidence，没有publish/challenge入口。12项预注册probe全部取得官方响应：2项`CONCLUSIVE`、10项`INCONCLUSIVE`、3项实际达到目标事件。`INCONCLUSIVE`只完成证据义务，不升级RuleCorpus；10个未解决variant继续由Reference显式传播UNKNOWN。

对 v2 poison 的同局 baseline/experiment probe 得到：

- baseline 在相同相对时点公开 `remainingCooldownFrames=18`；
- 插入 cooldown failed cast 后仍为 `18`；
- 平台 replay 明确出现 poison `action=failed, reason=cooldown`；
- 因此 poison 的 cooldown failed cast 为 `FAILED_PRESERVES_READY_FRAME`，不会重置原 ready frame。

该结论只更新 poison family；teleport invalid target 与其他技能 family 仍按各自证据/UNKNOWN 处理。官方响应只以 SHA-256 和脱敏 raw artifact 引用，不把一次 simulate 推广成未观察技能的共同规则。

runtime probe新增了两个必须分开的平台事实：

- 纯整数长循环在单次`onIdle`累计到`runTime=1500`时产生`script timeout`，确认约1500ms callback watchdog；
- 当前v2 callback中`performance/setTimeout`缺失，公开`game/me/status`没有累计runtime，`Date`只观察为对象；`Date.now`的精确可调用性因后续POST结果不确定而正式保留`UNKNOWN`。

v1计时实现已作为已验证参考纳入：`runtimeClockMs()`只有在`Date`与`Date.now`均为函数时才读时钟，否则返回0；其稳定性还依赖固定节点/depth/rollout上限。v2因此选择版本化校准整数work counter为当前主模式，只有CapabilityProfile未来确认安全单调墙钟才启用wall-clock。v2 CapabilityProfile fingerprint为`97aa4fb51832ed08fcd03f6b0febe78b26dc77f8f1255d6b3fe37d2e9845075f`。

## 4. 门、测试与下一阶段

统一命令：

```text
./tools/imp2-toolchain.sh test
./tools/imp2-toolchain.sh verify
./tools/implementation-toolchain.sh accept --stage IMP2
```

最终G1及IMP0/IMP1回归为`125/125 PASS`、零失败；门同时检查Reference/Fast隔离、handler闭合、UNKNOWN负向控制、四条canonical replay、技能事实仲裁、external candidate边界和official probe coverage。

仍未证明的10个variant是：move contest、star contest、projectile shared resource、multi-bomb batch、freeze empty queue、boost empty queue、poison empty queue、teleport reveal deadline、timeout exact boundary、exact runtime tie。官方训练对手公开技能被观察为overload/overload/shield，无法主动触发freeze/boost/teleport；其他项目依赖双方同帧交互或精确终局边界。它们保持UNKNOWN，而不是继续阻塞IMP2证据完成度。

下一步按计划进入IMP3 Fast Physical Kernel。IMP3必须对本阶段20条规则、12组variant和四条canonical trace做Reference差分；任何UNKNOWN不得在Fast中变成默认物理规则。剩余variant可以在出现新的可控平台能力时继续定向probe，但不能阻断已授权的FastKernel实现，也不能在没有新证据时被关闭。
