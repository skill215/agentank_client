# RuleRegistry

状态：DD4 同步规则登记，DD10 证据修订，2026-07-16。可执行选择、variant 与 fixture 以 [dd4-rule-corpus.json](dd4-rule-corpus.json) 为准；动态历史证据语义以 [rolling-corpus-contract.md](rolling-corpus-contract.md) 为准。

## 1. 目的

RuleRegistry 记录每项规则的来源、可信级别、测试和 RULESET_VERSION 影响。它存在于开发/构建层，正式 FastKernel 只接收生成后的整数规则表。

规则与算法政策的权威边界见 [design-authority.md](design-authority.md)；当前所有未知和冲突必须同时登记在 [open-issues-register.md](open-issues-register.md)。DD1 的规范执行语义分别由 [action-scheduler-contract.md](action-scheduler-contract.md)、[frame-timeline-contract.md](frame-timeline-contract.md)、[terminal-proof-algebra.md](terminal-proof-algebra.md) 和 [rule-corpus-schema.md](rule-corpus-schema.md) 定义。RuleRegistry 不能用外部实现或设计偏好关闭平台规则 issue。

## 2. 可信级别

- OFFICIAL_UPDATE_CONFIRMED：官方 Updates 对具体规则的明确变更。
- GUIDE_CONFIRMED：当前在线/本地官方指南正文明确说明。
- PLATFORM_REPLAY_CONFIRMED：真实平台回放重复确认。
- PLATFORM_SIMULATION_CONFIRMED：定向平台 simulation 确认。
- EXTERNAL_SIM_MATCH：外部模拟器实现或测试通过，只能产生候选变体。
- USER_CONFIRMED：用户基于已有对战/实现确认，仍需平台回归固化。
- DESIGN_POLICY：我方算法选择，不冒充平台规则。
- INFERRED：从现象推断，不能支持严格证明。
- UNKNOWN：没有足够信息。

证据覆盖顺序为 `OFFICIAL_UPDATE > GUIDE > PLATFORM_REPLAY/PLATFORM_SIMULATION > EXTERNAL_SIM > USER/INFERRED`。官方 Updates 与指南正文冲突时采用 Updates；指南页面的 `Last updated` 元数据不能覆盖正文或 changelog。

只有 OFFICIAL_UPDATE、GUIDE、PLATFORM_REPLAY、PLATFORM_SIMULATION 级规则默认支持严格 Proof。USER_CONFIRMED 可以先进入非证明实现，但必须有待验证测试；EXTERNAL_SIM_MATCH 只能用于 fixture、差分定位和 RuleVariant，不能单独生成 `HARD_REJECT_PROVEN`、ForcedWin 或 exact terminal value。

## 3. 当前指南快照

- 文件：[../agent-guide.md](../agent-guide.md)
- 页面元数据标注更新时间：2026-06-06；该元数据已知滞后于正文和官方 Updates
- 下载日期：2026-07-15
- SHA-256：47016cf5f96ccbb69a8849dd0f2cbc14bbca49ed664e687d1d0e8b352d323d90

### 3.1 官方 Updates 基线

| 日期 | 主题 | 规则影响 |
|---|---|---|
| 2026-06-03 | [技能冷却调整](https://agentank.ai/updates/2026-06-03-skill-cooldown-balance) | poison 冷却 20 等当前冷却基线 |
| 2026-06-06 | [炸弹](https://agentank.ai/updates/2026-06-06-bombs) | bomb 引信、范围、冷却和可见性 |
| 2026-06-15 | [子弹视锥](https://agentank.ai/updates/2026-06-15-bullet-vision-cone?lang=zh) | 敌方子弹前方 90 度观察 |
| 2026-06-18 | [teleport 落点显形](https://agentank.ai/updates/2026-06-18-teleport-landing-visibility?lang=zh) | teleport 后短暂暴露落点 |
| 2026-06-27 | [shield 两次 bullet hit](https://agentank.ai/updates/2026-06-27-shield-two-hit?lang=en) | 覆盖旧的一 hit 描述 |

### 3.2 外部实现版本

| 来源 | commit | 资格 |
|---|---|---|
| `cyhhao/agentank-simulator` | `1ef804eb2c187138c4c8e5229fb37cd0126beddf` | EXTERNAL_SIM_MATCH；候选 Oracle |
| `mythchen-1024/agentank-framework` | `b676a7f3b58a3d462635171c73632c00feeafab6` | 仅构建/架构参考；skill 文件无物理实现 |

外部模拟器当前 poison 冷却为 25，与官方 20 冲突；其默认 300 帧和本地 bot timeout 也不是平台规则。完整边界见 [simulator-integration-contract.md](simulator-integration-contract.md)。

### 3.3 v1 遗产证据基线

`LEGACY-244-20260715.1` 是不可变冻结快照，包含 244 个唯一平台对局、10,996 个 replay frame、10,752 个可比较决策帧和 23 个 code hash；它不是“当前总局数”。后续对局由 append-only MatchLedger/CorpusHead 动态管理，其 manifest、双轨重建和证据升级规则分别见 [legacy-evidence-contract.md](legacy-evidence-contract.md) 与 [rolling-corpus-contract.md](rolling-corpus-contract.md)。

- v1 分析文档只产生 `LegacyFinding` 和待验证假设，不单独提升规则可信级别；
- 原始平台 replay 可在最小 fixture、事件 trace 和观察边界复现后获得 PLATFORM_REPLAY_CONFIRMED；
- 历史 action baseline 只能比较行为漂移，不能在分叉后代表真实反事实未来；
- LegacyPolicyAdapter 和 TraceOpponentProfile 不进入正式规则表或生产 bundle。

DD1 已把 3 秒 `timeout`、128-record 终局、同星 `runTime` 结算和主 FrameTimeline 提升为 PLATFORM_REPLAY_CONFIRMED。DD4 又以平台 replay 确认 overload 两弹几何和“完整执行 recordIndex 127 后终局”。仍未确认的是同 phase 共享资源顺序、timeout 精确比较符和 runtime 精确相等规则。

## 4. Runtime 与动作

| 规则 | 来源 | 设计处理 |
|---|---|---|
| 顶层入口必须是 onIdle(me, enemy, game) | GUIDE_CONFIRMED | 单一同步入口 |
| onIdle 只在我方无排队命令时调用 | GUIDE_CONFIRMED | PendingOwnCommandRegistry |
| 命令在之后的帧执行，不在 onIdle 内立即执行 | GUIDE_CONFIRMED | 提交与实体创建分离 |
| 默认每坦克每帧执行一个命令 | GUIDE_CONFIRMED | FrameTimeline |
| go(2) 排队两个 go，不是普通坦克同帧走两格 | GUIDE_CONFIRMED | 队列摘要 |
| boost 中 go 可走至多两格 | GUIDE_CONFIRMED | capability mode |
| boost 每帧第一次 turn 免费，可同帧再执行主动作 | GUIDE_CONFIRMED | 原子复合 action |
| 普通 turn(); fire(); 在不同帧执行 | GUIDE_CONFIRMED | 禁止普通同帧复合 |
| 应避免浏览器 API 与网络调用 | GUIDE_CONFIRMED | 单线程、无 Worker/网络 |
| 平台 JavaScript 能力 | PLATFORM_REPLAY_CONFIRMED（局部） | `Math.imul` 不存在；Uint16Array/Uint32Array 可用。其余语法、字节上限、冷启动和TypedArray性能仍需能力profile与平台Benchmark |
| 同帧双方 action 固定 seat0 后 seat1 | PLATFORM_REPLAY_CONFIRMED | 9,642 个双 action frame 全部一致；seat 是平台身份，不等于固定我/敌先手 |
| 双方普通GO时可进入对方在同一record确定腾空的帧初位置 | PLATFORM_REPLAY_CONFIRMED | 当前动态历史池1,283个去重replay中有31个单位移动样本，seat0跟随17个、seat1跟随14个；只闭合普通无effect GO，swap/同目标仍UNKNOWN |
| timed effect expiry 在 action 前 | PLATFORM_REPLAY_CONFIRMED | timed expiry 通常先于当帧 action；overload 消耗 expiry 作为独立事件 |
| star spawn 在 action 前；collection 在双方 action 后、projectile 前 | PLATFORM_REPLAY_CONFIRMED | 345 次 collection 全在 action 后；95 个与 projectile 共帧样本全在 projectile 前 |
| projectile 在双方 action 后，bomb explosion 在 projectile 后 | PLATFORM_REPLAY_CONFIRMED | 3,305 个 action+bullet frame、38 个 bomb explosion frame；外部模拟器 bomb-before-action 候选被否定 |

## 5. 地图与观察

| 规则 | 来源 | 设计处理 |
|---|---|---|
| game.map 使用 game.map[x][y] | GUIDE_CONFIRMED | ObservationAdapter 转 cellId |
| x=墙、m=土堆、o=草、.=开放格 | GUIDE_CONFIRMED | terrain code |
| 土堆阻挡移动、子弹和视线；子弹可摧毁 | GUIDE_CONFIRMED | topology delta |
| enemy.tank 在草中或 cloak 时可能为 null | GUIDE_CONFIRMED | PossibilityMask |
| enemy.bullet 只在前方 90 度视锥且无遮挡时可见 | GUIDE_CONFIRMED | 不可见不等于消失 |
| game.star 可能为 null | GUIDE_CONFIRMED | 当前事实与未来生成模型分离 |
| 未来星星生成时间和位置分布 | UNKNOWN | 只进概率模型，不进硬证明 |

## 6. 子弹

| 规则 | 来源 | 设计处理 |
|---|---|---|
| 普通 fire 只有无活跃子弹且非 fireLocked 时才产生新弹 | GUIDE_CONFIRMED | FireAvailability 三值 |
| fire 命令可能被消耗但不产生子弹 | GUIDE_CONFIRMED | 执行 phase 才创建实体 |
| overload 的下一次成功开火产生两颗子弹 | GUIDE_CONFIRMED | 两个 projectile handle，一个 `shotGroupHandle` |
| 子弹撞墙、摧毁土堆、出界、命中坦克或被盾阻挡后失效 | GUIDE_CONFIRMED | trajectory stop reason |
| projectile 每帧按 `substep=0,1` 推进，逐 substep 失效 | PLATFORM_REPLAY_CONFIRMED | 3,103 条完整 `0,1` 事件模式；546 条在 substep0 后因失效停止 |
| 新创建 projectile 在创建帧先 create 后执行 substep | PLATFORM_REPLAY_CONFIRMED | 1,078 个 create+move frame 全部一致 |
| 子弹与子弹互相穿过，不抵消 | USER_CONFIRMED | 独立轨迹；加入平台回归 |
| overload 两颗子弹具体起点、方向和相对弹道 | PLATFORM_REPLAY_CONFIRMED | member0 同 cell；member1 上下射击 x+1、左右射击 y+1；同向独立轨迹 |
| 多颗同帧命中同一土堆的结算顺序 | UNKNOWN | FrameTimeline 候选结果 |
| enemy.bullet 对多弹的运行时数据形状 | UNKNOWN | Adapter 兼容、内部数组 |
| 外部模拟器第二弹从正轴垂直侧邻格产生且同向 | EXTERNAL_SIM_MATCH + PLATFORM_REPLAY_CONFIRMED | replay 才提供升级资格；不再是 RuleVariant |
| 外部模拟器只返回第一颗可见 bullet | EXTERNAL_SIM_MATCH | 不能限制内部 projectile 数量 |

## 7. 炸弹

| 规则 | 来源 | 设计处理 |
|---|---|---|
| throwBomb 在当前格放置并消耗动作 | GUIDE_CONFIRMED | 执行 phase 创建 |
| 10 帧后爆炸，爆炸后 owner 再冷却 10 帧 | GUIDE_CONFIRMED | absolute deadline |
| 爆炸覆盖中心及四方向最多两格 | GUIDE_CONFIRMED | BlastCache |
| 墙阻挡且不毁；土堆被毁并阻断该方向 | GUIDE_CONFIRMED | phase batch resolve |
| 炸弹可伤害 owner 和 allies | GUIDE_CONFIRMED | owner/team 不免疫 |
| shield 可阻挡一次 bomb hit 并消耗 | GUIDE_CONFIRMED | damage event |
| 开放地炸弹在 game.bombs；草中炸弹隐藏 | GUIDE_CONFIRMED | ConfirmedRegistry + belief |
| placed 到 exploded 的平台 record-frame 差为 10 | PLATFORM_REPLAY_CONFIRMED | 38 个可配对样本全部为 10；内部使用绝对 deadline，不假设 recordIndex=platformFrame |
| bomb explosion 在双方 action、star collection 和 projectile 之后 | PLATFORM_REPLAY_CONFIRMED | 38 个爆炸 frame 均在 action 后，存在 projectile 时均在 projectile 后 |
| 爆炸按 action 后位置判定伤害 | PLATFORM_REPLAY_CONFIRMED | 已观察移动出 blast 后存活、移动入 blast 后死亡的因果样本 |
| game.bombs 对象的完整字段和稳定 ID | UNKNOWN | 物理签名协调 |
| 炸弹是否连锁、与子弹的特殊交互 | UNKNOWN | 不猜测，定向模拟 |

## 8. 技能

| 规则 | 来源 | 设计处理 |
|---|---|---|
| 双方 skill type/cooldown/active 信息公开 | GUIDE_CONFIRMED | 技能身份不进入 hidden belief |
| shield 最多 4 帧，阻挡两次 bullet hit，冷却 25 | OFFICIAL_UPDATE_CONFIRMED/GUIDE_CONFIRMED | hit count 独立结算 |
| freeze 2 帧，排队命令不丢弃 | GUIDE_CONFIRMED | EnemyCommandBelief |
| seat0 freeze 当帧可抑制 seat1 action；seat1 freeze 不追溯取消 seat0 action | PLATFORM_REPLAY_CONFIRMED | 14 个 seat0 cast 与 5 个 seat1 cast 的 ordered-event 证据 |
| stun 6 帧，命令可能正常或反向 | GUIDE_CONFIRMED | ChanceKernel |
| stun 正常/反向的准确概率 | UNKNOWN；外部模拟器为 50/50 | 概率范围，Proof 全覆盖 |
| overload 可持有最多 10 帧，冷却 32 | GUIDE_CONFIRMED | capability state |
| cloak 隐身 6 帧 | GUIDE_CONFIRMED | visibility module |
| poison 降低行动 cadence 4 帧 | GUIDE_CONFIRMED | FrameTimeline capability |
| poison 冷却 20 帧 | OFFICIAL_UPDATE_CONFIRMED/GUIDE_CONFIRMED | 外部模拟器 25 必须拒绝 |
| poison 施加后按相对节拍 `ACT-HOLD-ACT-HOLD` 执行动作，HOLD不出队 | PLATFORM_REPLAY_CONFIRMED | 30个完整样本一致；Fast按相对effect phase执行 |
| poison 队列为空后同帧是否重新poll/精确ready边界 | UNKNOWN | 有限empty-repoll variant；依赖时Value区间、Proof/Fast incomplete |
| teleport 合法目标、星格随机邻格、近敌 fire lock | GUIDE_CONFIRMED | ActionFamily + chance |
| teleport 随机邻格概率分布 | UNKNOWN；外部模拟器为合法邻格均匀分布 | 候选范围与概率界 |
| boost 6 帧、移动和免费转向规则 | GUIDE_CONFIRMED | 原子复合 action |

## 9. 终局与 runtime

| 规则 | 来源 | 设计处理 |
|---|---|---|
| 整局 platform runtime 总上限约 3 秒，超限终局 reason 为 `timeout` | PLATFORM_REPLAY_CONFIRMED | 7 局 loser 累计 runtime 为 3002–3084ms；精确比较边界仍未知 |
| 累计 1.5 秒后永久 fallback | DESIGN_POLICY | 同内核缩减 SearchProfile |
| 1.0–1.5 秒逐步降级 | DESIGN_POLICY | DEGRADED |
| 终局 frameLimit 为 128 records | PLATFORM_REPLAY_CONFIRMED | 12 局以 star/runTime 结算；recordIndex 127 完整执行后 terminal |
| `runTime` 是同星终局 tiebreak；`timeout` 是独立 3 秒失败 | PLATFORM_REPLAY_CONFIRMED | 终局 reason 与累计 runtime 样本明确分离 |
| 当前Guide的`runtime`可靠性失败标签 | GUIDE_CONFIRMED；形状分类待增量校准 | 保留raw大小写；无mutual/frame-limit tiebreak形状时映射RUNTIME_TIMEOUT，冲突时incomplete |
| 单方 crash 直接由 crash 决定，不再比较 star/runtime | PLATFORM_REPLAY_CONFIRMED | 211 个单 crash 提前终局样本 |
| 同帧双方 crash 先比 star，同星再比 runtime | PLATFORM_REPLAY_CONFIRMED | 13 个 double-crash `star` 和 1 个 double-crash `runTime` 样本 |
| frame limit 先比 star，同星再比 runtime | PLATFORM_REPLAY_CONFIRMED | 11 个 `star`、1 个 `runTime` 的 128 长度样本 |
| 固定星数触发提前胜利 | INFERRED（244 局负证据） | 当前语料未观察到；不得实现早期 star threshold，除非新增官方/平台证据 |
| 128 records 边界 | PLATFORM_REPLAY_CONFIRMED | recordIndex 127 仍完整执行 action/projectile，随后 terminal；模糊 frame 坐标返回 input incomplete |
| runtime 精确相等和 3 秒精确比较符 | UNKNOWN；有限 RuleVariant | DRAW/seat-order 与 `>=`/`>` 候选；Proof 遇到命中边界时 UNKNOWN |

## 10. 设计政策

| 政策 | 来源 |
|---|---|
| ForcedWin 优先于所有软策略 | DESIGN_POLICY |
| 已提交子弹/炸弹导致的终局失败在评分前过滤 | DESIGN_POLICY |
| 敌方未开火但可能开火属于风险层 | DESIGN_POLICY |
| risk=0 使用所有可能场景的最坏值 | DESIGN_POLICY |
| risk=100 仍保留 1% 最坏情况权重 | DESIGN_POLICY |
| 强制胜利必须覆盖所有合法技能与 chance 回应 | DESIGN_POLICY |
| 物理死亡与终局失败分离 | DESIGN_POLICY |
| fallback 仍运行缩减 Minimax，不运行 Monte Carlo | DESIGN_POLICY |
| 一局内只更新对手参数，不调整我方权重 | DESIGN_POLICY |
| 历史死亡只产生反证/风险证据，不自动生成硬失败 | DESIGN_POLICY |
| 历史动作分叉后不复用原 replay 后缀 | DESIGN_POLICY |
| v1、历史 replay 和反事实工具全部离线隔离 | DESIGN_POLICY |
| 正式版无日志 | DESIGN_POLICY |

## 11. 待验证优先级

P0：

- 多弹/土堆/盾同 phase 结算。
- game.bombs 与多 projectile 运行时形状。
- runtime 精确相等与 3 秒 comparator。
- 多 bomb 同 phase 的 damage/map 批处理顺序。

P1：

- stun 和 teleport chance 概率。
- 隐藏炸弹的观察恢复规则。
- 敌方命令队列可推断字段。
- poison空队列repoll/ready frame、freeze 空队列 polling 与精确 ready deadline。

P2：

- JavaScript剩余引擎能力、代码大小、TypedArray性能（`Math.imul`缺失和Uint16/Uint32可用已知）。
- multiplayer guide 和多人 Adapter。

## 12. 构建输出

构建脚本生成：

- RULESET_VERSION；
- source manifest 与规则证据摘要；
- confirmed rule flags；
- unknown outcome flags；
- FrameTimeline phase table；
- TerminalPolicy；
- skill capability table；
- phaseOrderId；
- 待验证规则清单。

规则来源字符串和说明不进入正式热路径。

## 13. RuleVariant 与迁移

RuleVariant 是开发/验证层对规则实现不确定性的表达，不是 EnemyAction、HiddenWorld、ChanceOutcome 之外的第四种搜索量词。

- 每个未决规则拥有独立 rule id、候选 variant 和 assumption bit；
- ReferenceKernel 可对一个 fixture 穷举候选 variant 并产生结果区间；
- 激活规则仍有多个 variant 时，严格 Proof 必须返回 UNKNOWN；
- Value 可传播跨 variant lower/upper，但不得把外部模拟器 variant 当作名义概率；
- 平台确认后只生成一个 variant，递增 RULESET_VERSION，并使所有依赖规则版本的转换、危险、TT、Proof 和 Plan 缓存失效；
- 正式 FastKernel 不携带 variant 列表和证据字符串，避免扩大 Minimax 分支与脚本体积。
