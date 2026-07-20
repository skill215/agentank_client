# V2 双方技能影响与搜索量词审计

状态：2026-07-17，IMP8 实现审计。规则依据为官方 Agent Guide、本地 RuleCorpus、平台历史回放；外部 simulator 只作候选实现，不覆盖官方更新或平台事实。

## 1. 唯一执行原则

技能不能只进入评分。双方都必须先经过同一个参数化物理转移：

```text
公开 skill/status/effects
  -> ObservationAdapter：字符串一次性归一为整数 skill/effect/deadline
  -> InformationState：精确物理字段 + 未知 world/chance/support
  -> ActionFamily：我方动作、敌方动作、target/compound program
  -> FastKernel(seat, actionProgram, chanceOutcome)
  -> Terminal + Hard
  -> Proof / robust Value / soft ordering
```

`seat=0/1` 是唯一的双方差异。不能为我方技能和敌方技能各写一套效果逻辑。施放目标由规则决定：shield/overload/cloak/boost 作用自身，freeze/stun/poison 作用对方，teleport 改变施放者位置。

## 2. Hard、Chance、Risk 的边界

- 已经存在的子弹、炸弹和确定性技能效果是 PhysicalState，直接参与每个 action 的 Fast/Terminal/Hard 检查。
- 对方“可以施放技能”是 EnemyAction，不是已发生的硬事实；完整敌方合法技能动作必须进入 response support。
- stun 的 normal/reversed 是 ChanceOutcome。某动作在所有结果都死亡才是必输；部分结果死亡属于风险，不能伪造成硬失败，也不能伪造成安全。
- ForcedWin 必须对 EnemyAction、HiddenWorld、ChanceOutcome 全部成立。
- chance support 已知但概率未知时，Proof 可做 universal AND；Value 保持概率不完整或使用有 provenance 的校准分布，禁止默认 50/50。
- 风险参数只能改变 Value/策略选择，不能删除 Hard、Terminal 或严格 Proof 分支。

## 3. stun 与 poison 的明确结论

### stun

算法输出意图动作，不做“预先反向补偿”。平台对每条受影响的 `GO/turn` 独立选择：

```text
GO          -> forward | backward
TURN_LEFT   -> left    | right
TURN_RIGHT  -> right   | left
FIRE/BOMB/SKILL -> 不反向
```

因此预先把 left 改成 right 只会交换两个结果的名字，不能抵消随机性。Hard 对两个执行结果分别 make/undo；Proof 对两者 AND；Value 对两者做概率不完整的 robust backup。

### poison

`actionSpeed=0.5` 是边界状态描述，不是“GO 只移动半格”，也不是内部浮点物理量。poison 在 4 帧内降低所有命令的执行节奏；允许行动的帧上普通 `GO` 仍移动 1 格，boosted `GO` 仍最多移动 2 格。已提交命令在 HOLD 帧不执行、不出队。

平台回放支持相对施放时刻的 `ACT-HOLD-ACT-HOLD`。内部保存整数 `poisonAppliedFrame/poisonUntilFrame`，用奇偶差计算 HOLD；ObservationAdapter 从 `remainingFrames` 反推 applied frame，并用 `canActThisFrame` 做一致性检查。

## 4. 八技能实现矩阵

| 技能 | 双方物理影响 | 当前严格性 | 后续工作 |
|---|---|---|---|
| shield | 自身最多 4 帧；两次 bullet charge；bomb 一次耗尽 | Fast 已支持。边界未公开剩余 charge 时，当前对我方按 0、敌方按 2 的保守端点并标记 incomplete | 建立 shield charge HiddenWorld/命中关联，恢复精确 Value |
| freeze | 对方 2 帧不能执行；queue 保留 | HOLD 已为双方合法 no-op；同帧 seat 顺序已覆盖 | 深层搜索需要持有 PendingCommand/ActionProgram，不能在解冻后自由重选并称精确 |
| stun | 对方 6 帧；GO/turn normal/reversed | support 完整；Proof 不需要概率；Value 概率不完整 | 从平台语料校准概率时必须记录 provenance/confidence，不能拿外部 simulator 的 50/50 当规则 |
| overload | 自身下一次成功 FIRE 生成两个独立 projectile id、共享 shot group | Fast 已支持独立存活/失效和 shield hit | 补齐更多双弹碰撞/容量/路径回归 |
| cloak | 自身 6 帧改变敌方观察关系，不改变真实物理碰撞 | 不可见根已禁止 exact strict search；PossibleHazard 仍保留 | 完整 HiddenWorld belief、盲射/炸弹/路径预射 response support |
| poison | 对方 4 帧相对节拍减半，所有命令受影响 | applied/deadline/HOLD/0.5 边界归一已支持 | 空队列同帧 repoll 若影响分支仍为规则变体 |
| teleport | 自身瞬移；非法目标仍消耗 cooldown；不能落在敌方 bullet；star 请求随机邻格；pickup/fire/reveal lock | 生产根使用一个 lazy target family；严格胜利按需遍历全部合法直达目标，star 请求的随机邻格是该 support 的子集，不再用星邻格替代全 support | 深层 reveal/pickup/fire-lock 跨 deadline 依赖不完整时继续 fail closed；补性能上限与平台事件证据 |
| boost | 自身 6 帧；GO 最多 2 格；每帧首次 turn 免费且可接 main command | active 根使用固定整数 compound ActionProgram；免费 turn 与 main 在同一物理帧执行，受 stun 时两条命令分别枚举反转结果 | empty-queue repoll 仍保持规则不完整；补更多遇阻、第二次 turn 与跨技能组合证据 |

## 5. 当前修正与验收

本轮已修正：

1. poison applied frame 不再被每个 callback 重置；
2. 接受边界 `actionSpeed=0.5`，内部仍只存整数 deadline/cadence；
3. freeze/poison HOLD 的 `ACTION.NONE` 不再误报 unsupported；
4. stun support-complete 与 probability-complete 分离；
5. strict Proof 不再错误要求 chance probability；
6. teleport 敌方 projectile 目标判非法且照常消费 cooldown；
7. canAct 与冻结/中毒派生节拍不一致时根标记 incomplete；
8. teleport 全 target family 已改为按需 universal scan，避免为全图目标预分配搜索节点；
9. shield 剩余 charge 未知时使用对我方安全、对敌方保守的端点，不再乐观假设我方仍有两层。
10. boost 免费 turn + main 已编码为固定 ActionProgram，不增加一个虚假的 minimax ply；受 stun 时两条命令的随机反转分别覆盖。

相关 IMP3/IMP4/production-root 定向验收：69/69 通过。该结果只表示上述合同与回归通过，不表示 shield world tracking、cloak belief、boost empty-queue repoll 和 teleport 跨 deadline 信息状态已完成。

## 6. Boost 官方公开回放发现证据

2026-07-17 使用只读公开接口按名字解析“无米粿”（tankId 6814，`tnk_9Gn7nNb7EqODtynnS`，Boost），冻结下载时刻的最近 10 场。10 场均为同一 subject codeHash，且 10/10 实际施放技能：

- 23 次 `cast -> applied -> expired` 均报告 6 帧，applied 到 expired 的 frame delta 也为 6；
- 90 组第二步带 `boosted:true` 的两格移动，第二步与第一步均相邻，未见第三步或非相邻跳跃；
- 61 组同一 raw frame 内 subject `turn` 后继续执行非 turn 主动作，直接支持“首次 turn 免费”；
- 仅从事件流无法连续观察 cooldown 数值，也无法识别 `onIdle` 的空队列 repoll 边界，因此 26 帧 cooldown 与 empty-queue repoll 继续标为 INCONCLUSIVE，不能因指南文字而伪造成平台回放闭合。

完整 `summary/events/raw`、每文件 SHA-256 和机器报告位于 [Boost skill evidence report](../../battle-records/discovery/skills/boost/tnk_9Gn7nNb7EqODtynnS/runs/boost-wumiguo-20260717-v1/skill-evidence-report.json)。该集合属于 Discovery：可升级规则事实与回归夹具，但不得直接进入参数 Calibration 或 Frozen 分母。

## 7. Shield 官方公开回放发现证据

2026-07-17 按名字唯一解析“Feizai”（tankId 4837，`tnk_5Lpbgtl0JCnJuk5xZ`，Shield），冻结最近 10 场；10 场 subject codeHash 一致。8/10 场实际施放，共 14 次 `cast/applied`：

- 14 次 `applied.durationFrames` 均为 4；
- 11 次可由 raw 几何闭合为“敌弹进入护盾坦克格、子弹 crashed、坦克存活”；
- 其中 7 次第一发命中后护盾继续 active，4 次第二发命中后护盾 expired 且坦克存活，直接支持“两次 bullet charge”，不是一次命中即失效；
- 样本内没有护盾窗口中的 bomb interaction，无法验证 bomb 是否一次耗尽；事件流也不连续公开 cooldown，因此 25 帧 cooldown 保持 INCONCLUSIVE。

这会提升 `shieldBulletHits=2` 的平台事实置信度，但不会消除 InformationState 问题：观察接口仍不公开“当前还剩 1 层还是 2 层”，中途首次看见 shield 的搜索节点仍须保留 residual-charge HiddenWorld，不能直接设为 2。

完整证据位于 [Shield skill evidence report](../../battle-records/discovery/skills/shield/tnk_5Lpbgtl0JCnJuk5xZ/runs/shield-feizai-20260717-v1/skill-evidence-report.json)。

## 8. Cloak 官方公开回放与手册证据

2026-07-17 按名字唯一解析“Nightjar”（tankId 4678，`tnk_30YaQEAipUaFRAXNr`，Cloak），冻结最近 10 场；10 场 subject codeHash 一致且全部实际施放：

- 15 次 `applied.durationFrames` 均为 6；
- cloak active 窗口内记录到 47 次移动和 23 次转向，确认 cloak 不会冻结普通行动；样本内没有 active-window FIRE，因此“开火是否保持 cloak”不能由这 10 场关闭；
- 记录到 13 段至少连续 10 帧静止在草地、0 段同阈值非草地静止，实际回放支持“进入草丛据点后长期蹲守”的行为模式；
- omniscient raw replay 不等于任一脚本收到的 observation，无法用它直接证明敌方 `enemy.tank` 何时为 null，也不能关闭 teleport reveal 对 cloak 的覆盖边界。

第三方 [Nightjar Field Manual](https://mifunetron.github.io/agentank-field-manual/zh.html#night) 给出了 `atNest/search/nest/faceDownLane/enemyEntersLane` 形状的策略代码和完整战术说明，可作为 Plan/ActionOrdering 的策略先验。它不是可发布的 Nightjar 完整源码：仓库页明确声明 winning configurations deliberately omitted，片段中的函数也没有实现体。因此不能把该片段当作平台物理规则、精确参数或逐字节对手模型。公开回放确认的是它描述的“草丛走廊蹲点”行为，不是源码等价。

完整证据位于 [Cloak skill evidence report](../../battle-records/discovery/skills/cloak/tnk_30YaQEAipUaFRAXNr/runs/cloak-nightjar-20260717-v1/skill-evidence-report.json)。

## 9. Teleport 官方公开回放发现证据

2026-07-17 按名字唯一解析“哈基米OvO”（tankId 5928，`tnk_ImhCqFPsuwD7p12xg`，Teleport），冻结最近 10 场；10 场 subject codeHash 一致且全部实际施放：

- 19 次 cast 全部有 applied，raw 提供 `from/to`；19 个落点均与跟踪位置一致，位于可通行且非敌方坦克格；
- 11 个成功落点在当时没有星或距星大于 1，直接否定“teleport 只能到星旁”的全局剪枝；任意合法 target 必须继续使用 lazy target family；
- 8 个落点位于星相邻格、0 个直接落星，但 raw cast 省略请求坐标，所以不能据此证明请求 star 后发生随机邻格重定向；
- 6 次拿星发生在 `castFrame+2`，与两帧 lock 的解锁边界兼容；没有更早的拿星，也没有“提前进入星格但被阻止”的可观察尝试，因此不能单靠这些被动回放确认 lock；
- 4 次落点距敌方 Manhattan distance 不超过 4，解锁前均未创建己方 bullet，但“没有开火”不证明脚本尝试过 FIRE；近敌 fire lock 仍是 INCONCLUSIVE；
- 样本无失败 cast，无法验证 invalid target 消耗 cooldown；首次后续动作都先转向或没有可用移动证据，无法从这组样本确认传送保持朝向；敌方临时看到落点也不能从 omniscient replay 推断。

完整证据位于 [Teleport skill evidence report](../../battle-records/discovery/skills/teleport/tnk_ImhCqFPsuwD7p12xg/runs/teleport-hajimiovo-20260717-v1/skill-evidence-report.json)。

以上三组与 Boost 相同，均属于 Discovery，不进入 Calibration/Frozen 分母。任何 INCONCLUSIVE 项只能通过命中特定交互的新增公开回放，或带明确动作意图/观测日志的定向官方 probe 关闭。

## 10. 实施优先级

1. `ActionProgram`：继续解决 freeze/poison pending command 与 boost empty-queue repoll；
2. `LazyTargetFamily`：补 teleport 跨 deadline 信息依赖、容量和平台事件回归；
3. `SkillInformationWorld`：shield residual charge、cloak hidden pose；
4. `ChanceCalibration`：仅用平台回放估计 stun 分布，并保持未知/低置信区间；
5. 八技能双方镜像差分、复合危险、128 帧终局和性能 benchmark；
6. 上述未闭合项通过前，IMP8/G10A 不得声称技能 strict-complete。
