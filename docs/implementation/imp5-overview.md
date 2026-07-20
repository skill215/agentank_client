# IMP5 整数评分、动态策略、对手模型、技能与 Plan Overview

状态：`G3_G8_POLICY_PASS / ACCEPTED / IMP6_ELIGIBLE / RELEASE_NOT_READY`，2026-07-16。

本 Overview 记录[实施计划](../design/implementation-plan.md)中 IMP5 的实现与验收结果。IMP5 只实现 strict 层之后的软决策；11 类缓存、1.5 秒 FALLBACK、production strip/source-minified 和发布容量选择仍属于 IMP6。

## 0. 验收结论

执行：

```text
./tools/imp5-toolchain.sh verify
./tools/implementation-toolchain.sh accept --stage IMP5
```

`A5-01` 至 `A5-09` 全部 PASS，最终 179/179 测试通过。最终 Gate fingerprint 为 `da5a5cc11931e8f92f8fafbacb4c70b90f7b9aea97e5f4ce2482b6541e1367c7`；Acceptance fingerprint 为 `b9aa78079de732097961418479e79e69e64629d3f4e3c6b8fa172ed5ce7698dc`。

current 报告位于 [imp5-acceptance-report.json](../../artifacts/reports/acceptance/IMP5/imp5-acceptance-report.json)，不可变报告为 [imp5-acceptance-b9aa78079de732097961418479e79e69e64629d3f4e3c6b8fa172ed5ce7698dc.json](../../artifacts/reports/acceptance/IMP5/history/imp5-acceptance-b9aa78079de732097961418479e79e69e64629d3f4e3c6b8fa172ed5ce7698dc.json)。两者 SHA-256 相同：`ada755f4146b38e2dddaa8501b8401bdbd5412489b06fd56ce256e5afa2ff912`。

## 1. 整数 FeatureRegistry 与评分

- 注册 21 个 feature，覆盖 terminal/star/survival/combat/position/information/resource/Plan/opponent/compute-cost；每项都有整数范围、cost tier、dependency mask、输入和 handler；
- `FeatureInputFrame`、raw、profile weight、action delta 与 Plan delta 全部使用整数 TypedArray；没有 Float32/Float64 语义数组；
- TableEvaluator 与 GeneratedEvaluator 在 4 个 cost tier、5 profile、6 action family、5 Plan kind 上完成 684 次 raw/score 比较，mismatch 为 0；
- raw/weight 分离。单独调整某个 action 或 Plan 权重只重做整数 dot，不重算物理/raw；构建冻结后 WeightBank 拒绝在线修改；
- 普通评分限制在 `[-9000,+9000]`，不能伪装 terminal `[-10000,+10000]` 或收紧 IMP4 sound bound。

## 2. 动态策略与风险接口

- 实现 STAR_CONTROL、KILL_PRESSURE、POSITION_CONTROL、PRESERVE_LEAD、COMEBACK 五策略；
- 阶段按 outcome capacity/terminal urgency 分类为 OPEN、SHAPING、DECISIVE、LOCKED，不按固定帧段；
- selector 只输出 EvalProfileId、baseRisk 和 modifier；不直接输出动作；
- 普通切换要求 `minimumDwellRoots=3` 且 challenger 超出 `switchMargin=400`，fixture 中 jitter 为 0；Hard survival/Forced loss recovery 可立即中断普通滞回；
- Risk 仍由 IMP4 递归 epsilon-contamination 消费，selector 不能改 Hard/Proof。

## 3. 当前局 OpponentModel

- 10 类 opportunity/choice 事件覆盖开火、bomb、拿星、前进/后退、额外转向、技能、终局交换、信息赌博与位置争夺；
- confirmed opportunity 才进入分母；POSSIBLE/AMBIGUOUS 只增加歧义并降低 confidence，不能当作 NOT_CHOSEN；
- 每个 event/context 保存 fast/slow/confidence/opportunity/ambiguity，使用 0–10000 定点更新；七维风险喜好归一化为 0–100；
- FIRE 等 command 名义概率与 FastKernel 中实际发弹成功分离，最大余数法保证概率和精确为 10000；
- `beginMatch/reset` 清空上一局证据；`ownParameterFingerprint` 在所有局内更新和换局中保持不变。对手模型只改变 nominal distribution/opponent soft feature。

## 4. 技能与 v2 中毒专门化

- 八个 enemy skill descriptor 按公开整数 skillId O(1) 查表，cooldown/duration/action code 与 IMP3 Fast Rule 常量逐项一致；
- 当前 v2 build 使用 `OwnSkillEmitter[POISON]`，只生成中毒 action；敌方仍保留八 descriptor capability；
- Stun/Teleport 的 chance support 只作为 support 标记，未知概率不进入 descriptor 猜测；Teleport 使用 target-mask generator；
- Shield 两次 bullet charge、Overload 双 projectile、Poison 相对 cadence 等物理仍只由 FastKernel 执行，策略 descriptor 不复制 transition。

## 5. Plan 与 hidden risk

- Shot/Bomb/Skill/Information 四类候选使用 32-slot PlanSketch SoA；只有 finalist 可进入 8-slot PersistentPlanArena；
- PersistentPlan 使用 generation handle、deadline、dependency、target signature 与实体 generation；每次 continuation 必须再次调用 IMP3 HardGate；
- Plan invalidate 不删除 bomb/projectile，不改变 hazard；Overload 两成员和 bomb deadline 继续由 PhysicalState/SourcePlan 拥有；
- grass、cloak、belief route、possible blind shot/bomb 只写 HiddenRiskField 与 PossibleHazard raw feature；Hard/Proof write count 均为 0；
- 任意 weight、strategy、opponent 和 risk 变化后，strict Proof fingerprint mismatch 为 0。

## 6. 有界结构与本地性能观察

- 完整 PolicyLayer 共 68 个整数 TypedArray、13,986 bytes，tracked hot allocation 与 float array 均为 0；
- 性能清单含 35 个独立指标：21 feature、10 opponent event、4 Plan revalidation；每项都有 bytes、样本数、P95/P99/max 和 allocation；
- 本次 WSL/Node 24.16.0 观测的各类最大 P95/P99 分别为：feature `461/1533 ns`、opponent update `1363/5521 ns`、Plan+Hard revalidation `37213/53335 ns`；
- 这些数值只证明可测且有界，不是生产阈值。IMP6/IMP8 仍须在完整 callback、fallback、source/minified 和平台能力条件下选择缓存、深度与容量。

## 7. 下一阶段

IMP6 已取得准入。其顺序必须是：先建立 11-cache inventory/key/失效与 cache-off 同义基线，再接入累计计时、1500ms 永久 FALLBACK 和 Emergency reserve，随后做 deterministic assembly、production strip、source/minified differential 与六层 benchmark。IMP6 不得用缓存或 fallback 改变本阶段的 raw/score 语义、Plan Hard 重验或 IMP3/IMP4 strict 结论。
