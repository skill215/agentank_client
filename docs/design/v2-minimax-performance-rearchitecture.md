# V2 Minimax性能重构：全宽浅搜、区间筛选与选择性深化

状态：`DESIGN / DIAGNOSTIC_EVIDENCE_READY`

## 1. 已确认的问题

固定Discovery的16场景、双换位32局只用于因果诊断，不作为最终胜率结论。

### 1.1 当前Runtime预算必然让长局回退

当前每帧固定计费至少包含：

```text
ROOT       1000
EMITTER     200
合计       1200 work units / frame
```

即使完全不执行Hard、Safety、Proof和Value search，128帧也会累计153,600单位，超过
150,000的FALLBACK阈值。当前预算合同因此表达的是“长局必回退”，不是“搜索成本过高时
回退”。

32局诊断中首次进入各模式的典型帧为：

```text
DEGRADED  约第16–18帧
FALLBACK  约第18–20帧
EMERGENCY 约第28–33帧
```

### 1.2 工作量并非只来自Minimax

3,054个决策帧、11,759,640个计费单位的构成为：

| 类别 | 单位 | 占比 |
|---|---:|---:|
| ROOT | 3,054,000 | 26.0% |
| EMITTER | 610,800 | 5.2% |
| 根部Hard（扣除Value节点Hard） | 2,016,120 | 17.1% |
| Value transition + node Hard | 4,081,600 | 34.7% |
| Proof/Observation safety | 1,809,920 | 15.4% |
| Feature/Plan | 187,200 | 1.6% |

搜索是最大的单项，但固定根、Hard和Emitter合计也占48.3%。所有类别共享一个终身累计
额度，使Value search为不可避免的固定工作让路。

粗粒度墙钟剖析进一步证明计费权重不能直接代表真实成本：

| 阶段 | 本地墙钟占比 | 平均单次 |
|---|---:|---:|
| InformationSearch | 30.67% | 2,498us |
| FinalHard | 22.95% | 192us |
| Observation | 4.95% | 42us |
| StageMatrix | 4.67% | 39us |
| PhysicalSearch | 3.84% | 5,456us |
| Committed EO | 3.47% | 29us |
| ProjectileAttack | 3.29% | 28us |
| ForcedWin | 0.34% | 208us |

`PROOF_NODE`在work ledger中占15.4%，但真正ForcedWin只占0.34%；该work kind还混入
ObservationSafety，并且权重明显失真。第一优化目标因此是InformationSearch和FinalHard，
不是Proof。

节点级剖析又把这两个阶段收敛到同一个根因：`FastKernel.applyFrame`平均约1.38us，叶评估约
0.42us，而`HazardKernel.reverseViable`平均约85us。它在3,054帧中被调用17,055次，累计约
1.45s，几乎占满`HardGate.classifyApplied`的时间。昂贵的不是Minimax循环本身，而是每个
后继状态都重复倒推整张committed危险可活网格。

### 1.3 当前生产路径主要不是Physical Minimax

325个Value搜索帧中：

- 307帧完成InformationSearch；
- 10帧完成PhysicalSearch；
- 8帧花费节点但没有完成可发布深度；
- 296帧完成depth 2，21帧只完成depth 1；
- 20,408个实际计费Value节点，平均62.8节点/尝试；
- InformationSearch平均只取1.02个HiddenWorld。

所以性能主战场是InformationSearch根矩阵与续算，不是HiddenWorld数量，也不是配置中名义上的
`decisionDepth=6`。当前真实有效深度基本为2。

### 1.4 只调预算或节点上限均失败

同一32局因果结果：

| 模式 | 得分 | 本地总耗时 | 结论 |
|---|---:|---:|---|
| CURRENT | 28.13% | 2.31–2.64s | 对照 |
| Value search全部关闭 | 9.38% | 1.50s | 当前早期Value search有正价值 |
| 延长原Fallback搜索 | 9.38% | 5.06s | 更多同结构搜索显著退化 |
| 持续浅搜 | 12.50% | 5.51s | 更晚fallback本身不构成收益 |
| depth2 / 128节点 | 14.06% | 2.19s | P95下降但单次搜索信息不足 |
| Proof缩至64/48/32 | 23.44% | 2.18s | 接近中性，不能直接采用 |

这些数据共同否定两条简单路线：只提高fallback阈值，或统一缩小每次搜索。需要减少重复计算，
同时保持每次搜索能获得的有效信息。

## 2. 新的搜索结构

```text
Observation / entity lifecycle
→ Shared ThreatLattice
→ Physical Hard + committed EO
→ Full-width shallow matrix
→ interval backup + contender frontier
→ selective continuation / proof refinement
→ Information risk overlay
→ Risk / Strategy / final owner
```

### 2.1 Full-width shallow matrix

所有Hard允许的根动作和敌方第一动作都至少计算一帧，保留对FIRE、技能、GO、TURN、BOMB的
完整覆盖。第一层只计算一次Fast transition、terminal、Hard和廉价leaf bounds，并把结果保存到
固定`RootTransitionSlab`。

禁止在第一层按启发式直接砍掉动作。这样避免128节点方案因为缺少根信息而退化。

### 2.2 Contender frontier

每个根动作保存：

```text
lowerValue
upperValue
worstCompletedResponse
unresolvedResponseCount
supportComplete
risk/committed certificate bits
```

先删除`upperValue < bestLowerValue`的动作。其余动作进入contender frontier；通常只需深化2–3个，
但数量不是固定魔数。区间重叠时继续扩大，直到：

- 某动作的lower严格高于其他动作upper；或
- 预算用尽，返回最后完整区间和稳定后备动作。

不完整结果不能假装exact，也不能仅因“搜索运行完成”取得动作所有权。

### 2.3 Selective continuation

深化顺序固定为：

1. 当前best lower对应动作的最坏敌方响应；
2. upper最高的竞争动作；
3. 能改变terminal/committed safety的响应；
4. 其余响应。

敌方列先全宽浅评估，深层只展开当前最坏列及仍可能改变worst bound的列。ChanceOutcome只在
successor hash、terminal、Hard或observation不同的情况下保留独立分支。

当前约`5.77 × 4`的Information根矩阵仍会完整覆盖，但约40个续算节点不再平均分给全部根动作。
若最终只有2个contender，目标是把平均Value节点从62.8降至35–42，同时保持或提高完成证书率。

### 2.4 Physical skeleton + Information overlay

当前InformationSearch通常只采用一个HiddenWorld，却仍建立独立搜索流程。新结构先在committed
PhysicalState上生成共享浅层和continuation结果，再仅对受隐藏信息影响的`row × response`单元
应用Information overlay：

- possible projectile；
- hidden muzzle/FIRE；
- observation split；
- incomplete support上界。

未受影响的单元直接复用Physical结果。Information overlay只能收紧区间或增加风险，不能把不完整
状态升级为Hard或strict Proof。

### 2.5 Shared ThreatLattice

当前ObservationSafety共审计2,105个动作，并与SafetyClosure、MultiFrameRisk、EO重复推演相近的
危险时间窗。改为每帧按committed实体和ThreatSignature构造一次反向危险格：

```text
threat[t][cell][direction]
viable[t][cell][direction]
earliestFatal[cell][direction]
escapeSlack[cell][direction]
```

Hard、EO、Safety、Information overlay和leaf evaluator只查询该格。future FIRE/possible projectile
保留独立soft层，不能写committed Hard。

第一版已经实现语义中性的`ReverseLatticeCache`：key只包含地形版本、敌方committed弹丸几何、
炸弹位置/剩余时间和perspective；value是完整的`viable[0][cell][direction]`网格。坦克位置、
朝向和我方FIRE不会改变committed危险场，因此后继状态只做O(1)落点查询。

固定64场景、双换位128局的cache-on/off结果。为排除Node/JIT冷热顺序，
`CURRENT→OFF`和`OFF→CURRENT`各完整运行一次：

| 指标 | Cache off | 16槽生产 | 结果范围 |
|---|---:|---:|---:|
| 逐帧动作/参数/帧数/终局差异 | 0 | 0 | 完全等价 |
| 命中率 | 0 | 80.28% | 54,027 / 67,299 |
| 总本地耗时 | 9.54–9.56s | 4.40–4.87s | -49.01%至-53.83% |
| ReverseViability耗时 | 5.99–6.00s | 1.44–1.50s | -75.09%至-75.91% |
| P95最大值 | 8.69–9.69ms | 2.16–3.70ms | -61.84%至-75.14% |

16场景容量消融中，1/2/4/8/16槽命中率依次约为
65.6%/73.9%/76.2%/78.7%/80.3%。同时发现原实现错把128帧终局上限当成committed
hazard生命，在32×32地图上仅`exposure+lethal`就消耗526,336B。弹丸直线出界最多
`max(width,height)`tick，炸弹最多`BOMB_FUSE×PROJECTILE_STEPS`tick；因此时间轴改为这两个
物理上界的最大值，越界观测显式`INCOMPLETE`。最大地图的生产固定TypedArray因此为
732,552B，含16槽tick0/tick1/tick2缓存，低于1MB门且余量约267KB。

`DeadlineKernel`原先又独立计算同一套tick0/tick1/tick2反向层。将tick1/tick2随缓存条目保存后，
固定16场景中EO层命中665次、未命中108次（86.0%），正反执行顺序下`CommittedEO`墙钟分别
下降63.2%和59.5%，动作指纹仍完全一致。生产默认因此共享这两层。缓存命中复制改为
固定循环，不再调用会创建临时TypedArray view的`subarray()`。

HP7进一步闭合冷root：若Deadline先于其他消费者查询，它不再私建第二套reverse DP，而是要求
HazardKernel生成canonical lattice后读取共享tick层。EO一次填充固定后继slab；最早致命tick只对
实际投影到的格子惰性计算并在root内缓存，不做全图时间线扫描。真实
`FinalHard → InformationSafetyClosure → EO`五批基准中，累计共享架构将反向构建节点从
149,704降至53,080（-64.54%），Hard/Safety/EO指纹差异和声明热分配均为0。possible projectile
与future FIRE继续留在soft Information层，不能进入committed lattice或Hard。

### 2.6 缓存与跨帧复用

- `RootTransitionSlab`：同一根内的joint action/chance只apply一次；Proof、Value和Safety共享。
- `SuccessorTT`：按完整Physical hash、belief/threat signature和generation保存完整区间。
- `PrincipalVariationCache`：上一帧已实际发生的子节点优先成为本帧PV，不匹配则立即失效。
- `ThreatLatticeCache`：弹丸/炸弹generation和terrain generation未变化时增量推进，不全量重建。

任何cache关闭时必须得到同一完整结果；cache miss只能降低性能，不能改变事实语义。

## 3. Runtime预算重构

### 3.1 校准而非任意权重

保留确定性work counter，但每种work kind必须用同Node版本、固定输入、预热后五批测量得到相对
成本。平台3秒仍由官方simulate校准，本地时间只比较同输入V1/V2和改动前后。

计费分成两个可审计账本：

```text
mandatoryEstimatedWork = observation + Hard + committed safety + emitter
optionalEstimatedWork  = Proof + Value refinement + matrix refinement
totalEstimatedWork     = mandatory + optional
```

两个账本不能让mandatory“免费”；它们用于保证可选搜索不会因为固定费的错误常量被提前关闭，并为
剩余Hard/emitter预留真实测得的尾部成本。

### 3.2 Fallback保持最小Minimax语义

```text
NORMAL     全宽浅层 + selective continuation + eligible strict proof
DEGRADED   全宽浅层 + 较小contender frontier + PV continuation
FALLBACK   全宽浅层 + 仅最坏响应的一次continuation
EMERGENCY  Hard/EO + 已完成PV/稳定策略；不发布部分搜索
```

fallback不再等于“完全不用Minimax”，但任何层级都只能发布最后完整的区间/策略。具体阈值必须在
平台校准后决定，不能用本地毫秒直接替代3秒证据。

### 3.3 搜索能力与决策强度是两条独立轴

Minimax性能改进不以整局胜率为验收门。性能轴只回答“在同一计算预算内能完成多少
搜索”：

```text
Minimax active frame ratio
first DEGRADED / FALLBACK / EMERGENCY frame
completed depth histogram
fully completed root count
visited nodes and nodes per microsecond
budget interruption / incomplete result count
same input total / P95 / maximum time
```

决策轴在冻结搜索能力后，另外回答“搜索的值、量词、模型和所有权是否正确”：

```text
exhaustive oracle / interval nesting / cache equivalence
model and quantifier correctness
action ownership and horizon-effect diagnostics
paired W/L/D, kill conversion and whole-game score
```

因此，更深搜索导致胜率下降时，性能版本仍然可以通过；该结果转化为决策层的缺陷证据。
常见根因是叶评价的horizon effect、InformationState支持不完整、错误量词或浅层值过早获得动作
所有权，而不是“搜索变快了”。

### 3.4 当前深度的真实结构上限

HP2已经删除Physical和Information中的伪depth上限，HP3又删除了Physical内部重复的250节点
最坏情况上限。当前名义profile仍是depth 6，但剩余限制已经收敛为搜索规模：

- Physical会在完整depth 2之后继续尝试depth 3–6；窄接触root已经能从436个实际节点完成P3并
  尝试P4；
- 固定16场景的较宽root即使把P95节点从250提高到512，P3完成数仍为0，说明瓶颈不再是控制流
  或提前fallback，而是joint action分支规模；
- Information明确记录一层Information root和独立Physical continuation；不能把更深Physical
  continuation冒充成多层Information证明；
- 下一次规模优化必须保持根动作/敌方响应的第一层覆盖，优先复用RootTransition、压缩重复
  ChanceOutcome和只深化仍可能改变区间的contender，不能重新采用未经证明的Top-K根剪枝。

## 4. 实施顺序

### HP0：诊断与基准

- 保留现有work ledger、首次mode帧、搜索节点/深度/路径统计；
- 增加函数、复合、root、整局四层phase timing；
- 固定16场景开发集和独立32场景验证集；
- 默认动作指纹不变。

### HP1：ReverseLatticeCache（已实现）

- committed危险签名复用完整反向可活网格；
- Hard和Deadline/EO共享tick0/tick1/tick2层；
- cache on/off逐帧动作、参数和终局完全一致；
- 危险时间轴按物理最长生命分配，不再按128帧终局上限分配永远不会访问的行；
- 生产默认16槽，固定TypedArray，热分配为0，32×32最大地图仍低于1MB门；
- 128局总耗时下降47.6%，硬不变量保持为0。

#### 已拒绝的规模压缩

- 根动作Top-K：K=4只覆盖88.27%的最终选中行，不能作为精确剪枝；
- 动态margin：要达到98.98%最终行覆盖时只节省4.5%根行，收益不足；
- 敌方列从4缩到3：只节省3.4%节点却造成14/32局动作流变化；
- StageMatrix迭代减半：求解器局部有收益，但整体墙钟无稳定改善；
- 降低Hard work-unit计费：搜索帧增加却使得分28.13%降到21.88%，说明缓存节省不能自动换成更多后期搜索所有权。

### HP2：解除伪depth上限（已实现）

- Physical的direct depth 2改为首个完整迭代，有剩余节点时继续depth 3–6；
- 深层中断只保留上一个完整depth，不得清空已完成结果；
- Information报告`informationRootDepth`和`physicalContinuationDepth`，不再用一个2混淆两种语义；
- 验收只看深度分布、完整root、节点/墙钟和不变量，不使用胜率门。

固定16场景、24个profile、每profile 80次测量的结果：

- Physical请求P3–P6时，已完成P2的60/80次全部继续尝试P3，不再从direct P2立即返回；
- Physical仍没有完成P3，因为callback reserve把512请求压缩为约250个实际节点；这已成为HP3的
  预算/规模瓶颈，不再是depth控制流缺陷；
- Information明确记录`informationRootDepth=1`和独立Physical continuation；P2完成率为
  75%–81.25%，P3为12.5%–18.75%，少量分支到达P4/P5；
- Information不完整support的冷/热缓存可获得不同深化覆盖；只有双方support完整且完成深度相同
  时才要求值完全一致，缓存额外完成深度单独记录；
- root restore、热分配、完整support缓存语义差异全部为0；Minimax 106、SR5 10、IMP5 14、
  GR0 240项测试全部通过。

### HP3：缓存感知work accounting（已实现）

- `HardGate`记录实际分类、ReverseLattice hit和完整build；Value搜索按`transition + cache probe +
  lattice build premium`计费，不再假设每个节点都重建ReverseViability；
- runtime新增mandatory/optional整数账本；根Hard和Emitter保持mandatory，Value及其Hard查询明确
  进入optional；总work和既有mode阈值不变；
- Physical和Information在每个可选节点前预留一次最坏Hard成本，trap probe和Physical
  continuation也受剩余optional单位约束；预算中断只保留最后完整迭代，不触碰尾部reserve；
- 删除`ProductionDepthSearch`内部第二个250节点reserve cap；生产根仍以50,000单位前的动态
  optional余额限制搜索，并按实际完成工作结算；
- 固定生产接触fixture从旧上限附近提升到436节点，完整P3并尝试P4，搜索work 38,888/
  39,044单位，root restore和热分配为0；
- 固定深度标定中Physical P2–P6冷P95节点从250提高到512。P2 P95耗时由651us变为646us，
  但宽root的P3完成分布没有变化；这证明缓存收益已兑换成节点，下一瓶颈是树规模而非预算接线；
- Information profile的深度、节点和support分布保持一致；全套标定的root restore、热分配和完整
  support缓存语义差异均为0；Minimax 108、SR5 11、IMP5 14、GR0 242项测试通过；
- HP3基线冻结为`config/engine-v2/minimax-depth-baselines/after-hp3.json`。胜率没有参与本阶段
  ACCEPT判断，也没有运行arena。

### HP4：RootTransitionSlab（已实现）

- 新增固定整数`RootTransitionSlab`，缓存根joint action/chance的最终delta、64位后继hash和Hard
  事实；回放仍通过`FastState.write/undoTo`，任何身份、容量或hash不一致都回退完整FastKernel；
- FinalActionGate、ForcedWin和Physical Value共享同一Slab。纯P2且没有跨消费者条目时不建缓存；
  Information隐藏世界和其Physical continuation不接入，因为根身份不同，首轮消融显示几乎零命中且
  多数profile变慢；
- 同源码ON/OFF消融中Physical P1–P6 cold P95全部下降32–181us，warm P95全部下降
  140–228us；生产接触fixture在同一39,044 work上限下由436节点增至493节点（+13.1%），
  完整P3并继续尝试P4；
- 固定16场景的节点上限仍为512，因此完成深度直方图不变。这说明HP4已降低重复根成本，但宽root
  的下一限制仍是分支规模，不能把“没有新增P3完成数”误判为缓存无效；
- Slab占146,028字节，32×32最大地图ProductionRoot TypedArray总量878,580字节，低于1MB门；
  Minimax 111、SR5 11、IMP5 14、GR0 245项通过，值语义、root restore、热分配和回放失败均为0；
- 当前基线为`config/engine-v2/minimax-depth-baselines/after-hp4.json`。本阶段未运行arena，胜率
  未参与ACCEPT判断。

### HP5：全宽浅层与区间合同（已实现）

- Minimax oracle覆盖exact/incomplete/chance/simultaneous/Information量词；
- full-width一层与旧搜索逐格值一致；
- budget中断只返回区间，不改变Hard/Proof。

实现结论：根cell/row/root使用固定整数lower/upper；完整cell为`[v,v]`，未访问或支持不完整为
`[-32000,32000]`。完整性采用稀疏异常标记，避免在每个递归frame上传播complete位。768组嵌套
量词oracle、所有严格预算前缀和Hard incomplete fixture通过；相对HP4的Physical cold/warm P95
均不超过106.1%，节点和完成深度不变。基线冻结为
`config/engine-v2/minimax-depth-baselines/after-hp5.json`。区间当前只提供证据，不取得动作所有权。

### HP6：Contender selective continuation（已实现）

- 固定深度内以已完成敌方响应形成行upper，以完整行形成incumbent lower；浅层结果只排序，不能作为
  跨深度bound；
- 6,561个4×2矩阵和所有严格预算前缀中，已证最优动作/值零误判，未证明时一律fail closed；
- 16个真实fixture的已解析搜索Value节点下降超过30%；固定标定P3的冷/热节点中位数从512降至
  418/243，40/80次额外得到depth-3稳定动作证书；
- P1/P2保持全矩阵；部分depth-3证书不写最终cell、不写Hard/Proof，也不直接取得动作所有权；
- Physical root与Information continuation使用独立TT命名空间，禁止中断Physical根改变Information
  预算内cache集合；
- 根据性能与决策质量分离的明确约束，删除旧“32局得分”验收项。arena只监控调度副作用，胜率、
  击毁和叶评价留到冻结性能profile后的HP10处理。

### HP7：ThreatLattice扩展共享（已实现）

- 冷root也只由Hazard构建一次canonical tick0/tick1/tick2 reverse lattice，Deadline private DP仅为
  明确的兼容回退；
- EO通过固定slab批量写候选后继质量，最早致命tick按候选格惰性缓存，热路径不创建对象；
- committed死亡和逃生fixture与现有oracle完全一致；
- 实际Hard/Safety/EO组合基准的重复反向构建节点下降64.54%，超过40%门；
- possible/future threat仍不写Hard，搜索深度与动作所有权不变。

### HP8：跨帧PV与TT（已实现）

- 分开验证“上一帧根PV排序”和“精确Successor-TT深层排序”。前者使实际后继fixture节点增加
  3.45%，因此production默认只Shadow记录，不改变根动作顺序；
- TT条目除value外保存完整我方/敌方program。只有exact、complete、较低深度条目可在同一子树
  内提升代表动作，不能改变动作集合、区间、Hard、Proof、Risk或根所有权；
- 身份包含完整Physical hash、topology version、NEXT_ENTITY、risk、width和match/root
  generation。任一不匹配、支持不完整或容量不足都fail closed；
- Root principal证据使用256槽固定整数紧凑slab；不为全部4,608个root transition分配PV元数据，
  容量溢出显式计数且禁止覆盖；
- 16个真实父root→实际joint successor同源码消融中，节点由5,651降至5,573（-1.38%），P95
  由300.12us降至272.91us（-9.07%）；深层提升111、根提升0、语义差异/restore/overflow均为0；
- cache on/off动作、值、区间和root restore一致，热分配为0；ProductionRoot TypedArray为
  889,188字节，低于1MB门；
- 当前基线为`config/engine-v2/minimax-depth-baselines/after-hp8-final.json`，专用报告为
  `artifacts/benchmarks/cross-frame-pv/hp8.json`。本阶段没有运行arena，胜率不参与性能验收。

### HP9：预算校准与资格

- 逐层测得work charge，不再使用“ROOT固定1000”式未校准常量；
- 16场景只用于开发，32场景验证后再读更大Holdout；
- Minimax有效帧比例、完整证书率和首次fallback帧必须同时改善；
- 性能资格不使用整局胜率作门；Hard、Proof、restore和timeout仍是不可破坏的正确性约束；
- 在同一搜索预算下做语义中性性能比较，再在同一性能版本上单独调试Minimax决策；
- 最后才用动态全量和官方simulate同时验证3秒安全与决策强度。

实施状态（2026-08-09）：本地`PASS_LOCAL`。五批exclusive阶段计时已生成十类整数work charge；
8场景同输入因果对照、16场景开发和不重叠32场景验证均通过完整迭代、110%耗时护栏及零结构错误门。
首次fallback中位帧由15推迟到41，搜索节点由22,012增至105,131；独立验证的2,494个搜索帧
全部发布完整迭代。平台比例仍为`PLATFORM_RUNTIME_SCALE_PENDING`，所以HP9不具备release资格。
实现和命令记录于`docs/implementation/hp9-runtime-work-calibration.md`。

### HP10：Minimax决策正确性（独立于HP9）

- 冻结HP9的cache、work accounting、node/depth profile，不再以胜率反向修改性能参数；
- 对每个完整深度验证区间包含与逐层收缩，中断层不得覆盖上一完整层；
- 分别校验Physical、EnemyAction、HiddenWorld、ChanceOutcome和ObservationSplit的量词顺序；
- 在固定性能profile下修正叶评价、风险backup和动作所有权，此时才使用胜率与击毁转化验收。

## 5. 明确不采用

- 不直接把fallback/emergency阈值乘倍数；
- 不把所有搜索统一压到128节点；
- 不依赖名义depth 6，改用“完整浅层 + 已证区间 + 实际深化层数”；
- 不在Information不完整时让部分Minimax值直接拥有动作；
- 不用新增启发式分数掩盖搜索未完成；
- 不在每次实验后运行全量arena。
