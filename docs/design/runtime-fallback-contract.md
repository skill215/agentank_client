# DD8 RuntimeController、Fallback 与 Emergency 合同

状态：DD8 规范合同，2026-07-16；IMP2官方runtime probe修订。冻结“无已确认安全墙钟”平台上的校准工作量预算、1.5秒等价fallback目标、约3秒平台预算下的emergency reserve、模式转换、可缩减/不可缩减工作和缩减Minimax边界。

关联：`DEC-0009`、`DEC-0020`、`DEC-0021`、`DEC-0058`；`OI-R3-003`、`OI-R3-004`；[terminal-proof-algebra.md](terminal-proof-algebra.md)、[cache-inventory.md](cache-inventory.md)。

## 1. 已知与未知

平台replay证据：7个timeout局约在3002–3084ms结束，因此整局累计预算约3秒。精确`>=`/`>`、计费实现和live累计值不公开，算法不得踩线。

IMP2官方candidate simulate补充确认：当前v2 main sandbox中`Date`被观察为对象而不是函数，`performance`与`setTimeout`不存在；`game`、`me.status`和`me`公开键中没有累计runtime。一次直接`Date.now()`候选以不可调用父对象失败；后续把`DateNull/DateNow`加入同一probe的POST响应超时且结果不确定，按平台写操作纪律没有盲重试。因此正式CapabilityProfile把`runtime.Date.now`保留为`UNKNOWN`而不是伪造`SUPPORTED`，当前构建没有已确认安全墙钟。另一个纯整数长循环在单次`onIdle`的1500ms处被`script timeout`看门狗终止。这个1500ms callback watchdog与整局约3000ms累计终局是两个不同限制，禁止混成同一个门。

v1的`runtimeClockMs()`只在`Date`与`Date.now`均为函数时读取时间，否则返回0；累计器也只接受大于0的起点。这个保护逻辑应继承，但在上述v2能力下不能证明线上实际进入了计时分支。v1亲测稳定的可继承核心是它同时设置了`AT_MAX_NODES`、`AT_NODE_LIMIT`、固定depth/rollout等硬工作量上限。v2把这些分散常量统一为版本化`RuntimeCalibrationProfile`，避免“时钟返回0即无限搜索”。

冻结政策：

```text
FALLBACK_TARGET_EQUIVALENT_MS = 1500  // ACCEPTED校准目标；平台内无可读毫秒
EMERGENCY_TARGET_EQUIVALENT_MS = 2500 // BUILD_CONFIGURED校准目标
REFERENCE_PLATFORM_BUDGET_MS = 3000  // evidence reference，不作可用deadline
CALLBACK_WATCHDOG_MS = 1500           // PLATFORM_SIM_CONFIRMED硬上限
INITIAL_EMERGENCY_RESERVE_MS = 500    // 2500..3000，发布前P99验证，只可增加或以平台证据调整
```

1.5秒仍是确定的策略切换目标，但在`NO_WALL_CLOCK`能力下由不可变`RuntimeCalibrationProfile`把累计work units保守映射到时间上界；不是伪造毫秒计数。fallback depth/节点/iteration不是2步常量，必须由benchmark profile选择。2.5秒/500ms是首个安全build配置，不宣称平台精确规则；任何平台校准显示不足时降低work limit、提高reserve或提前emergency。

## 2. RuntimeState

```text
matchRuntimeGeneration
runtimeBudgetMode                 // WALL_CLOCK | CALIBRATED_WORK_COUNTER
accumulatedCompletedMs
currentCallbackStartedAtMs
accountedRuntimeMs
accumulatedWorkUnits
currentCallbackWorkUnits
fallbackEnterWorkUnits
emergencyEnterWorkUnits
perCallbackWorkUnitLimit
runtimeCalibrationProfileId/hash
lastPlatformFrame
matchFingerprintLo/Hi
runtimeMode
fallbackLatched
clockHealth
runtimeSafetyScaleQ10000
lastCheckNodeCounter
searchBatchBudget
emergencyReason
```

RuntimeState属于PersistentArena，不进PhysicsHash/DecisionHash/Proof。`SearchBudgetProfileId`可随mode变；只有Eval/horizon等值语义变化才进入SearchSemanticProfile/ValueSearchKey。

## 3. Clock、工作量计数与累计

`CapabilityProfile`决定预算模式。当前官方v2固定为`CALIBRATED_WORK_COUNTER`；只有未来平台能力证据把可调用时钟升级为`SUPPORTED`并通过单调性测试时才可启用`WALL_CLOCK`。生产不得把缺失时钟返回0后继续假装正常计时。

```text
beginCallback:
  detect new match conservatively
  if WALL_CLOCK: start = clock() at most once
  if COUNTER: callbackWork = fixed root/adapter charge

periodicCheck:
  solver reports completed batch kind/count
  add generated integer work units from RuntimeCalibrationProfile
  compare cumulative/callback work against immutable limits

finishCallback:
  if WALL_CLOCK: completed += measured wall time
  if COUNTER: accumulatedWork += callbackWork
  apply mode latch for next root
```

`RuntimeCalibrationProfile`逐类保存adapter、Fast transition、Hard、Value、Proof、matrix、cache、emitter的整数charge、P99上界、source/minified hash、引擎能力hash与校准证据。root解析、cache probe、consistency check、emitter和异常处理都必须计费；未知工作种类按最高保守charge或直接EMERGENCY，不能记0。

`CALIBRATED_WORK_COUNTER`不是随意的node count：其fallback limit必须使平台source/minified P99累计时间上界不超过1500ms等价目标，emergency limit不超过2500ms等价目标，per-callback limit还必须远离1500ms watchdog。不存在匹配当前build/hash/engine的校准profile时直接EMERGENCY且阻止发布。未来wall clock不可用、非数值、倒退或异常跳变时切回已验证counter profile；两者都不可用才fail closed。

## 4. 新局重置

只有明确新局证据才reset：

- platformFrame从正数回到0/更小，且map/seat/skill/root fingerprint符合新初始化；
-或平台提供的稳定match identity变化（若未来API公开）。

frame相同、多次callback、observation暂缺、地图对象引用变化都不能reset。证据歧义时保留较大的累计值，宁可早fallback；禁止通过重置绕过整局预算。

## 5. 模式状态机

```text
NORMAL
  -> DEGRADED
  -> FALLBACK (latched)
  -> EMERGENCY
```

### NORMAL

运行当前normal SearchProfile：iterative deepening、关键matrix/Proof、全部准入soft features/cache。

### DEGRADED

在未到fallback work limit但预测下一normal batch会越过累计或callback软预算、近期P99上升或arena high-water时进入。可降低expensive T3、matrix batch、下一depth尝试；仍可能在后续root恢复NORMAL，但不能越过fallback latch。

### FALLBACK

wall-clock模式`accountedRuntimeMs>=1500`，或当前counter模式`accumulatedWorkUnits>=fallbackEnterWorkUnits`，在前/后一次检查立即进入并`fallbackLatched=true`直到新局。运行专门`FALLBACK_MINIMAX_PROFILE`，不是Monte Carlo或纯贪心。

### EMERGENCY

满足任一：

- wall-clock accounted>=2500，或counter累计达到`emergencyEnterWorkUnits`；
- 当前callback达到`perCallbackWorkUnitLimit`，防止触碰1500ms watchdog；
- 预计下一个最小batch会侵入reserve；
- clock untrusted且无法建立上界；
- normal/search arena一致性失败或EmergencyReserve已启用；
- 剩余callback预算只够root Hard+emit。

只做事实协调、committed Hard、Terminal和确定性emitter所需最小工作。

## 6. 固定batch和预测

每个热solver不直接读clock。RuntimeController在以下batch边界收取固定charge并检查：

```text
N Fast transitions
N pure cells
N world/chance outcomes
N Proof/DFPN nodes
N matrix regret iterations
N feature/plan refreshes
```

每profile的N和work charge由function/composite、source/minified官方P99共同选择，使`worstBatchUpperMs`满足：

```text
worstBatchMs
+ rootConsistencyP99
+ hardEmergencyP99
+ emitterP99
+ clockAndSafetyMargin
<= remainingEmergencyReserve
```

线上预测器只用已冻结charge和completed batch整数计数，不读取主机时间；预测错误不能延长limit。开启下一depth/matrix round前检查能否完成，不能在大不可中断loop后才计费。离线runner从replay debug/runtime与本地benchmark更新下一版CalibrationProfile，但同一build运行中不得在线学习charge。

## 7. FALLBACK_MINIMAX_PROFILE

必须保留：

-根Observed/Tracked/Information协调与全部已知实体；
-每个可提交action的DD5 HardGate；
-committed projectile/bomb到规范失效；
-TerminalResolver与同星/runtime保守policy；
-已缓存/低成本Immediate ForcedWin验证和唯一安全action；
-缩减但非零的pure Minimax/interval search；
-TacticalClosure处理当前弹、bomb、shield、最后星/terminal；
-lossless support或显式incomplete；
-最后root action generation/PRNG/emitter校验。

允许缩减：

-benchmark-selected decision depth（不写死2）；
-尝试下一depth的条件；
-关键matrix数量/iterations，通常回pure interval；
-DFPN completion额度但不改变已证明结论；
-T2/T3 soft features、OpponentModel refine、future star model；
-cache write、optional REGRET/TRANSITION cache；
-continuation basis数量，但对应semantic id/Value interval必须正确。

禁止缩减：

-active实体/committed closure；
-Hard action级验证；
-terminal phase/batch；
-已声明Proof coverage；
-Possibility support后仍声称complete；
-root undo/hash/ActionKey/emitter；
-将incomplete当safe。

fallback depth由候选profiles在函数/复合/全景/终局/完整对局上选择，目标是最深可稳定完成而不侵入reserve；不能因v1曾用2就冻结2。

## 8. Emergency action pipeline

初始化/每个root尽早维护`lastKnownEmergencyAction`，它必须属于当前root generation并通过cheap Hard检查。EMERGENCY时：

1. 完成root输入规范化和事实容量guard；
2. 直接生成小而完整的primitive/queued-compatible action family；
3. 对已提交hazard运行共享timeline/forbidden/reverse最小检查；
4. 处理resolved terminal/ForcedWin cache strict hit；
5. 若存在HARD_ALLOW，按safe lower/last complete fallback policy选择；
6. 只有incomplete时选不依赖未知交互的最保守action并保留reason；
7. 全reject用ForcedLossRecovery；
8. 校验root generation，提交一个deterministic ActionProgram。

EmergencyReserve独立预分配，不依赖ValueTT/FeatureCache/Plan/cache hit。emitter失败不得重跑完整search。

## 9. 同星与runtime终局

平台frame-limit/mutual crash同星比较runtime；对局中敌方实时累计不可见。TerminalPolicy继续按“我方runtime更高”保守处理。

RuntimeController的额外目标是减少真实累计，因此：

-same-star临近终局不允许以更多搜索换很小point gain；
-PRESERVE/terminal profiles提高runtime cost feature但不能改变terminal事实；
-fallback latch不因领先/落后解除；
-Proof/Hard正确性优先于耗时tie-break，不能为省时选择已证明LOSS。

## 10. Cache/Plan/Model交互

-mode变化不清空active entity/Plan/Proof；
-FALLBACK可读完全核验的cross-frame trajectory/path/value，miss重算最小路径；
-停止低收益cache write不能改变结果；
-OpponentModel在root可做O(events)提交，但fallback可跳过soft probability query；
-Plan只提供continue hint，必须重新Hard；
-runtime mode不进入Physics/DecisionHash；SearchSemanticProfile变化另key。

## 11. 故障与异常

正式`onIdle`外层使用固定try/finally完成work-unit结算与shadow commit discipline；wall clock只在Capability允许时作为附加测量。异常：

-任何partial Fast branch先undo；
-丢弃当前search generation/cache writes；
-进入EMERGENCY，使用独立reserve；
-若根事实本身无法无损表达，返回明确internal/input incomplete，禁止使用stale跨局action；
-正式版不console log，错误code只存在Persistent diagnostics bit供离线replay复现。

## 12. 参数校准门

候选项：degraded trigger、batch N/charge、normal/fallback depth、matrix/DFPN iteration、T2/T3预算、cache read/write policy、counter安全scale、per-callback limit和reserve。选择顺序：

1. Reference/Fast/Hard/Proof correctness；
2. function worst/P99和不可中断batch；
3. composite/full-state/terminal；
4. full-game累计runtime与work-unit fallback映射；
5. source/minified平台校准；
6. frozen forward runtime零失败。

任一timeout使profile不具发布资格；平均更深/胜率更高不能抵消。

## 13. 必须测试

-新局reset/同frame不reset/歧义不reset；
-wall-clock 1500ms或counter等价limit latch且永不恢复；
-wall-clock 2500ms、counter emergency limit或预测侵入reserve进入EMERGENCY；
-当前官方`Date=null/performance absent/no public runtime`选择counter而不是伪造0ms；
-无匹配CalibrationProfile、未知charge或charge溢出fail closed；
-当前callback work计入mode，不只看上帧累计；
-per-callback work limit在官方1500ms watchdog之前停止搜索；
-每solver在任意batch中断lower<=true<=upper；
-fallback仍运行benchmark-selected Minimax，不调用Monte Carlo；
-normal/fallback共享Fast/Hard/Terminal与active entity lifecycle；
-emergency在所有cache off/arena failure下仍可emit；
-同星terminal保守、runtime成本不覆盖Hard；
-source/minified计时/mode/action fingerprint一致；
-完整平台forward无timeout/error。

## 14. 冻结结论

当前平台没有已确认安全可读的墙钟，生产按经官方source/minified校准的整数work units运行：累计P99上界达到1.5秒等价门后永久进入缩减Minimax fallback，达到2.5秒等价门后只使用独立500ms emergency reserve，并以单callback 1500ms watchdog的独立安全上限约束任何不可中断工作。v1的能力保护和硬节点上限作为设计证据继承，但具体常量不直接复制。深度不固定为2，由真实性能选；无论模式如何，已提交危险、每action Hard、Terminal和root一致性都不能缩减。
