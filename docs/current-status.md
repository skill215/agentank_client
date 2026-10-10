# 当前状态

更新时间：2026-09-03（Asia/Shanghai）。

## 最新结论：BP179薄NativeBasePolicy上传根通过真实对局资格

BP178已经完成不依赖旧`ProductionRootEngine`的单栈`NativeBasePolicyEngine`；BP179用同一批
Discovery64场景、双座位，分别直接运行模块源码、bundle source和最终minified，共执行384次物理对局。
三种形态均为71胜45负12平、分析得分60.15%、单方击毁51胜31负、星差-11；128局的动作、参数、帧数、
终局reason、星/击毁、分析结果和终局类别差异全部为0，语义指纹同为`c9e3caac...22d0d8`。

最终minified为180,466字节，低于204,800字节平台限制并剩24,334字节；两次构建SHA一致。完整Minimax
测试265/265通过，timeout、error、root restore failure和热分配均为0。11个原始winner差异全部来自
128帧同星时的本地耗时裁决，按既有合同记平，不参与算法资格。

因此后续V2开发以薄NativeBasePolicy根为工作基线，旧ProductionRoot双栈只作回归参考。当前默认入口、
官方Candidate和平台状态均未改变；下一步先做独立角色切片外推与失败归因，不执行官方simulate或发布。
证据见`config/engine-v3/base-policy-kernel-bp179-upload-qualification.json`和
`docs/implementation/base-policy-kernel-bp178-bp179-thin-upload.md`。

## 最新结论：BP174–BP177确认上传阻塞来自双栈，并完成BP68闭合编译

BP174首次把`ProductionRootEngine + NativeBasePolicyRoot`做成独立候选：安全mangle后仍为684,158字节，
远超204,800字节平台上限。模块普查证明原因不是Terser失效，而是旧ProductionRoot和新BasePolicy同时
进入bundle；默认入口73模块，新入口80模块，BasePolicy独立闭包本身安全mangle为174,983字节。

BP175把当前ProductionRoot中的`ProductionEntityTracker/ProductionObservationAdapter`机械提取为
`production-observation.js`，12帧状态、实体、哈希和支持状态逐项等价。V8 fixed16覆盖同时显示旧根
125个函数有105个真实执行，说明不能靠删除几个未调用方法挽救双栈；应移除整套旧决策链，只保留一份
精确观察和一个薄原生根。

BP176先从BasePolicy移除纯诊断计数/summary，不删搜索层数、节点预算、动作域或值函数。紧凑root在
fixed16和Discovery64均与接受实现逐动作零差异。BP177进一步对固定的BP68 profile做编译期特化，把
运行期永远不变的mode分支和通用构造消掉，仍保持`depth=3`、`budget=128`：

- fixed16：21/11/0，32局动作指纹`e40ea471...574e998`，全部语义差异0；
- Discovery64：67/48/13、57.42%，128局动作指纹`d6db15f8...f1162555`，全部语义差异0；
- Hard、Risk dominated、root restore、timeout/error均为0；
- Minimax完整测试251/251。

相同Terser配置下，紧凑BasePolicy为160,777字节，闭合特化后为145,694字节；闭合BasePolicy加精确
Observation为173,840字节，再加入现有完整Risk/Safety为199,115字节，仍在平台上限内并剩5,685字节。
这还不是可上传Tank：缺少候选投影、根Hard/Risk接线、非接触fallback和最终emit。下一阶段应实现一个
薄`NativeBasePolicyEngine`，不得重新引入旧ProductionRoot，也不得为体积降低Minimax深度。
机器证据见`config/engine-v3/base-policy-kernel-bp177-footprint-evidence.json`。

## 最新结论：BP173把NativeBasePolicyRoot接入真实ProductionRoot，默认仍关闭

`ProductionRootEngine`现在接受显式注入的`nativeBasePolicyRoot`，接点位于callback预算结算之后、真实
emit之前。默认构造仍为`null`，production源码没有静态`require("../base-policy")`，也不会构造
`NativeBasePolicyRoot`，因此现有上传入口不会因该候选接点自动携带81,879字节共享组件图。发生动作覆盖
时，旧DepthSearch principal和旧Plan均不伪装成已提交。

第一次直接把内部接点用于每一帧是错误的：固定16从21胜11负退化到17胜15负，25/32局动作流改变。
首个分歧发生在STUN之后；BP68已接受宿主原本先发射非poison技能、再进入外部BasePolicy回调，因此
这些资源帧不会推进Intent、OpponentHistory和superko。内部接点若在技能帧仍观察BasePolicy，就会让
下一帧历史错位。最终合同把非poison自身技能明确归还Resource Controller并跳过BasePolicy；poison仍
属于V2/BP68正常候选域。这是所有权修复，不是分数或深度补丁。

修正后，当前默认关闭版本、注入启用版本和BP170接受基线在固定16的动作、参数、result、帧数、物理
计数、分析胜负和终局类别全部零差异，指纹均为`e40ea471...574e998`，保持21/11/0。Discovery64的
128局与BP172外部root再次逐项零差异，指纹同为`d6db15f8...f1162555`，保持67/48/13、57.42%。
Hard、root restore、timeout/error和joint dominated selection均为0；完整Minimax UT为247/247。

production root源码哈希现为`3381b6f9...54017f8`，但默认动作语义不变。跨运行耗时不作为性能结论；
BP171同进程五批仍是已接受的本地性能证据。下一步是建立显式候选构造/打包入口，检查source/minified
逐动作等价与平台体积；在此之前不默认启用，也不执行官方simulate。证据见
`config/engine-v3/base-policy-kernel-bp173-production-hook-evidence.json`。

## 最新结论：BP172把七个薄组件收敛为单一无VM原生根

`NativeBasePolicyRoot`现在统一装配thin owner/domain/intent/opponent/search/leaf/path，直接复用
`ProductionRootEngine`已有的FastState和Risk/Hard/EO slab；root自身新增TypedArray为0、重复world state为0，
完整共享组件图固定TypedArray为81,879字节。冻结profile为BP68的`depth=v1-state`、budget=128、
`v1-exact` opponent/path、joint Risk，以及BP171接受的两项星图cache和geometry table。源码不引用V1 VM、
V3 bot或任何diagnostic类。

固定16只切换分散装配到新root，32个候选局动作指纹同为
`e40ea471198b7eaea3dbb4b0591f86df973f0b43d49614f44a3e50da0574e998`，动作、参数、result、
帧数、物理计数、分析胜负和终局类别全部零差异，仍为21胜11负。Discovery64的128个候选局再次零
差异，指纹同为`d6db15f8815dc9243ef758778bbeb558b6492f801e73e2fc36e4bd35f1162555`，结果保持
67胜48负13平、57.42%。Hard、root restore、timeout/error和joint dominated selection均为0。

完整Minimax UT在本阶段为246/246。新root当时只通过诊断arena的显式
`--bounded-policy-stack-implementation root`启用；production root哈希仍为`73e08f...8b551`，默认
行为没有改变。两次Discovery运行的本地耗时不用于比较root包装成本；性能结论继续以BP171同进程交错
五批为准。其后默认关闭的production接点已由BP173完成并保持逐动作等价。
证据见`config/engine-v3/base-policy-kernel-bp172-native-root-evidence.json`。

## 最新结论：BP165–BP170完成原生Minimax薄栈与算法级地形缓存

BP165把BP68实际到达的search、leaf和path闭包生成到`engine-v2/src/base-policy/`。固定16场景的
32个候选局与诊断实现保持相同动作指纹`e40ea471...574e998`，动作、参数、终局、帧数、星和击毁
全部零差异，仍为21胜11负。BP166删除了BP68 BASE continuation下280,283次确定空的
`recordPolicyEnvelopeLeaf`调用；V8会内联该空调用，所以单独计时没有稳定收益，但源码和构造状态均已
移除。

真正的算法级收益来自leaf星图：两项固定缓存先把固定16中的BFS从133,901次降到77次；随后用“每个
搜索根一次完整地形快照＋分支terrain delta集合”替代每个叶节点整图比较。固定16分支格比较从
3,395,124降到2,769，仍保持逐动作零差异。四邻居和x/y固定表进一步移除了约497万次`target`热路径
中的除法和取模；固定TypedArray总量为48,939字节，热分配为0。

Discovery64的128个候选局与BP160 native-only基线再次逐项零差异，动作指纹同为
`d6db15f8...f1162555`，结果保持67胜48负13平、57.42%。本地候选总耗时28.31s→23.92s
（下降15.50%），P95 10.55ms→10.33ms；同轮V1总耗时不同，因此只作为匹配输入相对证据，不能替代
平台3000ms证据。70万次星图请求只重建434次，分支地形格核对10,028次。

当时完整Minimax UT为243/243。production root哈希仍为
`73e08f1471a450967e26e931c639c88bf88d986870cb5b07a72e456ec2a8b551`，默认行为尚未接入薄栈。
下一步应先做独立重复批次的性能稳定性标定，再把完整BasePolicy闭包打成单一production candidate；
不继续用诊断宿主计时推断平台fallback。证据见
`config/engine-v3/base-policy-kernel-bp165-bp170-performance-evidence.json`。

BP171已经完成上述稳定性标定：同进程预热后交错运行5批，每批8场景，奇偶批反转执行顺序；算术无
缓存与两项缓存＋几何表的动作指纹、参数和结果每批完全一致。优化版总耗时5/5批更低，中位数为
82.48%，即减少17.52%；P95中位数为77.18%，但只在3/5批更低，尾延迟仍有明显宿主噪声。临时逐局
artifact均已在校验后删除，只保留汇总。该结果接受cache=2和geometry table为原生root构件，不把P95
外推为平台证据。证据见`config/engine-v3/base-policy-kernel-bp171-runtime-calibration.json`。

## 最新结论：BP160首先移除双重搜索审计，Minimax真实性能已低于匹配V1

此前BP68的“native Minimax”回调实际上每帧先执行完整V1 VM搜索，再执行原生搜索，并逐状态比较动作域、
transition、递归值和终局。关闭这套oracle审计后，固定16场景的32个候选局在动作流、参数、终局、帧数、
星、击毁上全部零差异，仍为21胜11负、65.63%。

同一轮本地计时中，native-only总耗时为匹配V1的56.11%，P95为45.72%；旧审计运行分别为172.91%和
135.13%。跨轮候选总耗时降至45.03%。这不是平台3000ms证据，但已经推翻“Minimax本身是主要性能
瓶颈”的判断：主要浪费来自验证宿主同时跑两套搜索。

Discovery64的128个候选局进一步保持动作流、参数、帧数、物理计数和分析胜负全部零差异，仍为
67/48/13、57.42%；13个raw result差异仅来自本地runtime winner元数据。该轮native-only总耗时/P95
为匹配V1的57.43%/41.00%，跨轮候选总耗时为旧审计的21.14%。

方法普查从83个方法中识别出审计模式触达72个、native-only只触达50个；仅关闭审计就消失22个热方法
和1,292,073次调用。剩余还有280,283次`recordPolicyEnvelopeLeaf`在BP68 BASE配置下立即返回，是下一
个明确的薄搜索裁剪点。production默认仍未改变。证据见
`config/engine-v3/base-policy-kernel-bp160-search-reachability-evidence.json`。

## 最新结论：BP159原生对手历史内容完全等价，反事实V1 gate被拒绝

`NativeBasePolicyOpponentHistory`在4096连续帧和Discovery64的8,018个实际搜索根上均与V1历史内容
零差异。完全不使用学习历史的fixed16只有16/14/2（53.13%），证明对手建模有效；始终使用原生历史
为21/11/0，旧V1门控为22/10/0。

扩大到Discovery64后，旧门控67/47/14（57.81%），始终原生67/48/13（57.42%），只差39bp；
配对正向7.0局、反向7.5局。旧gate依赖V1自己的反事实动作历史，不是合法production ABI，因此不再
为追求fixed16伪等价而迁移它。后续薄搜索固定使用原生历史；production默认仍未改变。证据见
`config/engine-v3/base-policy-kernel-bp159-opponent-context-evidence.json`。

## 前置结论：BP68生产迁移已完成owner和domain，固定16保持68.75%

BP156把BP68最终动作所有权器从103,404字节诊断类缩为11,119字节production薄类；4096个确定性root
的action/argument/row差异0。固定16的旧/新owner共64份物理记录全部等价，候选保持22胜10负、
68.75%，候选动作指纹均为`33c5b8eb...0d11b925`。独立Terser体积70,353→7,582字节。

BP157继续迁移动作域。真实接线发现mode-2资源域同时是深层搜索的FIRE资格提供者；补成显式接口后，
2048个FastState和固定16的64份记录再次零差异，结果仍为22/10/0。薄domain独立压缩为8,800字节。
Minimax core 230/230通过，Hard、restore、timeout/error和joint dominated selection均为0。

production root与默认行为仍未改变。本地相对计时显示薄owner总时间为旧类87.29%、P95为81.81%；继续
迁移domain后相对上一片为89.82%和76.01%，但这不是平台3000ms证据。下一步迁移BP68的Intent可达
语义；搜索器暂不整体搬运。证据见
`config/engine-v3/base-policy-kernel-bp156-owner-migration-evidence.json`和
`config/engine-v3/base-policy-kernel-bp157-domain-migration-evidence.json`。

## 最新结论：生产证明核正确，但safe-threat所有权和常驻剪枝均被拒绝

BP149–BP150已把严格`SAFE_THREAT_FIRE`证明压缩并移入production源码树。100个真实root与冻结oracle的
status、support、逐世界节点和总结果100/100一致；总节点981、最大27、拥有内存24,869字节，预算、
TT、restore和热分配失败均为0。默认不开启；固定16 CURRENT/Shadow的32个配对动作、参数、结果和终局
差异均为0。

支持普查证明全局`informationComplete`过严：完整possible-projectile tracker严格反证count=0时可以恢复
Physical支持，真实possible world仍保持InformationState。另修复根FIRE no-op仍可递归到未来FIRE的
false certificate：现在必须存在Hard允许的FIRE行和真实`PROJECTILE_CREATED`事件。

固定64中62个PROVEN全部只是敌人可躲的threat，必死证书0。safe-threat ACTIVE覆盖40次后得分从10.16%
降至9.77%，FIRE 653→675但击毁8→7；转换为3负、2正、1次败转平，净下降0.39pp。作为Minimax剪枝也
不经济：18,279个proof node只能删25个root transition，成本约731倍。因此默认owner、常驻剪枝和
possible-projectile双世界扩展全部拒绝；证明核只保留为默认关闭诊断和UT。

下一步回到全局动作质量：先量化Minimax实际参与率、搜索引起的动作翻转及其正负转换，再定位叶评价和
动作代表的系统性偏差。证据见
`config/engine-v3/base-policy-kernel-bp149-bp151-production-proof-evidence.json`。

## 前置结论：严格FIRE证书可低成本调度，全部可干预根得到6正0负

BP147在476个真实严格证明根上只读取ProductionRoot已有信号。确定性Discovery/Holdout都证明
`ControlModeRouter.context.clearLine && selectedAction !== FIRE`完整召回可干预证书：Discovery 11/11，
Holdout 11/11。全体只调度100/476根，22/22安全威胁和9/9必杀子集零遗漏；证明节点从35,721降为
1,692，减少95.2%。该条件只调度证明，不能开火或绕过Hard。

BP148激活全部22个严格证书存在但当前V2未开火的exact根。44/44 arm物理身份一致，Hard、restore和
动作身份失败均为0；得到5个`V1_WIN→V2_WIN`、1个`V1_WIN→DRAW`、0个负向转换、16个不变，分析点
27→38（+11）。这证明“严格证明拥有少量攻击动作”是显著正向方向，而不是全局FIRE加分。

production仍未修改。下一步BP149把证明器压缩为单一`SAFE_THREAT_FIRE`目标、三规则世界和一次构造的
固定内存arena；调度100根的单目标总节点仅981，P95 21、最大27。必须先验证TT缩减、对象复用、work
计费、restore和100/100分类等价，才允许Shadow运行。证据见
`config/engine-v3/base-policy-kernel-bp147-bp148-attack-certificate-evidence.json`。

## 前置结论：真实攻击根恢复严格FIRE证书，并得到首个正向漏射因果转换

BP144不再用位置scalar候选作为攻击输入，而是从192局真实战斗提取932个V1 FIRE及独立弹丸结果，
构造65个击毁根、65个匹配未击毁根、192个首分歧根和346个V2漏射根。668个用于后续分析的根全部
exact；295/295场终局复现，动作流失配0。

BP145在476个证明根上运行depth6严格攻击事件AND/OR搜索。敌方动作、Chance和三个移动规则世界均
完整；得到48个全世界安全威胁FIRE和30个全世界必杀FIRE。30个必杀全部属于65个历史击毁正例，
65个匹配未击毁根中必杀误报0。346个V2漏射根中发现4个安全威胁证书。唯一不完整根保持
`UNKNOWN/executable=false`，`unsafeExecutableCount=0`。

BP146只激活这4个exact漏射根：8/8 arm命中相同物理root，得到1个`V1_WIN→V2_WIN`、0个负向转换、
3个相等；分析点1→3，Hard和restore失败0。这是首次把真实攻击事实、严格多世界证明和整局正向因果
闭合在一起。样本仍太小，production保持关闭；下一步BP147提取不含match/hash的结构触发条件，并用
65+65正负根与346个漏射根做预注册Discovery/Holdout。证据见
`config/engine-v3/base-policy-kernel-bp144-bp146-real-attack-event-evidence.json`。

## 前置结论：保证所有敌方响应最终开火的严格事件证明没有判别力

BP139把固定depth叶改成正向strict事件horizon。根动作保持incumbent/candidate差异，后续使用单动作
重规划攻击策略，敌方动作、chance和三个移动规则世界保持完整；固定策略负结果与cap停止都只记
`UNKNOWN`。规模从完整`7×7`爆炸压到最大我方分支1，fixed16共完成35根、420次搜索，其中390次
完整、30次预算中断，总节点266,310，restore和热分配为0。

结果是baseline和candidate严格事件证书都为0：2个历史改善、2个历史退化以及31个相等根全部无法
判向。继续加深不会修复量词错位——敌方可以拒绝暴露，而这种拒绝本身可能让出位置、星路径、接触或
terminal机会，不能被当成“攻击失败”。

因此BP139只保留为正向证书诊断，不做owner或veto。下一步BP140改用有限时域字典序payoff/regret
interval：所有敌方响应仍作为独立列，即使没有FIRE也结算其terminal/nonloss、位置、星、接触、资源
和反击机会成本；不恢复通用ATTACK标量。证据见
`config/engine-v3/base-policy-kernel-bp139-event-horizon-evidence.json`。

## 前置结论：结构事件消除了退化假优势，但固定depth叶不是事件horizon

BP138从两条新共同续写lane中删除旧ATTACK标量：`OUTCOME_FRONTIER`观察depth-3叶的射线、弹丸和
反击暴露，`PROJECTILE_SETTLEMENT`把叶上已存在弹丸结算到规范失效或逃生deadline。35根×2 lane在
三个移动规则世界中全部完成并数值一致，restore、热分配与行为变化为0。

两个历史退化的候选优势被全部消除，确认旧ATTACK标量是假阳性来源；但两个真实改善也没有正向证据，
其中一个甚至被共同响应保守判为候选更差。因此两条lane只能保留为结构维度，既不能拥有动作，也不能
作为否决器。

根因是BP138仍在固定depth-3叶“看事件”：它能结算已经发出的弹丸，却不能让策略继续到未来第一次
FIRE。下一步BP139把horizon改为事件驱动：继续到FIRE、terminal、committed deadline、支持丢失或严格
work cap；只到帧上限而没有事件必须返回UNKNOWN。证据见
`config/engine-v3/base-policy-kernel-bp138-event-deadline-evidence.json`。

## 前置结论：一步敌方响应和当前OpponentModel都不能区分改善与退化

BP137复用35个已完成depth-3根，把FULL与NO_ATTACK放到完全相同的敌方动作列中，并离线连接历史敌方
下一动作。35/35个历史动作都有唯一列，三个移动规则世界零分歧，但两个历史改善和两个历史退化在真实
下一动作上都支持候选；去掉ATTACK叶后四者全部变为相等。因此一步response-conditioned标量仍只是
ATTACK叶证据的载体，不能成为动作证书。

35/35个可观察名义敌方策略在一个整数概率单位内近似均匀，说明当前OpponentModel没有形成可用于判向
的root-conditioned分布。收紧攻击进展定义后，只有具备枪口覆盖、响应可活、自逃分支或反击暴露改善的
根获得严格结构证书：它命中1/2历史改善、误报0/2历史退化，精度高但召回只有50%。该证书保留Shadow，
不接管动作。

下一步BP138不再调StageMatrix、Risk或ATTACK标量，而是把共同续写延伸到下一攻击事件或committed
deadline，分开记录terminal/nonloss、弹丸创建、命中/击毁、反击暴露与逃生可活性；历史动作只作离线
标签。证据见`config/engine-v3/base-policy-kernel-bp137-response-conditioned-evidence.json`。

## 最新结论：共同宿主续写修正反事实合同，但只得到+1.56pp

BP123修正BP121/BP122的未来策略合同：candidate只改变route-proven根动作，根之后与incumbent共享同一
BasePolicy续写，不再证明一条实际没有提交的ATTACK Plan。固定16 Shadow的211个完整比较得到64个
候选优势、109个相等、38个反驳；双方节点10,443/11,041，restore和热分配为0。

BP124激活45个在线证书后，V2从2/28/2变为3/28/1，得分9.38%→10.94%（+1.56pp）。它产生一个
`LOSS→WIN`，也产生一个`DRAW→LOSS`；星差恶化6、我方crash多3。说明共同续写是正确verifier合同，
但depth-2标量仍不能代表整局nonloss、击毁和星差。由于未过+3pp动作owner门，默认关闭且不读Holdout。

下一步冻结64个Shadow证书根为紧凑反事实语料，在相同BasePolicy下展开EnemyPolicy与独立
ChanceOutcome，并分开保存nonloss/kill/star/failure-type区间；不在固定16上调margin或depth。证据见
`config/engine-v3/base-policy-kernel-bp123-bp124-common-continuation-evidence.json`。

## 前置结论：策略身份修复有效，但depth-2标量所有权会制造炸弹死亡

BP121把BP120的一步接近射位改为两条独立的branch-local policy：incumbent保持原续写，ATTACK分支
持续重规划同一语义敌方target下的接敌策略。固定16场景中完成213次成对搜索，得到32个ATTACK严格
优势；相比BP120的208/208全反驳，证明策略身份确实是结构关键。

但BP122激活这些短视界优势后，在线轨迹得到19次实际覆盖，得分从9.38%降至7.81%：多发6枪，
我方crash多2，唯一终局转移为`DRAW→LOSS`。关键反例只凭147点depth-2叶值优势把GO改成右转，
最终把128帧同星平局变成第94帧炸弹死亡。Hard、FinalGate、restore和热分配仍全为0，说明缺陷不是
第一动作物理非法，而是短视界标量没有证明整条策略的事件结算、terminal nonloss与炸弹deadline。

因此保留语义target、分支独立策略和稀疏搜索，拒绝ACTIVE所有权。下一步为同一双策略搜索补充
事件结算与terminal/nonloss区间；只有完整下界严格超过incumbent上界才能接管。证据见
`config/engine-v3/base-policy-kernel-bp121-bp122-semantic-attack-policy-evidence.json`。

## 前置结论：一步接近射位被Minimax全量反驳，必须搜索同一条攻击策略

BP120在固定16场景的1,717个ATTACK strict执行缺口中，对中断帧以外的1,408帧运行有利射位反向场。
生成306个不同且Risk不退化的GO/TURN候选；217个进入完整敌方列的depth-2两Option Minimax，208个
完整结果全部判定候选更差，9个预算不完整，另89个处于runtime fallback。严格支配为0，因此没有
ACTIVE接管，也没有改动Production。

这不是Risk或Hard过严：候选已经通过两者。根因是几何场只证明第一步缩短到射位的距离，而搜索中的
`ATTACK_SETUP`后续又退回“直接朝敌人转向/前进/开火”，没有继续消费同一个攻击route policy；根动作与
续写不是同一个Option policy。仓库历史已否定固定具体射位，因此下一步保持语义enemy target和
ATTACK_APPROACH generation稳定，但允许射位随状态重规划；attack与incumbent分支分别保持各自续写，
再验证开火与自逃。证据见
`config/engine-v3/base-policy-kernel-bp120-attack-execution-interval-evidence.json`。

## 最新结论：局部瞄准略正向，但真正缺的是目标连续执行链

已完成状态一致的ACTIVE因果验证：诊断动作现在在ProductionRoot真正`emit`之前覆盖，因此弹丸追踪、
pending command、lastAction和Plan都观察到实际发出的动作，不再存在“模拟器动作与V2内部状态分叉”。
Production Root和Risk默认语义仍未改变，封存Holdout未读取。

固定32场景中，快速远距瞄准把V2从`5胜/2平/57负`改善为`6胜/2平/56负`，击毁5增至6，FIRE
285降至280；它通过O(1)射线/距离预筛和候选depth-2安全检查复现了正向结果，完整post-FIRE depth-4
节点从269,829降为0。已开放96场景复验仍只有一个`LOSS→WIN`、零`WIN→LOSS`：得分从10.16%升到
10.68%，击毁14增至15，FIRE 918降至907。方向一致，但+0.52个百分点远低于动作所有者+3pp门，
因此只保留为默认关闭的诊断原语。

两个局部所有者已经否定：清晰射线直接开火覆盖5次，胜负和击毁完全不变；单帧转向对齐覆盖4次，
虽然直接射线入口增加7个，得分却从9.38%降到8.59%，并损失一个击毁。这证明“对齐”和“有直线”
都只是进度，不是动作证书；敌方可闪避时，必须验证后续保持接触、开火时机和射后逃生。

全帧普查显示固定32中V2只有86个direct-clear位置、53次新进入和17次direct FIRE，V1式控制器为
249/151/119；`WRONG_FACING→DIRECT`为33/98，3–4格direct入口为10/59。把双方技能都改成poison或
都改成stun后，该差距仍约为direct位置2.6–3倍、direct FIRE 6–8倍，说明主因是控制架构而非简单的
poison/stun差异。注意V2尚无原生stun发射，所以stun结果只用于结构压力观察，不作为技能验收。

下一步停止新增局部TURN/FIRE启发式，先构建目标连续执行审计：同一target generation必须跨帧保持，
仅在事件、证据失效或deadline到期时切换；随后用最窄的有界Option POC验证“对齐→保持接触→择机
开火→射后逃生”整条链相对incumbent是否净正向。完整数据和判定已写入
`config/engine-v2/strategic-attack-target-evidence.json`。

## 最新主因：V2没有构造高质量射线，射后安全指标又没有验证动态续写

行为中性的射击质量/反击暴露普查已完成固定32和开放96 Discovery；production Root、Risk以及封存
Holdout均未改变/读取。开放96场景192局中，V2与V1开火量仍接近（918/932），但V2只有42次
`DIRECT_CLEAR`，V1有372次，占各自开火的4.6%和39.9%。V2清晰直射只产生2次击毁，V1产生63次；
近距离0–2格又是1/89对43/164。V2的大量开火是675次离轴射击以及596次弱`possible-hit`，不是为
直接射线主动完成转向、占位和接近。

V2还有224次没有任何Combat/PAC证据的FIRE：0击毁，却有11次在四帧内自身崩溃，其中10次能精确
归因于敌方弹丸。全部V2射击合计24次四帧内崩溃、21次敌弹击毁；V1仅3/3。命令与弹丸已支持毒技能
延迟一帧和overload独立成员，两批均无未配对弹丸。

现有两个安全信号也被数据否定为动态代理：`postFireEscape`把901/918次V2射击标为两条以上逃路，
但21次精确反击击毁中的20次仍落在该桶；`ownCounterExposure`把821/918次标为零暴露，其中仍包含
16次精确反击击毁。V2射后首动作是GO或TURN的748次里仍有15次被敌弹击毁，而V1的GO/TURN合计764次
为0。问题不是“有没有移动”，而是射后动作没有被同一敌方响应集合验证成一条可活策略。

下一步固定为默认关闭的`AIM_SETUP_AND_POST_FIRE_CLOSURE_SHADOW`：保留已有合格射击；零战斗证据的
FIRE不得取得所有权；候选转向/移动必须严格改善可验证射线deadline；射后续写必须在完整敌方响应列下
使用共同我方策略并逐帧重验Hard/Risk。先做Shadow因果证据，不加全局FIRE分、不调Risk阈值、不读
Holdout。证据见`config/engine-v2/strategic-attack-target-evidence.json`。

## GO/GO规则缺口已闭合为诊断证据，但不是攻击不足主因

Production FastKernel继续对未决GO/GO fail-closed；诊断层把`SEQUENTIAL_BLOCK / INTENT_BLOCK /
COLLISION_CRASH`作为三个InformationState规则世界。先生成同一四帧己方Option序列，再在三世界
重放并逐维取最坏，不选择某个规则充当平台真值。

固定32的7个失败根和公开96 Discovery的25个失败根均三世界全部完成，root restore为0；但risk=65
下分别得到`ATTACK=0 / STAR=3 / TRADEOFF=4`与`ATTACK=0 / STAR=7 / TRADEOFF=18`。两个cohort各有
4个根会因规则变体不同而改变关系，进一步证明不能直接启用某一种GO/GO实现。Shadow动作与整局结果
全部零差异，封存Holdout未读取。

结论：GO/GO是事实完整性缺口，但闭合后没有产生一个攻击严格优势根，无法解释V2攻击不足。下一步
转向完整响应根的`durable combat`维度普查，区分“攻击确实无收益”与“价值表达遗漏收益”；不再降低
安全门或扩展移动规则。

## 持久攻击目标与局部Minimax：状态接口成立，动作所有权仍无证书

持久`ATTACK target`在每帧重验Hard、committed EO和Risk，并让RESOURCE/TERMINAL独立拥有其帧。
这修复了第86帧毒技能被攻击目标覆盖的问题。进一步的反例表明，几何场给出的GO/TURN虽能缩短攻击
姿态距离，却会把唯一的盲集`LOSS→WIN`重新抹掉；因此几何场只能生成候选，不能取得动作所有权。

新增两行动、完整敌方响应列的Option局部Minimax，只在活跃目标出现不同安全候选时运行。固定32中
1/1次完整、10节点；盲96中5次检查，3次因runtime fallback跳过，2/2次完整，共38节点、单次最多
29节点。两批均为0严格支配、0动作变化、0根恢复失败和0热分配；最后一个完整根当前动作值22350，
攻击续航候选仅3800。结论不是“搜索太贵”，而是该续航在现有值语义下不值得执行。

所以持久目标和局部搜索继续保留为诊断接口、默认关闭，封存Holdout仍未读取。下一步转向上游覆盖：
276个事件冲突中211个响应评估完整，42个因possible projectile失败关闭、23个rollout不完整；而181个
完整根本身没有durable combat收益。先补前65个Information响应世界，不能通过放宽181个无收益根的
Combat门制造攻击。

## 即时FIRE所有权：双Discovery弱正向，但不足以成为默认策略

把`ATTACK vs STAR`冲突接到最终动作前、只允许Hard/Risk完整且响应条件安全的FIRE覆盖后，固定32场景
由9/52/3提升到10/51/3（+1.56pp）；新冻结且与既有cohort不重叠的96场景Discovery由
16/169/7提升到17/168/7（+0.52pp）。后者192局候选侧只有6次覆盖、1个`LOSS→WIN`、0个
`WIN→LOSS`，总FIRE没有增加；本地总耗时约+2.73%，硬不变量和热分配均为0。

方向是弱正向，但远低于动作owner的+3pp门，并且只有1个不一致结果对，不能称为显著。该组件分类为
`NEUTRAL_POSITIVE`并保持默认关闭；封存的128场景Holdout没有读取。下一步不调低FIRE门槛，而是把
所有权单位提升为`deadline-bounded ATTACK target generation`：转向、占位和开火只是每帧可替换执行，
每帧重新验证Hard、committed EO、Risk和目标支持；执行暂时无候选时回退本帧，不能把目标误判为完成。
机器证据见`config/engine-v2/strategic-attack-target-evidence.json`。

## 战略状态账本：主因收敛到“目标存在、执行Plan不持久”

新增行为中性的`StrategicStateLedgerShadow`，复用稳定Option generation，按`同星/领先/落后`、
开局/中局/终局记录目标生命周期、deadline、Plan提交/激活/完成以及ATTACK/STAR机会成本。固定
32场景的CURRENT与Shadow均为9/52/3、16.41%；星、crash、FIRE、资源和全部动作零差异，Hard、
Risk domination、restore、timeout和热分配均为0。Production Root与Risk源码hash未变。

6,974个决策中6,104次能绑定稳定目标，但1,987段target run平均仅3.07帧；1,622次generation切换
有968次（59.68%）没有外部事件。更关键的是6,928次Plan提交覆盖99.34%的决策，仅473次真正激活，
6,380次在同一callback内同时出现提交与完成；在target generation不变的延续帧中仍有4,089次重新
提交Plan。说明语义目标多数可以识别，但Plan层仍把“本帧执行方案”误当成“长期目标生命周期”。

战略冲突也高度不对称：Risk/Pareto前沿中，STAR在有完整ATTACK替代时被选191次，反向仅9次；
其中119次发生在我方已落后。但不能据此恢复粗暴`FIRE > STAR`：同一cohort的既有反例已从
16.41%降到8.59%。下一步只构建基于稳定target generation的`StrategicConflictArbiter` Shadow，
比较完整ATTACK/STAR Option的多帧区间、deadline、进度和abort，不让primitive FIRE直接拥有动作。
证据见`config/engine-v2/strategic-state-ledger-evidence.json`。

## 最新所有权结论：精确多响应门通过Discovery，但被独立Holdout否定

将四帧ATTACK/STAR比较改为“同一提案root、枚举全部敌方第一响应、后续按状态选择动作”后，
不再用其他稳定冲突root代替真实提案。每个维度分别经过OpponentModel名义概率与递归
ε-contamination备份；possible projectile或支持不完整一律失败关闭。

9个已知终局翻转场景中，`完整支持 + nonloss/terminal/enemy-crash不退化 + 至少一个战斗维改善`
准确触发3个`LOSS→WIN`并排除6个负向样本。固定32场景ACTIVE也从9/52/3、16.41%提升到
12/49/3、21.09%，9次覆盖只有3个终局变化，全部正向；自撞19→17、敌方撞毁8→10。

但首次读取的独立64场景Holdout否定了推广性：12/108/8、12.50%变成12/110/6、11.72%。
25次覆盖只产生1个`DRAW→WIN`，同时产生1个`DRAW→LOSS`和1个`WIN→LOSS`。虽然自撞43→39，
FIRE 625→647，局部安全且有战斗收益仍会破坏长期星路径和位置节奏。

两个Holdout退化都发生在我方星数领先且ATTACK的星路径进度更差；唯一正向转换保留了星路径进度。
这提示下一层必须把“领先/追赶”战略状态与战术Risk分开，而不是再调整一个攻击阈值。该条件来自已读
Holdout，不能在同一集合重调；必须在新的未见历史场景验证。当前精确多响应评估保留为稀疏证据服务，
ACTIVE默认关闭，Production、官方simulate/publish/challenge均未改变。

## 全局失败分解：当前主要矛盾不是Minimax深度，而是普通帧没有长期所有者

合并已经读过的Discovery/Holdout共96场景、192局，CURRENT V2为21胜160负11平，分析得分
13.80%。160个失败中98个是128帧星数失败，61个是单方撞毁/被击毁；累计星差−294，crash差+45。
这两个分母远大于任何局部攻击门能改变的3局。

20,569个决策root只有672个Physical exact，19,897个为Information incomplete。13,213个接触root虽有
value预算，却因为没有sound Information值消费者而跳过Information Minimax；实际value搜索只有421帧，
覆盖率2.05%。这是HP12有意保留的正确性能门：旧Information continuation缺共同Observation策略和
完整敌方列，不能恢复成全局标量owner。

与此同时，V2提交20,445个Plan、完成19,933个，几乎每帧重新提交；persistent navigation commit/reuse
均为0。动作结构也显示长期推进不足：V2比V1多1,795次TURN、少925次GO，并使用251次BOMB（V1为36）。
完全关闭资源已被历史反例否定，因此问题不是删动作，而是没有一个跨帧战略所有者控制目标、资源时机
和机会成本。

因此下一大阶段不再优化FIRE阈值或Minimax深度。应原生重建V2普通帧控制面：`比分/终局状态带 →
稳定目标generation与deadline → 事件驱动Plan → 合格Proposal仲裁`；Physical Minimax、Hard、EO和Proof
保留为战术/安全证据与高优先级覆盖。Information Minimax只有在共同策略区间具备明确消费者时才运行。
首先做行为中性的战略状态/目标生命周期审计，再选择一个端口做ACTIVE，避免再次把整套TacticalCore
直接变成动作owner。

## 最新所有权结论：风险条件单帧开火被否定，下一对象必须是Option policy

在严格攻击证明与响应集合均为空后，新增行为中性的多维`CombatUtilityEnvelopeShadow`。固定32场景
99个ATTACK/STAR冲突根中，risk=65有33个攻击具备正向鲁棒战斗收益和安全支持，29个攻击deadline
不晚于星deadline；但97个攻击延误缓存星路径，53个由当前动作支配、46个形成真实tradeoff，攻击严格
支配为0。

随后用上述条件做30次`GO→FIRE` Active POC，FIRE 327→381，但得分16.41%→12.50%，形成
3个正向、5个反向和1个`DRAW→LOSS`。四帧多维Policy frontier进一步得到：41个STAR支配、
47个tradeoff、0个ATTACK支配。针对9个终局翻转场景重放并保存13个提案根后确认：13个FIRE的
`robustLower`均低于原GO，四帧后均没有新增持续弹丸威胁或稳定射线；正反样本在frame、星距离、
endpoint reduction和pressure上高度重叠，无法用一个局部阈值分开。

因此不激活单帧owner，也不把严格Pareto当新硬门。下一搜索对象固定为“攻击Option policy vs
星Option policy”：敌方响应按OpponentModel和ε-contamination备份，Hard/committed安全逐节点保持，
PAC pressure只作局部证据，直到跨事件边界形成持久攻击进展。Production、Holdout和官方平台均未改动。
证据见`config/engine-v2/attack-strategy-ownership-causal-evidence.json`。

## 最新所有权结论：固定两步攻击序列也已被反例否定

在continuation witness只有2/99之后，复用现有`TwoStageAttackSetupShadow`直接生成并验证
`setup → FIRE`。首先确认当前OptionPortfolio的99个ATTACK_SETUP别名全部仍是FIRE，没有一个移动
setup。改为扫描Hard/Risk前沿后得到296个真实移动候选（GO 99、左转99、右转98），但严格证书为0：
274个明确失败，22个支持不完整。262个仍存在未约束敌方响应，268个下一帧FIRE没有命中进展。

因此下一步不能再调整FIRE分数、Risk门或把GO/TURN简单改标签；应构建2–4帧、观察后才能分支的
AttackPolicy reachability。固定32场景的64组CURRENT/Shadow动作流仍完全一致，验证仅296节点，
root restore和hot allocation为0。Production、Holdout和官方平台均未改动/读取。

## continuation witness：现有攻击候选没有形成多帧攻击链

Production默认语义保持不变，独立Holdout未读取。新增
`AttackContinuationProgressShadow`直接复用已有四帧rollout，不增加一次Fast transition。
99个攻击/STAR或POSITION冲突中，首步完整99次、压缩敌方响应52次、名义存活完整97次；但
42次姿态改善中40次只是可逆姿态，真正持久进展只有2次，不可逆进展只有1次。

36个ATTACK generation有63次同generation复验，其中44次维持、8次增强、11次退化；没有任何
generation连续两次保持持久进展，最大连续值为1。仅有的2个软challenger都发生在V2最终输局。
因此不能把现有PAC/possible-hit继续收紧后直接Active；下一步必须显式生成带deadline、abort和
共同敌方响应的小规模攻击序列。64组CURRENT/Shadow的动作流、终局和资源逐项相同，root restore、
hot allocation均为0。证据见`config/engine-v2/attack-strategy-ownership-causal-evidence.json`。

## 稳定 Option 身份：单动作攻击所有权被进一步否定

Production 默认语义保持不变，独立 Holdout 未读取。固定32场景的
`StableOptionLedgerShadow`与CURRENT均为9胜52负3平；64组换位对的压缩动作流、参数、帧数、
终局和资源计数完全一致。6,974次决策只创建906个语义Option、复用7,531次；5,532次可追踪选择中
5,021次（90.76%）沿用已有target generation。相同generation内仍发生1,480次primitive变化和
3,683次Plan signature变化，证明跨帧身份必须绑定目标generation，不能绑定当前动作或frame。

随后只在外部事件、冲突边沿或generation变化时运行四帧Option Shadow。99个ATTACK与
STAR/POSITION冲突中，平衡排序只有38次支持ATTACK、61次支持当前动作；现有Risk band从未得到
`attackLower > incumbentUpper`，反而36次严格支持当前动作、63次区间重叠。99条名义攻击路径没有
自毁退化，但只有1次多击毁敌人，并有5次星进度退化。即使7个名义路径到达终局，严格区间仍保持
全范围，因为没有universal enemy/common-policy支持。该Shadow共2,446次Fast transition，
root restore、hot allocation和动作差异均为0。

结论：`Hard/Risk允许 + purpose + post-fire escape + response compression`只是合法攻击第一步，
不是多帧攻击Option证书。下一步应在稳定generation上建立continuation progress和共同策略响应，
而不是再次提高FIRE或放宽Risk。机器证据与合同见
`config/engine-v2/attack-strategy-ownership-causal-evidence.json`，详细分析见
`docs/implementation/attack-strategy-ownership-causal-study.md`。

## 最新架构结论：目标条件延续有信号，但名义Physical所有权仍被拒绝

在不修改production默认语义的前提下，新增固定内存`ActionContinuationEnvelope`。它证明现有
`OptionAwareDepthSearch`只对代表动作和cache身份做了Option区分，`POSITION/STAR_CONTROL`叶值
仍未真正绑定目标；同时`OptionPortfolioSlab.buildTyped()`会让没有显式目标的移动行继承可见星星，
这会系统性强化抢星倾向。

固定16场景Shadow的39个同目标POSITION冲突中，committed、immediate、unknown和possible
projectile恶化均为0；39个都恶化horizon，其中34个完全来自future FIRE。严格目标和动态接触目标
Active POC都把CURRENT的4胜27负1平提升到5胜25负2平（14.06%→18.75%，+4.69pp），但都包含
3个正向、2个反向胜负转换；并分别有32/33次有意识覆盖软Risk Pareto。动态目标没有超过严格目标，
自身crash还增加2局。

因此该实现保留为诊断证据，不接入production、不读取Holdout、不继续调固定16场景。下一步应重建
Option目标身份和Risk所有权顺序：无主移动不得继承STAR；future-FIRE作为搜索后独立权衡维度；
committed/possible风险继续不可放宽；最终由sound InformationState Option区间取得动作所有权。
详见`docs/implementation/objective-conditioned-continuation.md`。

## 最新决策修复：NO_ACCEPTABLE 回退按落点风险优先于软 escapeSlack

精确反事实定位到 `mat_KlF8S4gI3ryC6gSoB` 第58帧：四个动作的fatal/unknown前缀完全相同，
旧回退因先比较软`escapeSlack`而选择向敌方枪口前进的GO，第60帧死亡；TURN_LEFT可在第85帧
击毁对手。现在只在`acceptableCount===0`的冷分支计算packed projected-pose risk，并把它放在
escapeSlack之前。Hard、Risk阈值、正常可接受集、TypedArray布局和普通根几何成本均不变。

最终固定16场景从4胜27负1平提升为5胜26负1平，精确为1个`LOSS→WIN`、0个反向退化，
FIRE 167→169；四项硬不变量为0。SR3 28、Minimax 212、GR0 356、IMP5 14全部通过。
同源码A/B随后通过一次性96场景 Tactical Holdout：旧语义22胜162负8平，新语义
23胜161负8平；精确为1个`LOSS→WIN`、0个反向终局转换，得分+0.52个百分点，自身被毁-1，
FIRE-2。只有一个discordant终局，统计不显著，因此保留局部修复但不宣称胜率或攻击能力提升。

更重要的是新语义19,953次决策仍产生1,922个`NO_ACCEPTABLE`根（约9.63%）。下一步应冻结当前
排序，对这些根的Risk全拒绝原因做结构分类，而不是继续微调回退常量。详见
`docs/implementation/no-acceptable-pose-fallback.md`。

## 最新Minimax性能结论：HP25把近期目标收敛为冷P3的640节点等效

HP25新增外部逐ply成本census，生产默认节点、work、动作和值语义不变。工具能严格对账
`Fast apply + root replay = search nodes`，并把完整矩阵`completedDepth`与P3以上的
`selectiveCompletedDepth`分开。

固定16根中9个可进入P3。512节点下冷启动只完成2/9，warm cache完成8/9；640节点可完成冷8/9，
896节点完成9/9。八个常规根需要476–599节点，最难根需要822。P4约到2,048节点才完成6/9，
4,096仍不再改善。因此下一轮应让512节点取得接近640节点的冷P3完成率，目标是ply2减少6–15%
有效工作，而不是盲目追P4或提高requested depth。

P3冷节点中ply2占57.6%，ply1/root约23.2%，ply3约19.3%；TT冷命中仅约11–14%。跨width principal
排序POC仅减少2/6,499节点且增加work，已经撤销。标准24-profile标定的节点、深度和值支持相对
HP23零变化，新基线`after-hp25.json`状态`CURRENT`。详细证据见
`docs/implementation/hp25-minimax-cost-census.md`。

## HP24结论：局部后继别名不值得保留

HP24验证了一个语义中性的复用方案：敌方`GO`被证明为no-effect时，复用同根已存在的敌方`NONE`
后继。固定根census中63/63个谓词命中都与完整状态和Hard一致，但真实16场景、32局只命中19次，
仅减少19次build和Hard fill，work减少57/4,471,793（约0.0013%）。节点、完成深度、值支持、
动作流、星数和胜负全部不变。

OFF→ON五批测量的表面加速在反转运行顺序后消失；反向次序中Physical P1–P6的cold/warm P95
均无稳定改善。因此HP24运行时代码已完整撤销，production source恢复HP23指纹，HP23深度基线状态
为`CURRENT`。详细证据见`docs/implementation/hp24-no-effect-go-alias-rejection.md`。

下一步不再猜root微缓存，而是按搜索层级和操作类别测量节点成本，定位真正阻止P2/P3完成的工作面。

## HP23结论：闭合静态占位规则，覆盖提升但计算成本上升

HP23根据不可变官方replay闭合`STATIC_OCCUPIED_BLOCK`：敌方本帧确定不移动时，我方`GO`进入其
占据格会被阻挡为no-effect。双方都`GO`的同目标、swap，以及teleport/boost腾空仍未校准，继续
unsupported。Fast、Reference、Production和旧语义诊断开关已有共同UT约束。

固定16场景Discovery和独立32场景Tactical Holdout的CURRENT/旧语义A/B共96局，胜负转换为0；
旧语义116个unsupported cell中的30个静态占位单元被消除，当前剩余86个全部为`GO/GO`。
精确P2完成165→171，完整值owner增加11帧，FIRE增加16次，星差改善1；所有硬不变量为0。

这不是速度优化。新合法分支使Physical节点增加8.30%、确定性work增加2.15%；固定标定中P2完成率
和P95节点不变，但平均节点241→257，高预算Information请求完成率下降6.25–12.5个百分点。新基线
已冻结为`config/engine-v2/minimax-depth-baselines/after-hp23.json`且状态`CURRENT`。下一步应在
保持新规则与动作/值指纹的前提下优化这些分支的推进和复用，然后重新标定。

Minimax 158、Diagnostics 108、GR0 292、IMP2 53、IMP3 28、IMP5 14全部通过。详细证据见
`docs/implementation/hp23-static-occupied-block.md`。

## HP22历史结论：剩余P2中止是规则边界，不是性能不足

HP22把P2失败拆成width、Fast、Hard和未分类四类，并在诊断模式记录Fast状态与联合动作。
固定16场景Discovery和独立32场景Tactical Holdout合计196次P2尝试：165次精确完成、10次在
没有精确P1 owner的前提下非精确完成、21次中止。21次全部为Fast `UNSUPPORTED_RULE`；预算、
width、Hard、容量、restore和其他中断均为0。116个失败cell全部包含`GO`。

本地UT确认占据格、同目标和swap的GO分支按当前合同fail closed且完整恢复root。随后重新解释
不可变的官方`P2-MOVE-CONTEST` raw replay，发现旧分析器把同record的speech/GO错移到下一帧。
第12帧起连续22次实际证明：敌方原地FIRE时，我方GO进入其占据格会被阻挡且不会碰撞死亡。
离线reconcile现为`CONCLUSIVE / STATIC_OCCUPIED_BLOCK`，raw response/hash未改。

24-profile标定的节点、完成深度和值支持深度与HP21一致，冻结基线为
`config/engine-v2/minimax-depth-baselines/after-hp22.json`。Minimax 155、Diagnostics 108、
GR0 289、IMP5 14全部通过。下一步只实现“对方确定不移动”的occupied-block公共路径，再用P2
census验证；双方都GO的同目标、swap和腾空语义仍未闭合，继续保持unsupported。

## 最新Minimax性能结论：HP12停止无消费者的Information计算

HP12确认当前Information深搜不是“太浅”，而是默认没有动作消费者。固定16场景、32局中，
1,282次InformationSearch全部输入支持不完整，全部递归又缺少严格ObservationSplit语义，1,215次
同时裁掉敌方动作列；最终完整Information值所有者为0，却消耗209,142节点。

ProductionRoot现在只在诊断显式安装Information消费者时运行这条近似路径。新默认与旧路径的同源码
A/B为3/28/1对2/28/2，正负转换各1，不能宣称胜率提升；但确定性work下降39.9%，本地同进程总
耗时下降42.7%，Emergency callback 397→0。省下的预算使严格Physical搜索帧32→73、完整值
所有者32→70，达到了“让可用Minimax执行更多”，而非通过调低深度伪造性能。

Minimax 146、GR0 280、IMP5 14、diagnostics 79全部通过，硬不变量为0。新冻结基线为
`config/engine-v2/minimax-depth-baselines/after-hp12.json`，指纹
`c1f42cca34ee8d5d409a639d6402e936c314101fd015cbb3957e5a0cdf87b117`。详细记录见
`docs/implementation/hp12-consumer-aware-information-schedule.md`。下一阶段应构建sound Information
上下界和严格支配消费者，而不是恢复近似标量所有权。

## 最新Minimax结论：HP11同时修复值所有权与无效深搜

HP10差分oracle证明递归值正确，但生产调度会用更深的截断/INCOMPLETE矩阵覆盖浅层精确矩阵；
support证书也曾漏检Fast/Hard incomplete。现在遍历深度与值所有者深度已分离，调度在相同
512节点和60,000 work预算中先建立full-width P1，再尝试full-width P2。深层只有完整支持才能
替换浅层值，否则严格回退P1。

HP11在已有精确所有者后，对动作截断、unsupported transition或Hard incomplete做早停，同时先
保留可用的Successor-TT principal。16个固定根中15个获得严格值：8个P2、7个P1 fallback；唯一
未决是物理规则尚未校准的同格移动争用。早停ON/OFF的根值与动作指纹一致，节点3,566→5,887的
对照中减少39.4%。

最终24-profile标定中P2–P6严格支持由25%提高到93.75%。P2 cold P95节点512→489、P95时间
1606→1486us；P3 cold P50节点512→305、P95时间2583→1490us。所有root restore、replay、
cache语义和热分配不变量为0。冻结基线为
`config/engine-v2/minimax-depth-baselines/after-hp11-final.json`，基线指纹
`37af3ad2a0df112d014e71b83981dd02a691aa6892f980aa07a28fb00dc0e07e`。

Minimax 146项、diagnostics 77项通过；胜率未用于调深度。随后只做了16场景、32局的小型
值所有权因果arena：CURRENT和HP10证书边界均为2胜/28负/2平，正负转换均为0，星差与终局一致。
HP11新增证书抑制对照共8次，只有1局动作流变化。唯一分歧根中，完整P2把GO面对敌方GO的值证明
为-900，经Risk消费后从GO改选TURN_RIGHT，但两条轨迹最终都以128帧1:2星数失败。

结论是HP11属于`POSITIVE_CORRECTNESS_PERFORMANCE / NEUTRAL_GAMEPLAY`：接线真实生效，但在这批
根上的动作杠杆很低。32局只有32次complete value owner，却有1,282次Information evidence-only；
下一性能/决策交叉点应是Information严格支持和证据消费，而不是继续盲目提高Physical深度。

## 最新Minimax性能结论：HP9本地work标定通过，搜索有效期显著延长

HP9不再把ROOT、Hard和搜索节点按未测常量统一扣费。诊断Bot用固定整数ledger记录十类工作量，
阶段计时器同时输出inclusive/exclusive微秒；五批、80局、8,170次callback得到本地保守标定：

```text
ROOT/FAST/HARD/VALUE/PROOF/MATRIX/CACHE/FEATURE/EMITTER/UNKNOWN
368 / 3 / 199 / 6 / 6 / 2 / 1 / 24 / 10 / 5000
```

128帧只执行ROOT+EMITTER为48,384 work，低于120,000 degraded门，不再由固定开销自动提前
fallback。ProductionRoot现按真实Fast apply、Hard classify/cache hit、ReverseViability build、
Value node和StageMatrix iteration收费。标定同时发现并修复一个搜索正确性错误：direct-fire trap
探针若被work budget截断，旧实现仍可能发布当前迭代；现在该迭代fail closed，只保留上一完整深度。

相同8场景、16局因果对照中，搜索帧160→655（4.09倍），节点22,012→105,131（4.78倍），
fallback中位帧15→41，emergency中位帧30→92；总本地耗时1,541,104→1,473,001us（-4.42%），
最大局P95 5,239→5,418us（+3.42%，在110%护栏内）。655个搜索帧全部发布完整迭代。
独立32场景、64局验证得到2,494个完整搜索帧、417,747节点，fallback/emergency中位帧为38/90，
Hard、Risk支配、root restore和hot allocation错误均为0。胜负与FIRE不用于HP9性能验收。

机器报告为`artifacts/benchmarks/runtime-work-calibration/hp9-local.json`和
`artifacts/benchmarks/runtime-work-calibration/hp9-qualification.json`；后者状态为`PASS_LOCAL`，
指纹`4af43be58d37406f3d186699abd247f7af7a8fc483ead77b1f152f642726f24a`。平台3000ms比例仍未
标定，因此明确保留`PLATFORM_RUNTIME_SCALE_PENDING`，不能把本地work单位冒充平台毫秒。

HP9后标准24-profile深度标定已冻结为
`config/engine-v2/minimax-depth-baselines/after-hp9.json`，指纹
`dc46ba08d246fb126646dedfb031a053a6f3a27f6a3e03708c4c8c5fc71e61b8`；所有restore、cache
语义和热分配不变量为0。Minimax 134、GR0 268、IMP5 14、SR2/SR3 93、IMP6 16和诊断68项
全部通过。当前source/minified为631,179/609,201字节，TypedArray 889,188字节；上传体积仍是
独立发布阻塞。下一步进入HP10：冻结HP9性能profile，只调试Minimax值、风险backup和动作所有权。

## 上一Minimax性能结论：HP8只启用精确Successor-TT深层排序

HP8验证了两种跨帧PV语义，结果不能混在一起。把上一帧最终根PV直接提升为下一帧根动作顺序，
即使要求实际动作和精确Physical后继匹配，16个后继fixture的节点仍由5,651增至5,846（+3.45%），
因此production默认明确禁用根PV排序；上一帧根PV只作为Shadow证据保存。真正启用的是深层
Successor-TT program ordering：只有完整、exact、较浅深度TT条目中保存的我方/敌方动作程序，
才可调整同一子树内代表动作的访问顺序，不改变根动作成员、区间、Hard、Proof或最终所有权。

最终专用基准使用16个实际父root，执行其真实joint action得到下一PhysicalState，再对相同后继做
同源码OFF/ON五批测量。结果节点由5,651降至5,573（-1.38%），深层提升111次、根提升0次；
P95由300.12us降至272.91us（-9.07%）。语义差异、root restore、principal容量溢出均为0。
机器报告为`artifacts/benchmarks/cross-frame-pv/hp8.json`，指纹
`6668e4b3a74361e880e93b0c346b86c12c3f6212e331013c9649cfd7e0b8a4cd`。

PV证据使用256槽紧凑固定整数slab，而不是给全部4,608个root transition分配元数据。匹配要求
完整后继hash、topology version、NEXT_ENTITY、risk、width和match/root generation一致；容量不足
显式记为incomplete，不能覆盖旧证据。最终ProductionRoot TypedArray为889,188字节，仍低于1MB。
标准深度标定的节点和完成深度分布不变，当前冻结基线为
`config/engine-v2/minimax-depth-baselines/after-hp8-final.json`，指纹
`95d672d9c60c7bd53d80f86be0cc6d72e0309eb0b4fd6bc6df8a0f1a6945a048`。

Minimax 134、SR2/SR3 93、IMP5 14、GR0 268项测试通过。IMP6的cache、runtime、确定构建、
production strip、source/minified差分、sandbox和六层benchmark通过；212项容量套件中211项通过，
唯一失败仍是既有源码字节门。source/minified为628,807/606,923字节，平台上传体积仍是独立
blocker。HP8未运行arena；下一步是HP9的work charge与runtime预算校准，不用胜率反向修改本阶段
缓存语义。

## 上一Minimax性能结论：HP7已共享Committed ThreatLattice

HP7把Hard、InformationSafetyClosure与EscapeObligation对同一组真实炸弹/敌方committed弹丸的
反向可活度计算收敛到HazardKernel的canonical lattice。冷root由Hazard统一构建tick0/tick1/tick2；
Deadline只在共享不可用时才运行private reverse DP。EO的候选后继改为固定slab一次性写入，不再为
每个动作创建结果对象；最早致命tick则按实际候选格惰性计算，同一格在本root内复用，避免扫描全图。

专用五批基准运行真实`FinalHard → InformationSafetyClosure → EO`流水线。四类多危险fixture中，
无共享控制组共构建149,704个反向节点，共享版为53,080，重复工作下降64.54%；Hard、Safety与EO
指纹差异为0，声明热分配为0。共享版P95为17.85us，对照为405.37us；这是“无lattice/private
reverse”到累计共享架构的端到端差值，包含此前ReverseLatticeCache收益，不能全部归因于HP7新增
接线。机器报告位于`artifacts/benchmarks/threat-lattice-sharing/hp7.json`，指纹为
`b48aa299b9fce062f2b20f51a924ba1d3b19102f169001affbef77929d7ebb17`。

标准16场景深度标定保持节点数、完成深度及所有语义不变量不变。当前WSL墙钟在重复运行间出现明显
漂移，所以不使用HP6/HP7跨时运行的绝对耗时声称加速；HP7性能验收以同进程、同源码的专用五批
对照为准。当前冻结基线为`config/engine-v2/minimax-depth-baselines/after-hp7.json`，指纹
`311015a3f99ffc6fc5dbd9bdebbf5adb013ac70e89ce84f9e3f07536400c419d`；HP6到HP7结构对比位于
`artifacts/benchmarks/minimax-depth-calibration/hp6-to-hp7-comparison.json`。

Minimax 128、SR2/SR3 93、IMP5 14、GR0 262项测试通过。IMP6除既有代码体积门外全部通过：
212项容量套件中211项通过，唯一失败是源码字节上限；source/minified为616,780/595,423字节，
TypedArray为883,748字节，仍低于1MB。HP7不改变possible projectile、future FIRE、Hard、Proof、搜索深度或动作
所有权，也未运行arena。该结论随后由HP8的跨帧PV与TT消融继续验证。

## 上一Minimax性能结论：HP6已启用Contender selective continuation

HP6在不改变Hard、Proof和不完整root动作所有权的前提下，把Physical depth 3及以上改成固定内存
的contender分支定界。depth 1/2仍完整计算；depth 3只在一个敌方响应已经足以证明该行不可能超过
incumbent时停止该行。浅层值只用于访问顺序，绝不被当作跨深度上下界。未完成矩阵仍只发布HP5
区间；只有完整矩阵才能覆盖`rootCellScore`，选择性证书单独记录`selectiveCompletedDepth`。

理论验收覆盖6,561个4×2整数矩阵和所有严格预算前缀，已证动作/值误判为0；16个真实搜索fixture
中，已解析案例的Value节点下降超过30%。最终同源码OFF/ON标定固定16场景、24个profile、每profile
80次：P1/P2节点分布完全不变；P3有40/80次额外得到depth-3稳定根动作证书。P3冷缓存节点中位数
由512降至418（-18.4%），热缓存由512降至243（-52.5%）；冷P95耗时1050→1012us，热P95
972→534us。P4–P6在完成depth-3证书后继续尝试更深层，但512节点上限尚不足以再次闭合。

Physical root TT与Information continuation TT现已分库：中断Physical根留下的精确子树可继续服务
Physical搜索，但不能改变Information预算内的命中集合。UT验证污染/干净Physical TT得到相同
Information continuation值、深度和完整度，退出时恢复原cache引用。全部标定不变量为0；Minimax
124、SR5 11、IMP5 14、GR0 258项通过。

当前冻结基线为`config/engine-v2/minimax-depth-baselines/after-hp6.json`，指纹为
`38b252a9b5fd4d6a28bdcc79a9548dbcd0da3066ae822b25fadf9bb2ff689823`；同源码对比为
`artifacts/benchmarks/minimax-depth-calibration/hp6-selective-continuation-final.json`。
按已确认的性能/决策分离原则，整局胜率不作为HP6验收门；诊断arena发现搜索调度可改变后续
不完整Information预算和动作，这一证据保留给HP10，不用于反向修改本阶段深度算法。

IMP6语义、sandbox、runtime与内存项通过；当前构建TypedArray为881,700字节，低于1MB。独立代码
体积门仍失败：source/minified为613,510/592,271字节，既超过本地600KB源码门，也超过平台
204,800字节门。该问题不通过放宽测试解决，留给后续production瘦身。

## 上一Minimax性能结论：HP5已固化浅层区间合同

HP5为`ProductionDepthSearch`增加固定整数根区间视图：完整cell发布`[v,v]`，未访问、Fast不支持或
Hard incomplete的cell发布`[-32000,32000]`；敌方列取区间min，我方行取区间max。预算中断只
发布`INCOMPLETE`区间，不覆盖最后完整深度，也不写Hard、Proof或当前动作所有权。这是HP6
contender selective continuation所需的可审计边界。

完整性记录最初逐递归帧传播，实测造成12%–28%的P95回归，已拒绝。最终实现利用现有
`iterationCellScore=-32000`识别未访问cell，只给罕见unsupported/incomplete cell写缺失标记，
正常递归热路径不再传播额外状态。相对HP4，Physical P1–P6 cold P95为
`355/622/1026/1018/1018/1018us`，是HP4的99.7%–105.3%；warm P95为
`208/552/958/980/953/991us`，是HP4的97.5%–106.1%。节点数、请求深度完成率和完整深度
直方图不变，全部低于110%性能护栏。

新增oracle覆盖完整一层逐格值、每个depth-2预算前缀、Hard incomplete、Chance/HiddenWorld/
Simultaneous嵌套量词和Proof隔离；嵌套量词共768组整数案例。Minimax 116、SR5 11、IMP5 14、
GR0 250项全部通过，root restore、热分配、缓存冷热语义差异均为0。最大地图TypedArray为
994,432字节，仍低于1MB门。IMP6仅保留既有代码体积失败：source/minified为
534,367/515,275字节。

当前冻结基线为`config/engine-v2/minimax-depth-baselines/after-hp5.json`，基线指纹为
`65d9f96e049f439acb9af417b1fd3f325ff048a2490c4683f831a2b0bbbbf82a`，运行报告为
`artifacts/benchmarks/minimax-depth-calibration/runs/7e0969bfcbbac8e65e6e7e3917b701004dc3fa7f6b43a90e8512fafecec1d38b/report.json`。
本阶段未运行arena，胜率未参与性能验收。下一步是HP6：用这些sound interval筛选contender，
把深层预算集中到仍可能改变根选择的动作与敌方响应。

## 上一Minimax性能结论：HP4已复用根joint transition

HP4新增固定整数`RootTransitionSlab`，让FinalActionGate、ForcedWin和Physical Value共享根
action/chance的物理后继与Hard事实。缓存回放仍走可撤销的`FastState.write/undoTo`；身份、容量或
64位hash验证失败会立刻回退完整FastKernel。隐藏Information world和子树continuation不接入，
因为同源码首轮消融已证明这些路径几乎不命中且会变慢。

最终同源码ON/OFF标定中，Physical P1–P6 cold P95全部下降32–181us，warm P95全部下降
140–228us。固定生产接触fixture在相同39,044 work上限下从436节点提高到493节点（+13.1%），
保持完整P3并继续尝试P4。固定标定仍受512节点上限约束，因此宽root的完成深度直方图没有变化；
下一性能瓶颈是树的分支规模，而不是根转移重复计算。

Slab占146,028字节，最大地图ProductionRoot TypedArray总量878,580字节，低于1MB门。
Minimax 111、SR5 11、IMP5 14、GR0 245项测试通过；值语义、root restore、热分配和回放失败
全部为0。当前冻结基线为
`config/engine-v2/minimax-depth-baselines/after-hp4.json`，同源码消融报告为
`artifacts/benchmarks/minimax-depth-calibration/hp4-root-transition-ablation-final.json`。
本阶段未运行arena，也未使用胜率作为性能门。下一步进入HP5，先固化全宽浅层与区间合同，再开始
Contender selective continuation缩减深层树规模。

## 最新原生V2结论：不能用final-only rescue替换早期EO

已将V3中通过的strict committed rescue原生接入V2，并用同一源码中的开关完成因果A/B。原生
V2本来就惰性计算EO：没有真实炸弹或敌方committed弹丸时不会运行Deadline closure；新增最终
兜底也只在`supportStatus=COMPLETE`时检查，没有第二套DeathChecker和新TypedArray。

Discovery 16场景、每版本双换位32局首先测试“删除早期EO，只留final-only”：旧版6/24/2、
21.88%，final-only为5/25/2、18.75%，星差再下降2，明确拒绝。唯一胜负退化在
`mat_FvgkFgwRgF217xan3`的candidate seat 1：第112帧GO均被Hard拒绝，旧EO在Risk集合为空时
恢复committed-viable转向并选RIGHT，final-only进入`NO_ACCEPTABLE`后选LEFT；双方都活到128帧，
但星数从2:1胜变为1:2负。这证明早期EO还承担必要的“恢复可活集合”职责，不能照搬V3结论删除。

最终production组合改为“保留早期EO + strict final rescue兜底”。该组合在Discovery为
6/24/2对6/24/2，611次完整危险检查、0候选、0覆盖；独立Holdout 48场景、每版本96局为
12/77/7对12/77/7，1,757次检查、0候选、0覆盖。星、击毁、FIRE和动作计数逐项一致，所有硬
不变量为0。因此strict rescue分类为`ACCEPTED_NEUTRAL_SAFETY_BACKSTOP`，不是胜率提升；救援
动作不会提交原策略或Plan。机器记录见
`config/engine-v2/native-strict-rescue-acceptance.json`。

## 最新原生V2改进：EO×PAC因果击杀

在保留早期EO和strict final rescue的前提下，新增了一个稀有的因果击杀组合证书。
它不是放宽Risk，也不增加FIRE固定分：只有PAC完整证明敌方全部第一动作都会被已提交弹道
击毁，同时EO证明FIRE后仍能躲过全部已提交炸弹/敌弹，并且即时、未知、possible projectile、
盾和反击暴露全部为零时，才允许把原本由未来敌方开火造成的soft horizon风险视为已被击杀
因果截断。

固定Discovery 32局从6/24/2、21.88%改善为7/23/2、25.00%。
唯一覆盖发生在 `mat_6K5rvfV5SofI3nXfG` 第103帧：TURN_LEFT改为FIRE，
由128帧0:1星失败改为第105帧击毁胜，`LOSS→WIN=1`、负向转换0。
独立Holdout 96局逐动作和结果完全一致；其中两个direct-kill本来已经选择FIRE，没有额外接管。
128局合计增加1场击毁胜，所有Hard、Risk domination、restore、timeout/error不变量为0，
热路径不新增数组或对象。

该路径默认开启，分类为 `ACCEPTED_DIRECTIONAL_CORRECTNESS`，不宣称通用攻击强度或统计显著。
后续来源审计又收紧了一层：只有四帧Safety原始质量满足`committed=0`、
`possible projectile=0`、`future FIRE>0`，且总horizon质量完全等于future-FIRE质量，
PAC才可消除风险。已知正向根是`0/0/3998`，因此仍保持LOSS→WIN；Holdout结果仍逐动作
相同。7个Risk-blocked direct-kill根中，3个被来源纯度明确挡住，其余真正动作分歧根都
保留一个敌方存活响应，不能安全扩权。下一步不能削弱证书条件。机器记录位于
`config/engine-v2/native-causal-kill-acceptance.json`。

## 最新累计结论：实验 BEST 只保留严格 committed rescue

新增显式`BEST_ACCEPTED_COMPONENTS`模式，将已测试组件重新按所有权收敛：共享V2 observation /
Physical evidence只提供事实，唯一能覆盖V1动作的是final-only strict committed rescue。严格
direct-kill、future-FIRE软风险、连续转向稳定性、完整TacticalCore、Strategy和Plan均未进入。

固定64场景、双换位128局直接内战结果为63胜、61负、4平，分析得分50.78%；候选被击毁
52次，对照57次，星数75:76。严格救援只在5局提出6次，全部满足`committed support complete +
preferred PROVEN_DEAD + replacement PROVEN_VIABLE + Hard ALLOW`，动作只有4次GO和2次LEFT；
root restore、搜索节点和声明热分配均为0。

该结果只有1个非零换位对，随机化检验`p=1.0`，所以不把50.78%解释为通用强度提升。它只
确认严格救援作为安全覆盖可累计存在，并再次拒绝把中性组件混入BEST。诊断宿主总耗时为对照
109.87%，单局最大P95为118.63%，未超过120%实验护栏，但不具备production性能资格。
机器可读边界记录在`config/engine-v3/v3-accepted-component-best.json`；V2 production hash仍为
`d16040f0…f19`。

## 最新因果结论：连续转向断路器不能独立拥有动作

在strict rescue BEST的最终边界新增了稳定性Shadow。它只在`turnStreak>=3`时检查GO，要求
GO实际移动、Physical Hard允许、没有committed hazard、不无理由靠近外边界，并记录V2
投影风险；FIRE、技能、炸弹和严格救援始终优先。

Discovery 32局的122个连续转向根中，V1已经选择GO 88次，选择FIRE/技能等高优先动作17次；
17次最终仍为TURN。物理/几何/风险门后只有7个宽候选。宽Active让7局改变，得到
`LOSS→WIN=1`和`WIN→LOSS=1`，净值0，因此拒绝。

随后只测试一个离散语义端点，而非按样本调连续阈值：`possibleRisk==0`。该候选在Discovery
只覆盖2次，得到1个败转胜、0退化，得分53.13%，于是冻结后进入Holdout。Holdout结果：

| 指标 | Shadow | Zero-risk Active |
|---|---:|---:|
| W/L/D | 46/46/4 | 46/46/4 |
| 得分 | 50.00% | 50.00% |
| 被击毁 | 38 | 37 |
| 星 | 60 | 60 |
| FIRE | 548 | 547 |

精确转换为1个败转胜、1个胜转平、1个平转负，净综合得分0，`p=1.0`。6局动作流改变；
虽然局部死亡减少1，但长期星、攻击和终局轨迹互相抵消。`possibleRisk==0`只能说明当前投影
没有已建模软危险，不能证明打断转向后的长期策略更好。

因此宽版与zero-risk版均为`ACTION_OWNER_REJECTED`；稳定性Shadow可保留作震荡计数和后续
Plan诊断，但不加入BEST、不修改V2 production。当前唯一通过行为/安全证据进入实验BEST的
仍是final-only strict committed rescue。

## 最新因果结论：future-FIRE只能提供证据，不能拥有动作

在strict rescue BEST之上新增了零热分配的`PREEMPTIVE_SAFETY_SHADOW`。它复用同一份V2
Physical prefix，只计算尚未发生的future FIRE和possible projectile；已提交敌弹仍归EO，
且该Shadow不运行Minimax、StageMatrix或Strategy，ProposalBus固定`eligible=0`。

固定Discovery 32局、1,832帧动作完全不变，prepare/emit均为1,832，Hard/restore/timeout
不变量为0。到达V1 preemptive端口的1,716帧中：

| 指标 | 数量 |
|---|---:|
| V1实际预防动作 | 25 |
| V2软风险推荐 | 1,046 |
| 同时触发且动作一致 | 21/21 |
| V1独有 | 4 |
| V2独有 | 1,025 |
| V2与V1动作冲突 | 0 |

V2推荐分布为GO 494、LEFT 530、RIGHT 22；其中928帧的真实V1所有者是TacticalSearch，
另有58帧Stability、28帧FinalGate和11帧Navigation。也就是说，V2软风险对真正预防动作的
召回较高（21/25），但若视为动作触发器，精度只有21/1,046。它把“存在未来危险”误当成
“现在必须躲避”，正好解释了V2过度避险、少攻击的所有权问题。

4个V1独有动作都在V2完整支持下得到soft source=0，说明四帧fatal-mass也不能替代V1较远
距离的几何预防。当前分类为`CORRECT_EVIDENCE_ONLY / ACTION_OWNER_REJECTED`：不读取Holdout，
不建立Active模式，不削弱或删除V1 preemptive；未来只能作为已合格动作间的后置风险证据。

## 最新因果结论：严格救援可保留，攻击只保留直接击毁证据

V3模块宿主现在使用同一份V2 physical evidence prefix：每帧Hard/committed EO只构建一次，
Combat/PAC也只构建一次，后续提案只复用固定数组。严格救援继续满足
`preferred PROVEN_DEAD + replacement PROVEN_VIABLE + Hard ALLOW`，并位于最终动作边界，
不是早期控制器。

共享前缀接入后发现并修复了一个真实的状态复用缺陷：正常可行动帧中，合成`NONE`行不在
EO本帧计算域内，但旧选择循环仍扫描完整`actionCount`，可能把前一帧残留的member位复活成
`NONE`救援。现在index和候选扫描都严格限制为`physicalSelectionCount`，新增故障UT；修复后
Discovery/Holdout合计9,647次prepare与emit逐项相等，救援动作只剩GO/LEFT，`NONE=0`。

攻击提案也从“先选所有purpose动作、最后要求FIRE”改为直接扫描FIRE，并要求Hard允许、
PAC完整、开火后可逃、反击暴露不增加、purpose完整以及敌方后继减少。完整的
`direct kill + response reduction`在Discovery发生2次正转换和2次负转换，属于交互负向，
不能拥有动作。将语义拆成“只允许严格direct kill拥有，其他压制保持Shadow”后：

| 数据集 | Active W/L/D | 得分 | 相对Shadow逐局转换 | 结论 |
|---|---:|---:|---|---|
| Discovery 32局 | 17/15/0 | 53.13% | 1个场景净+2胜 | 达到进入Holdout的方向门 |
| Holdout 96局 | 47/44/5 | 51.56% | `LOSS→WIN=1`、`LOSS→DRAW=1`、负转换0 | 正向但不显著 |

Holdout中只有3个第一动作被改为FIRE：一个单方死亡变胜、一个变同归于尽平局、一个仍输但
避免被击毁。星数总量不变、候选被击毁38→36、FIRE 548→560；但提升只有1.56个百分点，
场景级随机化`p=0.5`，未达到`+3pp且p<0.05`。因此strict direct-kill标记为
`DIRECTIONALLY_POSITIVE_NEUTRAL`并保持默认关闭；非direct response-reduction标记为
`NEGATIVE_INTERACTION`并只保留Shadow证据。production V2源码与bundle未因本轮改变。

## 最新因果结论：停止单root所有权修补

### Stateful option/intent 已完成并拒绝

已按上一轮结论实现诊断专用四帧`StatefulOptionRollout`，复用真实FastKernel
apply/undo，并在精确分支中连续执行整个计划；每一步仍通过FinalActionGate，无法执行时安全
abort。前4场景中254/258条分支完整满足计划、995/999个计划动作成功发出，根恢复失败为0，
说明Plan接线和物理恢复不是问题。

但独立留出失败：前4场景的trajectory-value门从32终局单位提高到36（+4），下一批4场景却
从42降到36（-6）；合并114个root为74→72。无门的balanced/combat option更差，合并
74→46。primitive Risk门能挡住多数退化，但也删掉两个真实胜利轨迹；直接绕过Risk又在留出
产生3个退化、0个改善。

核心证据是同一类第0帧`FIRE→TURN_RIGHT→GO→GO`、敌距24、当前星路打平的局面，在不同
地图/星序列/换位中既能把败局变胜，也能把胜局变败。四帧单一敌方nominal轨迹无法表达长期
目标与响应；固定Plan连续性也不是答案。

因此stateful option代码保留为Shadow诊断，production默认不变。下一结构边界调整为：在V2
FastState上原生重建模块化V1式控制顺序，保留V2事实跟踪和Physical Hard；Strategy、Risk、
Minimax先作为证据服务。后续Risk必须评价response-aware option集合，而不是先按primitive
action删候选。详见[反事实审计](implementation/v2-root-ownership-counterfactual-audit.md)。

已完成精确前缀重放的root反事实审计。8个历史场景、双换位16局中共保存114个早期root，
14个root存在单步终局改善，覆盖9局；其中10个改善动作的当前`expectedValue`反而低于已选
失败动作。第0/16帧CURRENT均为31.25%，逐root事后oracle为50%；第64帧已无单步恢复，
说明主要错误在早期轨迹提交，而非死亡前最后一步。

局部几何ranker的留出集31.75%降至26.98%；加入地图拓扑、四帧动作历史和Plan deadline后
进一步降至25.40%。`POISON_CONTACT_EVIDENCE`把28.13%降至10.94%（正3/负8）；
V1式direct-arrival owner降至25.00%（正0/负1）；objective-first追星GO/TURN与CURRENT
零动作差。Persistent navigation取得所有权也为负；仅生命周期Shadow在两批各32局保持
动作完全一致并减少总本地耗时3.11%/4.22%，但P95未稳定改善，仍默认关闭。

因此下一项实现不再是FIRE bonus、距离阈值、Poison时机或新的root加权器，而是stateful
option/intent：先保存目标、context epoch、期限、完成/abort，再生成“资源中断+位置续行”的
完整序列；每一步仍经过V2 Physical Hard和committed rescue，Minimax只提供区间证据。
详见[反事实审计](implementation/v2-root-ownership-counterfactual-audit.md)。

## 后续因果审计：停止继续堆局部控制启发

在`NO_ACCEPTABLE_ACTION`投影风险修复后的同一固定64场景/128局基线上，对V1/V3中
看似有效的控制合同逐项做了运行时POC。所有POC都只安装在本地诊断Bot，production源码
和bundle hash没有变化。

| 假设 | Discovery / Holdout结果 | 结论 |
|---|---|---|
| V3动作按Escape/Tactical/Strategy控制域替换 | Tactical、Strategy均负向；Escape合并为27/94/7，对照25/97/6，仅+1.95pp | V3状态历史分叉，不能把教师动作当生产证据；EO只值得继续做证书分析 |
| 缩小`TACTICAL_CONTACT` | 近距阈值9→5：28.13%→18.75%；只留清晰射线：17.19% | 搜索覆盖范围不是胜率低的主因 |
| 严格攻击竞速取得initiative | 已瞄准FIRE零动作差；瞄准转向只改1局且胜→负 | 明确射线攻击没有被V2漏掉 |
| 敌方枪口对准时预先离线 | 两个版本均零动作差 | Future-FIRE Safety/Risk已表达该合同 |
| 非接触连续转向断路器 | 合并28/94/6，对照25/97/6，+2.34pp；4个败→胜、1个胜→败 | 正向但未达动作所有者+3pp与显著性门，不接入production |
| 目标运动/出口的possible-hit加权 | 首16场景+1胜；独立48场景反向为13/76/7，对照16/74/6 | 过拟合，拒绝 |
| possible-hit保留压力但取消`INTERCEPT`所有权 | 首16场景28.13%→17.19%，FIRE 247→136 | 当前对V1的路径压制依赖该软攻击目的，不能直接降权 |
| 复用星距离场预测nominal路径 | 首16场景动作指纹零差异 | 继续提高同一purpose的完整度没有选择效果 |

同时完成了当前97个失败局的终局分类：47局为128帧星数失败，42局为弹丸/碰撞，
8局为炸弹；弹丸/碰撞失败的最后有效root有33/42落在`NO_ACCEPTABLE_ACTION`，
而frame-limit失败仍以GO/转向为主。Soft Safety、Information continuation、
StrategyBand和possible-hit分别关闭都会更差，说明当前不是某一个模块“全错”，而是多个
局部有益模块组合后缺少可校准的长期价值目标。

因此本轮停止继续增加FIRE bonus、距离阈值、转向次数阈值或purpose权重。下一项结构工作应是
建立可重放的root反事实价值标签：在同一物理root对各Hard允许动作执行固定后续policy，
得到存活、击毁、星差和终局的多维结果，再验证`robust/expected/tactical/purpose`的排序
是否与真实后续一致。没有该标签前，不再把局部arena波动解释为评分常量问题。

## 最新修复：NO_ACCEPTABLE_ACTION 的未知风险判别

对 Information continuation、runtime mode 和最终动作所有权分别做消融后，排除了三个错误方向：

- 返回浅层值会把固定32场景得分从22.66%降到15.63%，说明depth-2 continuation整体有正贡献；
- 只接受完整 continuation 会降到17.97%，说明不完整区间不能直接丢弃；
- 长期停留在Fallback搜索会降到11.72%，且本地耗时约增至3.3倍，不能通过延长搜索恢复胜率。

真实缺陷位于`NO_ACCEPTABLE_ACTION`：当所有动作都被粗粒度
`unknownMass=10000`判为不可接受时，旧字典序在安全维度打平后直接比较`robustLower`，
导致战术高分可以选中投影位置风险更高的动作。修复后的次序是：

```text
immediateFatalMass
→ horizonFatalMass
→ unknownMass
→ earliestFatalFrame
→ escapeSlack
→ projected unknown fallback risk
→ robustLower
→ stable row
```

新维度只在“没有任何可接受动作”且更强的五个安全维度全部打平时生效。正常Risk可接受集、
Hard、Proof、EO、Minimax和战术评分的所有权均不改变；每个动作的投影风险预先写入固定
`Uint16Array`，最大只增加48 bytes，热路径分配仍为0。

固定64场景/128局的同轮A/B和无hook生产复验均得到25胜/97负/6平，综合得分
**18.75%→21.88%**。逐局净转移为9个`V1_WIN→V2_WIN`、4个
`V2_WIN→V1_WIN`、1个`V2_WIN→DRAW`和1个`DRAW→V1_WIN`；我方被击毁
59→50、对方被击毁16→19、FIRE 946→991、BOMB 262→256。星数52:181→50:189，
说明本轮改善来自存活和攻击，而非抢星。生产复验本地总耗时8,294,965µs、P95最大
7,953µs；本地时间仍不替代平台3秒证据。

诊断工具同时修复Risk域外`NONE`读取旧TypedArray槽位的问题：现在明确输出
`riskDomain=false`和`null`风险值，避免后续把陈旧数据误判为有效候选。

Minimax 98/98、GR0 220/220、聚焦UT和search-frontier benchmark全部通过；
Hard/Proof/risk domination/root restore/timeout/error均为0。紧凑证据位于本地忽略目录
`artifacts/v2-information-depth2/unknown-risk-fallback-discovery-c96a557cfa99/overview.json`。
该结果仍远未达到最终胜率目标，且固定64场景是已暴露开发集；它只证明该结构修复可保留，
不构成最终资格。

## 最新修复：Information depth-2 可执行叶与安全优先调度

固定64场景中定位到一个搜索合同错误：`ProductionInformationSearch` 对五个以上根动作
发布 `completedDepth=2`，但每个 continuation leaf 最少只得到6个节点，而
`ProductionDepthSearch.continuationValue()` 在8个节点以下会直接返回启发式。因此原先的
“depth 2”在宽根上可能完全没有执行 Physical continuation。

第一步把叶预算下限提高到8后，真实 continuation 开始运行，但也暴露两个非单调错误：

1. 早期普通 continuation 会耗尽同行预算，使稍后的 `TURN→FIRE` 陷阱没有足够节点完成证明；
2. 含 `FAST_STATUS` 不完整转移的 continuation 仍能用 `-22000` 覆盖完整浅层值。

最终修复不是全局降低深度或统一扣除安全预算。消融显示全局预留会丢失7/12个原正向翻转，
属于负面改动，未启用。生产路径改为：

- 叶预算下限固定为8；
- 先用投影pose把会形成下一帧直接射线的敌方响应排到同行前部，再分配 continuation 节点；
- continuation分别报告`usable`和`complete`；发生不完整物理转移时只能回退浅层值；
- 动作和优先级排序均复用构造期TypedArray，热路径分配为0。

固定64场景/128局 Discovery：

| 指标 | 旧稳定版 | 仅min-8 | 安全优先调度 | 当前+空调用移除 |
|---|---:|---:|---:|---:|
| V2胜/负/平 | 15/104/9 | 19/103/6 | **21/101/6** | **21/101/6** |
| 综合得分 | 15.23% | 17.19% | **18.75%** | **18.75%** |
| V2/V1星 | 51/205 | 55/178 | 52/181 | 52/181 |
| V2/V1被击毁 | 56/12 | 62/13 | **59/16** | **59/16** |
| V2开火 | 949 | 952 | 946 | 946 |
| 本地总耗时 | 7,593,907µs | 8,348,166µs | 8,439,221µs | **8,018,804µs** |
| 本地P95最大值 | 8,601µs | 9,043µs | 8,289µs | **7,886µs** |

相对旧稳定版，逐局转移为12个`V1_WIN→V2_WIN`、5个`V2_WIN→V1_WIN`、
4个`DRAW→V1_WIN`和1个`V2_WIN→DRAW`；相对仅min-8版本增加2胜、减少2负，
我方被毁减少3、对方被毁增加3。最坏回归局`mat_8XGgH9fwHaq0Yjk30`从第18帧被击毁
改为第31帧击毁对手；正向局`mat_9ho6QlFEODx7ecF8T`仍从第22帧被击毁改善为第128帧存活。

后续性能审计又发现：`InformationSearch` 在同行 continuation pool 只剩4–7节点时仍调用
`continuationValue()`，但Physical continuation的最小可执行预算是8；这些调用必定立即退回
同一个启发式值。五个退化局中989次调用有577次属于这种零节点空调用。生产条件改为至少8节点
才调用后，调用数降至413（其中412次可用），胜负、星、击毁、动作总数、工作计数和相对旧版
转移矩阵不变。固定128局本地总耗时单次同口径下降4.98%，P95下降4.86%；本地墙钟只作为
相对诊断，不替代平台3秒证据。

Minimax 98/98、GR0 216/216、专项UT 9/9和search-frontier benchmark全部通过；
Hard/Proof/risk domination/root restore/timeout/error均为0。紧凑结果保存在本地忽略目录
`artifacts/v2-information-depth2/noop-skip-discovery-c96a557cfa99/overview.json`。

## 最新执行：V2组件因果验证 CTR0–CTR8

V3 已严格恢复为“冻结 V1 的模块化实验宿主”。64场景/128局、9,080帧逐动作差分为0；
真实 `V2_BASE` 使用独立 source/minified hash，旧 `NATIVE_REPAIRED 50%` 已重标为
`V3_NATIVE_BASELINE_EQUIVALENCE`。

逐组件结果没有产生任何 `BEHAVIOR_POSITIVE` 或 `PERFORMANCE_POSITIVE`：

- Observation/Projectile、Hard、Deadline、final-only EO、ForcedWin、PAC 均为正确但中性；
- 完整 TacticalCore owner 的旧 Discovery 仅6.25%；
- 早期 EO 为38.67%；
- 修复无效 NAVIGATION 接线后，V2 Strategy真实覆盖467次，得分显著降到25.00%
  （7胜/23负/2平，p=0.003906）；
- Aim setup缺非FIRE owner，Zone denial缺post-bomb自逃证书，不能靠放宽门槛启用。

因此 `V3_COMPONENT_BEST = V3_BASE`，没有创建 `V2_REPAIRED`。冻结真实V2对V3_BASE的
已暴露64场景/128局基线仅12胜/116负、9.38%；星33:135、被击毁116:19、开火266:388、
炸弹158:19、stun 0:211。这确认当前是全局控制结构问题。

动态历史池有1,243个唯一场景，896个已暴露、347个未暴露；固定盲测需要368个，还差21个。
CTR7因无正向组件阻塞，CTR8未读取Final Holdout。详见
[CTR0–CTR8实施报告](implementation/v2-component-transplant-ctr0-ctr8.md)。

## 最新结论修正：V3R8 的50%不是V2恢复

首次读取的 Final Recovery 256 场景/512 局中，冻结 CURRENT_V2 为
33胜/476负/3平、6.74%；无VM `NativeHierarchicalRoot` 为
232胜/232负/48平、50.00%。但 `NativeHierarchicalRoot` 是冻结 V1 的模块化 V3，
不是 V2，因此 50% 只是 V3/V1 基准等价，不能记作 V2 改善。

真实有效的已有证据是：TacticalCore、早期 EO 和 Strategy 为负向，Combat 没有显著收益，
Observation Shadow 与 Physical Hard 只证明事实/安全接线中性。下一轮将以原版
`V3_BASE` 为对照，把单个 V2 组件替换进 V3，对战确认因果收益；通过后再原生回迁真实 V2。

TypedArray 从旧上限999,280降到 engine 994,432；含独立210-byte ProposalBus的原生根为
994,642。匹配输入 P95 比值102.43%，通过≤110%门。IMP6唯一失败仍是预先允许的体积门：
source 534,367 bytes、minified 515,275 bytes。未执行官方simulate、publish或challenge。

详见：

- [V3R0–V3R8 撤销说明](implementation/v3r0-v3r8-hierarchical-recovery.md)；
- [V2组件因果验证与原生回迁计划](design/v3-v2-component-transplant-recovery-plan.md)。

## 工作区与恢复分支

- 唯一工作区：`/home/skill/workspace/git/agentank_client`。
- 当前恢复分支：`codex/v2-global-recovery`。
- `REJECTED` dirty 源码检查点：`17f0979`。
- Node：`v24.16.0`。
- V1、旧 IMP8 Candidate、官方 context/simulate attestation 和真实 `battle-records/`
  均保持只读。

本轮是 **GR0 全局恢复**。它替代 R21–R23 的逐帧 Capsule 工作流，不再把历史完整回归负载
当成长期资产。旧报告仍是历史说明，但其中被清理的 artifact 路径不再是可用证据入口。

## 已完成：旧证据瘦身

固定工具：

```bash
./tools/artifact-retention-toolchain.sh inventory
./tools/artifact-retention-toolchain.sh compact
./tools/artifact-retention-toolchain.sh verify
./tools/artifact-retention-toolchain.sh prune --manifest \
  artifacts/retention/gr0/verified-prune-manifest.json
```

结果：

| 项 | 结果 |
|---|---:|
| 删除文件 | 24,825 |
| 释放空间 | 4,592,945,690 bytes |
| 清理后 `artifacts/` | 约 16 MB |
| `battle-records/` | 约 162 MB，未删除 |
| Verified manifest | `493a144e2f6291844c2a71f8294322084ba6e1e403f11e96a94337d24bc94ccb` |
| Prune receipt | `0e84f433fc4bea60f9b1d595d7cd5d046fc7ae2f451f0d3cebcf4ef4bd2525ab` |

紧凑 `LegacyArenaBaselineV1` 保留：

| 基线 | 分母 | V2 胜 | V1 胜 | 平 |
|---|---:|---:|---:|---:|
| IMP8 common | 1,952 | 731 | 1,091 | 130 |
| working `0ed5c5…` common | 5,936 | 550 | 4,849 | 537 |
| SR3 final | 2,128 | 1,225 | 792 | 111 |
| SR4 final | 2,128 | 1,179 | 828 | 121 |

同时保留历史 55.6% 汇总及其源码指纹，并明确标记其精确源码字节缺失。紧凑基线位于本地忽略目录
`artifacts/retention/gr0/baselines/`；它们只保存逐局结果，不保存逐帧 state、candidate rows、
replay events 或重复地图/星序列。

## 已完成：GR0 结构修复

生产选择顺序固定为：

```text
Hard
→ Risk 多维可接受集
→ committed escape 交集
→ Pareto 支配
→ 最大 robustLower safe floor
→ StageMatrix
→ expected / tactical / 稳定行号
```

关键约束：

- Information 风险不再清空 tactical、不再降低 safe floor，也不禁用 mixed policy。
- `NO_ACCEPTABLE_ACTION` 只在 Risk 可接受集为空时按最小风险字典序回退，Hard 永不放宽。
- `EscapeObligation.evaluateCommitted(...)` 只绑定真实炸弹和敌方 committed 弹丸。
- 实体身份是 `kind + owner + id + generation`。
- possible projectile、future FIRE、己方弹丸和枪口朝向不创建 Escape obligation。
- ReverseViability 证明可活的 FIRE、NONE、技能和移动动作一律保留。
- support 不完整不限制动作；EO 不再制造 Safety 死亡概率。
- `null` 弹丸观察只对严格可见射线做反证；单数弹丸仍不代表完整集合。
- 同平台帧重复求值保持幂等，Physical TT 可以复用。

## 已完成：纯结构门禁

唯一入口：

```bash
npm run test:gr0
```

该脚本只做修改文件语法检查和纯 UT，不读取 `battle-records`、旧回归、Capsule、focused cohort
或对战模拟。当前结果：**140/140 PASS**。

覆盖：

- exhaustive 小型 Minimax max-min/min-max、simultaneous matrix、chance/hidden robust backup；
- Proof AND/OR、HiddenWorld/Chance/Observation 严格量词和所有预算前缀不产生假 Proof；
- StageMatrix exact bounds、exploitability、dominated row 和不完整矩阵语义；
- iterative deepening 中断只保留最后完整深度；
- root restore、状态复用、物理 TT、cache on/off；
- Risk 阈值、Pareto、robust floor、emergency lexicographic fallback；
- committed Deadline/EO、实体复用、possible/future threat 隔离；
- FIRE/NONE/技能 survivor 保留、Hard 不可恢复、Safety mass 不被 EO 修改。

## 已完成：GR0 6,608 局全量对战（REJECTED）

GR0 完整运行已得到：

| 项 | 结果 |
|---|---:|
| 完成局数 | 6,608 / 6,608 |
| V2胜 / V1胜 / 平 | 1,125 / 4,630 / 853 |
| `V2胜 + 0.5×平` | 23.47% |
| 固定266场景 V2单方击毁胜 / 负 | 111 / 465 |
| avoidable Hard / dominated / root restore / timeout / error | 0 / 0 / 0 / 0 / 0 |

结构可靠性通过，但玩法门失败，GR0 状态为 `REJECTED`。

## 已完成：未提交变更因果审计与选择性恢复

整段回退到 `643ae1e` 在同样本上更差且约慢 2.3 倍。已证明并保留 Information depth 2、
inexact Information 路由、clear-line 反转和 committed-only EO；已证明并删除近距离面向敌人
的重复 `-800` 惩罚。独立 holdout 从 54/284/46 改善为 60/277/47，得分
20.05%→21.74%。详见 [GR0 变更因果审计](implementation/gr0-change-causality.md)。

下一步必须在新的完整 arena 前先继续定位其余独立结构原因；本次选择性修复本身不宣称满足
60% 资格门。Production source/minified 语义一致，但临时构建为 427,475 bytes，仍超过平台
204,800 bytes 限制。

## 已完成：SS-A0 Soft 风险栈因果消融（Discovery REJECTED）

冻结 `9de24c9` 后，使用本地实例包装器运行固定 96 场景、5 模式、4 variants、1 repetition，
共 1,920 局。CURRENT 为 87/260/37，27.47%。`COMMITTED_ONLY_RISK` 提升到
171/196/17、46.74%，星差改善 578，但单方击毁负从 79 增到 166；`SOFT_ALL_OFF`
为 137/233/14、37.50%，单方击毁负增加 125。两者均违反最多增加 3 场的死亡护栏。
`NO_OBSERVATION_FRONTIER` 退化 3.13pp，`NO_INFORMATION_ENVELOPES` 仅提升 0.39pp 且星差下降。

没有模式通过 Discovery 全部门槛，因此按预注册停止条件没有读取或运行 170 场景 Holdout。
结论不是“Soft 没有影响”，而是“整体关闭 Soft 不能安全解释并修复退化”。下一轮转向
Information value、目标/抢星动作生成和搜索选择，不继续削弱 Safety。详见
[SS-A0 因果消融](implementation/ss-a0-soft-stack-ablation.md)。

## 当前决策：SS-A1 以 committed-only 为开发基线

SS-A0 的预注册结果保持不可变；后续不追溯改写其 Discovery 门。新的 SS-A1 决策将
“单方击毁负场增加最多 3”从候选淘汰门降为诊断与同分排序指标，开发基线改为
`COMMITTED_ONLY_RISK` 的 171/196/17、46.74%。

总体目标仍是 `V2胜 + 0.5×平局 > 60%`。在当前 384 局分母上，至少还需约 51 个净胜场等价。
Hard、strict Proof、risk-dominated selection、root restore、timeout/error 仍是零容忍门。

SS-A1 先逐项恢复 possible projectile、future FIRE、unknown/escape slack 和 MultiFrame
continuation，再组合通过单项验证的最小子集。这样把“Soft 全开导致胜率回落”和“Soft 全关导致
击毁负增加”拆成可归因的独立维度。只有开发场景超过 60% 后才解封固定 170 场景 Holdout；
未达到时不消耗 Holdout，也不修改 production 默认。

SS-A1 没有继续执行，也没有把 `COMMITTED_ONLY_RISK` 接入 production；随后接受的
STRAT2 是目标所有权与战略选择的独立架构变更，不追溯改写 SS-A0/SS-A1 结论。

## 已完成：STRAT2 D0–D3 战略层实现（未完成 D4 资格）

`DEC-0095` 已接受 STRAT2：默认战略为 `KILL_PRESSURE`，五个战略共用 canonical
evaluator、固定 RiskProfile 和同一套 Minimax。Risk/EO/Pareto/global robust safe floor
形成后，离散 `PRIMARY/SUPPORT/FALLBACK` band 才能缩小 StageMatrix rows；strategy 不能
恢复动作、放宽风险、降低 safe floor 或修改 matrix cell。

已完成：

- `STRAT2_INTEGER_POLICY_V2` manifest/schema 与静态 descriptor fingerprint；
- KILL/ATTACK_SETUP/STAR/PRESERVE/COMEBACK purpose band；
- COMEBACK 击杀/星逆转 deadline 比较；
- 抢星 GO/TURN 分数从 KILL/SETUP 全局路径移除；
- band-aware StageMatrix/mixed policy 生产接线；
- 真实 ProductionRoot qualified FIRE、Minimax strategy oracle 和零热分配测试。

本地结果：GR0 144/144、IMP5 191/191、IMP6 207/207 全部通过；Selector/Band
P95 分别为 2,214ns/1,774ns，instrumented allocation 均为0。source/minified
语义差分为0。

已运行 32 个 Discovery 场景的 D3 机制抽样（每模式 128 局），但未运行正式
Discovery、Holdout 或全量 arena，因此不能宣称满足“击毁+10%且总得分>60%”。
抽样显示 CURRENT 相对强制 STAR 的 FIRE rate 从 6.04% 增至 8.44%，但关闭
StrategyBand 后为 8.60% 且逐局 W/L/D 不变，说明 band 本身尚未形成可观察的
开火优先级贡献。CURRENT 的 1,216 次 FIRE 中 1,025 次没有严格攻击 purpose，
且抽样得分仅 6.25%，低于强制 STAR 的 22.66%；当前结论是“开火数量提升，但
攻击质量和胜负退化，D3 未资格化”，下一步先分类无目的 FIRE，不进入 Holdout。
当前 minified 为444,622 bytes，仍超过204,800-byte上传门，也不能形成新Candidate或进入
官方simulate。详见 [STRAT2 实施记录](implementation/strat2-strategy-layer.md)。

### STRAT2 D3.1：possible-hit 攻击资格（正向、未资格化）

已将“当前不直击，但敌方能在弹丸到达前进入射线”的 FIRE 标记为 soft
`INTERCEPT/possibleHit`。它只获得 expected tactical 攻击资格，
`robustPressure=0`，不会产生 Hard、strict Proof 或 DIRECT_KILL，也不能绕过
Risk、EO、global safe floor、StrategyBand 或 StageMatrix。

优化后的固定 32 场景、256 局因果 A/B 为：

- ON：9/118/1、得分 7.42%、FIRE 1,289、单方击毁 8胜/20负；
- OFF：7/119/2、得分 6.25%、FIRE 1,216、单方击毁 7胜/24负；
- ON−OFF：得分 +1.17pp、FIRE +73、有目的 FIRE 比例 +12.92pp、
  星差 +7、单方击毁 +1胜/-4负；
- avoidable Hard、risk domination、root restore、timeout/error 全部为 0。

局部 BFS 已通过独立全图最短路 oracle；GR0 为 145/145。变化敌方冷路径 P95
中位数由旧全图距离场约 32.8µs 降至 9.77µs，热路径零分配。报告位于
`artifacts/diagnostics/strategy-priority-sample/strat2-908b3ecb96dd62b4/`。

结论是“possible-hit 是正向结构修复”，不是“战略层已通过”：抽样总得分仍只有
7.42%，未运行 Holdout 或完整 arena。最终 minified 为 449,520 bytes，仍超过
204,800-byte 上传限制，未形成 Candidate，未执行官方 simulate/publish/challenge。

### STRAT2 D3.2：ProjectileAttackClosure（结构通过、行为中性）

已实现 candidate FIRE 后的敌方生存闭包：

```text
FIRE × EnemyAction × Chance
→ committed projectile timeline
→ orientation-aware ReverseViability
→ PROVEN_DOOMED / SURVIVES / UNKNOWN
```

它会压缩被已提交弹道证明必死的敌方移动 continuation，但保留敌方根列、反击、
同归于尽和星数终局语义。局部 doomed 不能写 Hard 或 strict Proof；逐列 soft pressure
只能在 Risk、EO、Pareto、global safe floor 和 StrategyBand 后进入 StageMatrix。

专项测试 13/13、GR0 146/146、IMP6 16/16。FastKernel continuation oracle 对
`PROVEN_DOOMED` 零假阳性；PAC cache 重放幂等，soft qualification 纳入缓存键。
固定 Node 五批根性能的 P95 ratio 为99.30%，paired median为101.40%，热分配和
root restore failure均为0。

256局 PAC-on/off A/B 中，CURRENT 执行1,282次 reverse build，发现137个 doomed
cell，但两模式均为9/118/1、FIRE 1,289、单方击毁8胜/20负，星差和全部动作计数也一致。
这证明接线和证书真实运行，但没有证明 gameplay lift：有生存应对时，理性敌方本来就不会
选择死亡应对；短程 doomed 又与既有深度搜索的终局重复。

当前结论为“保留结构证据，不宣称火力提升”。若继续，必须设计 survivor-frontier
endpoint value，衡量被弹道约束后的最差生存位置或机会成本；不能提高固定 FIRE bonus，
也不能把局部 doomed 升级为 ForcedWin。当前构建 source/minified 为
483,335/466,382 bytes，仍不满足204,800-byte上传门。

### STRAT2 D3.3：SurvivorFrontier（结构通过、全量 REJECTED）

PAC2已实现PAC1存活分支的双前沿比较：敌方baseline最佳endpoint与受候选弹丸约束后的最佳
endpoint只比较反击setup delay和最佳mobility，endpoint数量减少只作审计。PAC2只写
expected/tactical cell pressure，不写Hard、Safety、EO、robustPressure或strict Proof。

最终实现使用固定pose bitset、非空word列表、双buffer顺序复用、相同后继pose缓存和PAC专用
双层ReverseViability。PAC1/PAC2已并入统一GR0门禁，GR0 168/168、IMP6 16/16通过；P95/median
on/off均为102.99%，热分配与root restore为0。ProductionRoot TypedArray为998,783 bytes。
source/minified为499,081/481,650 bytes，仍超过平台上传门。

32场景、256局A/B中，PAC2计算1,230个距离场、4,686个唯一前沿和847个压力cell，但开火、
动作、星差与W/L/D完全不变。说明实现真实运行，却没有穿过根选择边界。

按用户授权继续运行最新826场景、2 repetitions、4 variants的6,608局compact全量：

| 指标 | 结果 |
|---|---:|
| V2胜 / V1胜 / 平 | 585 / 5,712 / 311 |
| 分析得分 | 11.20% |
| 固定266得分 | 10.78% |
| 固定266单方击毁胜 / 负 | 175 / 365 |
| 全量单方击毁胜 / 负 | 548 / 1,143 |
| 128帧星数终局 V2胜 / V1胜 | 37 / 4,413 |
| avoidable Hard / dominated / restore / timeout / error | 0 / 0 / 0 / 0 / 0 |

V2开火50,964次，比V1的36,024次多41.5%，因此根因不是开火数量不足。当前主要问题是：

1. 128帧位置/星数价值几乎全面失败；
2. 射击数量高但击毁效率低，projectile/collision单方失败1,092场、bomb失败51场；
3. survivor-frontier soft压力没有改变根动作；
4. SKILL_CROSS得分9.99%，低于NATIVE 12.42%，技能交换放大但没有单独造成退化。

相对IMP8共同1,952局，得分40.78%降至10.71%；相对working `0ed5c5…`共同5,936局，
13.79%降至11.20%。PAC2的32场景A/B动作中性，所以不能把累计退化归因给PAC2。
本轮状态为`REJECTED`，没有执行官方simulate、publish或challenge。下一步先解释
“847个压力cell为何没有改变动作”并建立攻击continuation价值链，不再加FIRE固定分或直接跑
另一轮全量。详见[PAC2实施记录](implementation/pac2-survivor-frontier.md)。

## 当前实现：STRAT3 RST1 战略—搜索反向接入

`DEC-0096` 已替代 STRAT2 的“先选active strategy再影响动作价值”语义。当前 production：

```text
Hard/Proof → strategy-neutral baseline/search
→ Risk → committed EO → Pareto → robust safe floor
→ multi-strategy proposal portfolio + neutral anchor
→ one StageMatrix → FinalActionGate → commit selected strategy
```

关键变化：

- canonical evaluator绑定稳定的profile 0，strategyId不再改变action score或Risk；
- selector只从最终安全集合中的攻击证据激活KILL；
- 每strategy最多提出两个代表，中立anchor不可删除；
- strategy状态在最终动作通过FinalActionGate后才提交；
- Minimax仍只在`tacticalContact`运行一次，不承担长期星路/128帧战略。

结构门：Minimax 56/56、GR0 173/173、IMP5 14/14通过。固定32场景、每模式128局：

| 模式 | V2/V1/平 | 得分 | 星差 | 单方击毁胜/负 |
|---|---:|---:|---:|---:|
| CURRENT | 29/84/15 | 28.51% | -72 | 8/25 |
| FORCE_STAR | 29/84/15 | 28.51% | -72 | 8/25 |
| BAND_OFF | 29/84/15 | 28.51% | -72 | 8/25 |

相对旧动态STRAT2同样本约6.25%已显著止损，全部硬不变量为0；但三模式逐局动作一致，
说明当前atomic portfolio尚无可观察战略控制力。状态是`RST1 IMPLEMENTED / GAMEPLAY NOT
QUALIFIED`。

性能/容量也未资格化：selector prepare和portfolio build的P95分别为3,778ns和4,870ns，
热路径分配为0，但相对旧STRAT2微基准退化；IMP6为15/16，唯一失败是source
505,662 > 500,000 bytes。本地TypedArray为998,836 / 1,000,000 bytes，minified
487,967 > 204,800 bytes。下一步先做committed-membership + soft-value恢复，再让strategy产生
不同多步Plan候选，并在语义稳定后瘦身；不运行全量arena，不形成Candidate，不执行官方
simulate/publish/challenge。详见
[STRAT3实施记录](implementation/strat3-portfolio-rearchitecture.md)。
# Strict committed rescue：接受为V3实验安全组件（2026-08-03）

在所有权影子基线上，将 `committed entity exists` 收窄为最终动作证书：只有完整
committed closure 同时证明“V1最终动作死亡”与“替代动作可活”时才允许接管。

- Discovery 32局：279个 committed-evidence 根最终只有1个提案；该提案把
  `mat_IYaL8CRgtYW3kzsLs` 从第59帧自炸失败变为第73帧击毁对手，得分50.00%→53.13%，
  `LOSS→WIN=1`、负向转换0。
- Holdout 96局：1,136个 committed-evidence 根最终只有4个提案；W/L/D逐局完全不变，
  `WIN→LOSS=0`、`DRAW→LOSS=0`。其中3局从单方死亡变为存活到128帧，仅因星数落后仍判负；
  第4局终局不变。
- Discovery+Holdout 共128局：严格救援5个初始提案；所有提案均满足 preferred
  `PROVEN_DEAD`、replacement `PROVEN_VIABLE`、Physical Hard允许。`root restore failure=0`、
  search node=0、热分配=0。
- 该组件分类为 `CORRECT_POSITIVE_SAFETY`，加入V3实验 `BEST_COMMITTED_RESCUE`；
  它不是统计显著的普通动作所有者，暂不回迁V2 production，也不改变官方Candidate。

这修正了旧VC3的错误所有权：旧VC3在三个早期逃生端口看到 committed entity 就接管，
得分38.67%；新实现只在最终动作证书成立时接管，Discovery 53.13%、Holdout 50.00%。

# Native control ownership shadow：互斥 RootMode 已被实证否定（2026-08-03）

已在固定 VC0 Discovery 16 场景、换位 32 局、共 1,804 个决策根上完成
V1 真实所有权追踪与 V2 FastState 原生物理前缀影子运行。影子逻辑不选择动作，
production 行为未改变。

- 对照动作、星、击毁完全一致：16/16 换位 split，分析得分 50%，逐动作计数一致。
- V1 所有 1,804 帧均可归属，`UNATTRIBUTED=0`：Bomb 35、可见弹 4、持续逃生 4、
  HiddenAttack 2、DirectAttack 68、Preemptive 25、内联稳定性 62、Tactical 1,152、
  Navigation 404、FinalGate 改写 48。
- V2 物理影子前缀执行 11,110 次 Hard 检查、1,804 次 committed EO，
  `rootRestoreFailure=0`、`searchNodes=0`、热分配为 0。
- 旧三模式分类为 Escape 19、Contact 1,338、Navigation 447，但它错误压扁了同时成立的
  所有权：25 次 BombSafety、4 次 ProjectileEscape、58 次 Stability 都发生在 Contact 模式中。
- 改为可重叠端口后，1,804 根中有 1,380 根同时存在两个以上候选端口：
  committed evidence 279、stability 117、tactical evidence 1,357、navigation fallback 1,804。
  因此 RootMode 只能作证据标签，不能再拥有互斥的最终控制权。
- `informationIncomplete=1,598` 不是 PhysicalState 不可用；用它阻断 Hard/committed/contact
  分类会把大多数正常帧错误降级。本轮已在影子合同中将两者分离。

结论：下一步不调 `distance<=9` 或 Risk 权重。建立有序 Proposal 端口，允许多个端口同帧提出
动作；先验证 committed safety 的“何时必须接管”和候选动作，再依次验证攻击、预防闪避、
稳定性、战术证据和导航。`entity exists` 不能直接接管——影子中 committed evidence 有279帧，
而V1实际 committed safety 仅43帧，需要 deadline/后继可活度进一步收窄。

证据：`/tmp/agentank-native-control-port-shadow/overview.json`（可再生临时 artifact），
runner 已支持 `NATIVE_CONTROL_SHADOW`，正式代码默认未启用。

# HP13 Information 区间所有权：旧近似标量不能安全接管（2026-08-09）

在 HP12 已关闭无消费者 Information 计算后，HP13 新增了诊断专用区间合同，严格要求
`candidate.lower > incumbent.upper`，点估计只允许排序工作。固定16场景中，旧路径运行
1,282次 InformationSearch，产生6,070个动作；点估计有666次希望改变当前动作，但所有动作
区间均为`[-32000,32000]`，严格支配提案为0。

缺失不是单一预算问题：1,282次全部缺输入完整性和ObservationSplit前的共同后续策略，
其中1,215次还裁掉敌方响应列，5次发生work中断。把每个隐藏世界独立运行的Physical
continuation当作Information lower bound在理论上不成立，因为它允许同一观察组选择不同动作。

结论：保留HP12 consumer-aware production调度，不恢复旧Information标量到Risk、StageMatrix
或Proposal所有权。HP13只增加诊断工具和UT，没有改变production源码，因此HP12冻结标定仍为
CURRENT。下一步HP14先实现带ObservationSplit共同策略约束的区间Shadow oracle；若仍不能产生
非全范围区间，就继续把运行预算留给严格Physical Minimax。详见
[HP13实施记录](implementation/hp13-information-interval-ownership.md)。

# HP14 Common-policy Shadow：深层融合错误与单层性能边界（2026-08-09）

新增零热分配的CommonPolicyIntervalOracle，并用81组exhaustive双世界效用矩阵验证：同一观察
组必须共享后续动作；只有ObservationSplit后才允许各分支采用不同动作。经典对立效用样本中，
旧逐世界Physical continuation把真实`-100`共同策略值高估为`+100`，fusion gap为200。

固定16场景中，旧深层Information的1,282次尝试只有67次仅缺共同策略，且只有22次点估计会
改变动作；1,215次还缺敌方响应列。单层对照则有1,886/1,894次完整几何支持、904次首选
分歧，说明整体`informationComplete`错误耦合了几何与possible projectile等独立Risk事实。

但全宽单层使work从4,383,247增到6,260,067（+42.8%），Physical节点从24,366降到
17,166（-29.5%）。小样本多出的一个胜局只是无消费者搜索改变预算时序，不能作为价值收益。

结论：production继续保持HP12调度。下一步HP15把单层几何证据移到Risk/Strategy候选形成后，
只计算基准动作和最多两个qualified challenger，并要求完整区间严格分离；不再恢复每帧全宽
Information。详见[HP14实施记录](implementation/hp14-common-policy-interval-shadow.md)。

# HP15 选择性单层几何：三行矩阵通过Shadow门（2026-08-09）

新增post-decision SelectiveGeometrySearchProbe，只保留实际最终动作、最强Risk/Pareto普通
challenger和最强攻击challenger；只有一个动作的614个根直接跳过。固定16场景中，full
61,099节点降到compact 25,772节点，节省57.82%。

Compact与full对3,760个同行root value、22,876个enemy-response cell全部零差异；产生193个
严格改善机会，假阳性0，root restore失败0。两行版虽更省，但严格机会降到156，损失约19%，
所以冻结三行作为下一阶段宽度。

该结果不要求compact复现全局几何赢家，因为几何不能恢复Risk拒绝动作；合同是证明某个合格
challenger严格优于selected。当前仍未接入真实runtime ledger，不能宣称fallback问题已解决。
下一步HP16在Risk候选形成后以可取消optional quota运行同一三行搜索，先验证真实fallback和
Physical完整迭代不退化，仍不立即取得动作所有权。详见
[HP15实施记录](implementation/hp15-selective-geometry-shadow.md)。

# HP16 真实runtime Shadow：机制保留，常驻调度拒绝（2026-08-09）

三行几何搜索已接到Risk/Strategy之后、FinalActionGate之前，并使用真实optional work ledger；
它仍不直接选择动作。固定16场景完成658次搜索并发现96个strict improvement机会，证明
HP15的几何辨别力不是离线假象。

但work从4,383,247增到4,887,161（+11.5%），Physical节点从24,366降到21,412（-12.1%），
完整value owner从70降到66；degraded/fallback显著提前。32局W/L/D保持3/28/1，但5局动作流
因runtime mode变化而不同。所有Hard、Risk domination、restore和热分配不变量仍为0。

结论：production默认继续关闭。下一步HP17只研究零搜索特征驱动的稀疏触发器，目标是在保留
大部分96个机会时显著降低13,422个Shadow节点，并要求Physical完整owner不再下降。详见
[HP16实施记录](implementation/hp16-runtime-selective-geometry-shadow.md)。

HP16后Minimax 146、Diagnostics 100、GR0 280、IMP5 14全部通过；24-profile深度标定已冻结为
`config/engine-v2/minimax-depth-baselines/after-hp16.json`，source fingerprint为
`ef9d4fe3a4327c2f3fb182e55f6141c8d43dd74f18225cf99dbd0713ce803c78`。

# HP17 稀疏几何调度：C4进入Shadow候选（2026-08-09）

固定16场景按哈希拆成8场Discovery和8场Validation。根级静态规则选出
`candidateWidth=3 && challenger expected < selected expected`：Validation保留63.9%严格机会，
但节点保留49.9%，未通过45%门，因此没有放宽门槛直接接受。

在冻结规则上继续进行2/4/8帧冷却消融。4帧版本保留50/96（52.1%）机会，把Information节点
从13,422降到3,612（-73.1%），完整Physical owner维持70；32局动作与结果相对CURRENT零差异，
全部硬不变量为0。其总work仍高3.47%、Physical节点仍低2.51%，所以仅冻结为Shadow候选，
production默认关闭。

下一步HP18使用固定`mask=97/value=1/cooldown=4`运行受限几何Proposal ACTIVE/SHADOW A/B；
只有整局收益能覆盖额外work时才考虑默认启用。详见
[HP17实施记录](implementation/hp17-sparse-geometry-schedule.md)。

HP17后Minimax 146、Diagnostics 105、GR0 280、IMP5 14全部通过；深度标定已冻结为
`config/engine-v2/minimax-depth-baselines/after-hp17.json`，当前source fingerprint为
`0e6db704e8b32e33489e639c61c3c1a09d84bbb25994ae4de1debcce4436e6c8`。

# HP18 单层几何Proposal：独立验证拒绝动作所有权（2026-08-10）

HP17的C4 Shadow已接成诊断ACTIVE候选：只有三行单层完整敌方矩阵中challenger的root value
严格高于当前动作才发布Proposal；严格ForcedWin和committed rescue保持更高优先级，且Proposal
仍需通过FinalActionGate。

固定16场景Discovery出现5个正向、2个反向转换，得分10.94%升至17.19%。但独立32场景
Tactical Holdout出现2个正向、9个反向转换：W/L/D从10/49/5退化为6/56/2，得分19.53%
降至10.94%，单方被击毁从16增到29。Active的work下降11.47%来自更早死亡和更短轨迹，不能
记为性能改进。全部硬不变量仍为0，说明失败属于所有权语义，而不是Hard、restore或热分配错误。

结论：`SELECTIVE_GEOMETRY_ACTIVE_C4`标记REJECTED，production默认关闭；C4 Shadow保留。
单层几何分离可以服务搜索证据和预算调度，但不足以替换长期动作。后续不能通过放宽margin、
Risk或触发条件复活它，只能研究跨帧可恢复证书或更深完整值区间。详见
[HP18实施记录](implementation/hp18-geometry-proposal-ownership.md)。

HP18后Minimax 146、Diagnostics 107、GR0 280、IMP5 14全部通过；24-profile深度标定冻结为
`config/engine-v2/minimax-depth-baselines/after-hp18.json`，source fingerprint为
`4058bbb8d2357d58469230842ac38fe07ca8b44801edb60eed0a01da6f025cb5`。

# HP19 P2规模预估：主要瓶颈是低预算/stun旧调度（2026-08-10）

HP19复用固定deep action slab，在完整P1后继上Shadow计算P2节点下界。16个Minimax固定根及
固定16场景均保持动作、值、root cells、节点、work和整局结果零差异，热路径分配为0。

73个Physical根中，46个进入Direct-P2，14个被低node budget门槛挡住，12个被stun挡住，
直接火线只挡住1个。46个Direct根投影的P2节点下界为6,272，可用节点为20,638，没有任何根满足
“数学上必然放不下”。其中43个P2完成，3个因支持不完整早停，预算中断为0。

结论：拒绝按投影下界切换Selective-P2；P1停滞的主要改进面是低预算和stun下仍使用的旧调度。
HP20应标定低预算先完成full-width P1的调度，不调整Minimax值和胜率参数。详见
[HP19实施记录](implementation/hp19-depth-two-preflight.md)。

HP19后Minimax 148、Diagnostics 107、GR0 282、IMP5 14全部通过；24-profile深度标定冻结为
`config/engine-v2/minimax-depth-baselines/after-hp19.json`，source fingerprint为
`3b664292f8fe176bc00acdd982fb7e74cf4f03bbc67df66b004bc5da2c11f11b`。

# HP20 低预算full-width P1：threshold 192拒绝（2026-08-10）

将Direct调度门槛从250降至192后，固定16场景有9个root切换调度，P2完成数由43增至49；但
整体Physical深度分布仍为`P1=19/P2=49/P3=1/P4=4`，完整value owner仍为70。候选多消耗
91节点和512 work，动作与整局结果零变化。

结论：新增P2完成只是替代旧调度的同层工作，没有让Minimax更深。候选REJECTED，production
保持250门槛。下一步HP21只研究17个stun阻断根的ChanceOutcome调度，不与低预算阈值组合。
详见[HP20实施记录](implementation/hp20-low-budget-full-p1.md)。

HP20未修改Minimax源码；Minimax 148、Diagnostics 107、GR0 282、IMP5 14全部通过，
`after-hp19`标定状态仍为CURRENT。

# HP21 选择性stun Direct-P2：小根production启用（2026-08-10）

对所有stun根直接切换full-width P1/P2会在90节点的宽根上80次零增深、平均多118节点；因此
production只对root Chance matrix不超过48节点的stun根启用Direct调度，宽根保持legacy路径。

固定16场景精确P2 owner增加5个，整局work增加0.64%；独立32场景精确P2 owner增加4个，
整局work只增加0.081%。两批共96局动作、终局、星数和W/L/D均零差异。五批宽根benchmark中
选择性版本与legacy节点差为0，所有restore和热分配不变量为0。

HP21已作为production默认。Minimax 152、Diagnostics 108、GR0 286、IMP5 14全部通过；
24-profile标定冻结为`config/engine-v2/minimax-depth-baselines/after-hp21.json`，source fingerprint
为`0ca00e2d0abe38d4cd6fed4f0f54b45316d62d4aa0dca4aac369eeaf68f68a68`。详见
[HP21实施记录](implementation/hp21-selective-stun-direct-p2.md)。

# HP26 Physical TT跨帧容量：保持32项（2026-08-10）

同根warm cache曾显示128项可让P3完成9/9，但父帧推进到实际后继帧后，64/128/256项均没有产生
任何depth gain。固定16个后继中，32项保留父cache使用4,562节点、冷子帧4,498节点；256项才
降至两边同为4,461节点，却额外占10,528字节。因此扩容不进入production，下一靶点改为P3
ply-2的唯一状态与分支成本。

同时修复了深度标定源码身份遗漏：cache实现和cache ABI现已进入source fingerprint。标准24
profiles每profile 80次重新标定后，深度、selective proof和平均节点相对HP25零差异，新基线
`after-hp26.json`状态为`CURRENT`。详见
[HP26实施记录](implementation/hp26-physical-tt-successor.md)。

# HP27 冷P3结构归因：下一步是windowed maximin（2026-08-10）

精确身份census显示85.58%的TT probe是首次state-depth-width，重复miss只有2.33%；最佳row已经有
84.73%排第一，事后完美敌方排序最多再省7个cell；Chance等价后继只占0.42%。这些局部方向都
不足以达到6–15%的冷P3节点目标。

当前深层实现只在单个state内部剪枝，没有把父maximin窗口传给递归child，所以大量只需证明
“不优于当前最好”的child仍被算成精确值。HP28将先用理论oracle验证显式
`EXACT/LOWER/UPPER`的windowed maximin及Chance上下界，达到节点门后才考虑固定栈实现。
详见[HP27实施记录](implementation/hp27-p3-state-identity-census.md)。

# HP28 Windowed Maximin：P3完整证明提升3倍（2026-08-10）

递归Physical child现在继承父maximin窗口，并显式返回`EXACT/LOWER/UPPER`。bound只参与本次
选择性搜索剪枝，不写入TT或exact StageMatrix；多outcome Chance保守回退完整窗口。普通P1/P2、
Information、Hard、Proof、Risk和战略语义均未改变。

独立递归oracle在固定16根depth-3节省29.82%节点，64根risk 0/50/100分别节省33.38%、
34.24%和37.51%，动作/值/restore零差异。Production固定栈在512节点下把冷P3完整选择性证明
从2/9提高到6/9、热P3从8/9提高到9/9。

最终24-profile五批标定中，P3证明从10/80提高到30/80；冷节点均值406→393，热节点均值
256→240，P1/P2支持完全一致，所有不变量为0。新基线`after-hp28.json`状态为CURRENT。
Minimax 163、Diagnostics 121、GR0 297、IMP2 53、IMP3 28、IMP5 14、IMP6 16，合计692项
测试全部通过。

本轮没有运行胜率对战；深度/完成率与策略强弱继续分开验证。当前minified bundle 609,201字节，
平台体积阻塞仍需后续production瘦身。详见
[HP28实施记录](implementation/hp28-windowed-maximin.md)。

# HP29 P3预算分配：保持512，拒绝全局加节点（2026-08-10）

HP28把固定16根冷P3全部完成门槛从896降到620；三个512长尾的实际完成点是513、520和620。
但全局提高node cap不是免费性能：576在独立32场景Holdout中把选择性深度单位298→304、累计
work仅增加0.60%，且64/64动作/结果相同；同时搜索帧171→170、完整P1/P2 owner 155→154。
620在Discovery还额外引入1局3帧emergency。

因此576和620都只保留为诊断profile，production继续512。下一步只针对scenario 4的108节点
缺口做分支成本census，目标是在相同预算内完成，而不是把更多工作提前并导致未来更早fallback。
诊断入口加入后已重新执行五批24-profile标定，HP28的全部depth/value/node直方图零差异；
`after-hp29.json`为当前基线。
详见[HP29实施记录](implementation/hp29-node-budget-allocation.md)。

# Two-stage AttackSetup：物理证书已出现，Information所有权仍阻塞（2026-08-11）

诊断专用闭包现在验证完整的`GO/TURN → 敌方响应 → FIRE → 敌方响应 → 弹丸失效`链。
固定16场景对全部移动primitive扫描738次，得到7个物理证书、657个拒绝和74个不完整；
总显式节点1,409、单候选最大56，预算/restore/热分配失败均为0。

但7个证书中6个仍是Information全范围区间，唯一精确证书也没有严格支配当前动作。
受`exact lower > incumbent upper + Hard + Risk`约束的ACTIVE POC因此产生0个
ATTACK_SETUP提案、0个接管，整局4/27/1及全部动作指标零变化。production继续默认关闭。
下一步只为这7个根构建共同策略Information下界，不再扩大普通Minimax或放宽Risk。
详见[两阶段AttackSetup记录](implementation/two-stage-attack-setup-shadow.md)。

# Possible projectile AttackSetup：支持已闭合，价值所有权仍未闭合（2026-08-11）

两阶段证书中的6个possible-projectile根现已同时验证“弹丸不存在”和“弹丸存在”世界，且要求
两边执行同一个`GO/TURN → FIRE`策略。本地模拟器的4个poison cadence冲突全部被识别为已知
绝对帧奇偶偏差；只在可撤销证明世界中按观测`canActThisFrame`重建相位，不修改production
物理规则。

固定16场景最终得到2个跨世界证书、4个明确反证、0个不完整；总present-world节点17、单根
最大7，restore/热分配/硬不变量均为0，整局仍精确4/27/1且动作零变化。新增的负局证书位于
`mat_KlF8S4gI3ryC6gSoB`第57帧，但其Information区间仍为`[-32000,32000]`，因此不能取得
动作所有权。下一步应验证“相对当前动作的nonloss/value证书 + 次帧FIRE持续执行”，不能把
攻击压力直接升级成ForcedWin。详见
[Possible-projectile AttackSetup记录](implementation/possible-projectile-attack-setup-shadow.md)。

# Residual attack AND/OR proof：单存活响应不能放宽（2026-08-03）

已把“PAC只剩一个敌方存活动作”实现为诊断专用残余证明，而不是新的攻击加分：PAC已经
证明必死的列直接复用，剩余列继续执行严格 AND/OR ForcedWin；任何未知关系、预算中断或
不完整支持都不能获得动作所有权。第二套固定数组证明器只在显式诊断开关下构造，production
默认内存和动作不变。

高预算 `depth=4 / nodes=4096` 的固定64场景 Shadow 结果：Discovery只有1个残余根，结果
`DISPROVEN`；Holdout有8个残余根，结果为1个`PROVEN`、7个`DISPROVEN`。唯一PROVEN发生在
`mat_2Ic9Ny0Qnn5HH34nX`第125帧，但InformationState支持不完整，而且原来的TURN_LEFT已经
赢得该局。因此完整信息支持下的PROVEN数量为0，所有动作、W/L/D、星、击毁均与baseline
一致，root restore failure和全部硬不变量为0。

结论：不能把“只剩一个响应”当成可开火证书，也不能继续放宽Risk。残余AND/OR实现和UT保留
为可复用证明工具，但ACTIVE接管被拒绝；下一攻击方向必须产生独立的verified attack setup
证据。机器可读记录见
`config/engine-v2/native-residual-attack-proof-evidence.json`。

# NO_ACCEPTABLE / Observation所有权：主因已定位，全局开关拒绝（2026-08-11）

96场景Tactical Holdout的19,953次决策中有1,922个`NO_ACCEPTABLE`根。1,707个属于
`UNKNOWN_UNAVOIDABLE`，其中1,644个仅来自ObservationSafety对不完整支持的覆盖；
1,700个同时存在possible projectile。实现只审计`PROVEN_SAFE`行，并把无法获得严格
WINDOW_SAFE证书的行改成`unknownMass=10000`，而`POSSIBLE_DEATH`行跳过审计，形成不对称
动作集合。

直接绕过该覆盖会把固定16场景从4/27/1降至2/29/1；再加projected-pose仅恢复到3/28/1。
全局重启Information evidence search虽把depth0帧从3,019降至1,760，但只得到2/28/2，
本地V2总计算时间由1.77秒增至3.25秒。因此三个全局方案都不进入production，实验性pose
代码已完整移除，production root与Risk指纹恢复为实验前值。

新增第一动作分歧语料工具。两个聚焦退化场景的4个换位根全部属于“Observation支持不完整
+ depth0”；3个是`GO→TURN_LEFT`，其中2个把V2胜局变成V1胜局。下一步只研究固定内存的
`ActionContinuationEnvelope`：在这类窄根上对Risk/Pareto候选计算2–4帧延续区间，完整严格
支配才允许提案，不完整结果不得取得全局动作所有权。

详见[NO_ACCEPTABLE与Observation所有权记录](implementation/no-acceptable-observation-ownership.md)。
# Common-policy Option interval：动作所有权拒绝（2026-08-12）

新盲Discovery从未进入旧V3/VC0集合的347个场景中冻结32个，另64个Holdout保持封存。目标条件
Physical Shadow在6,974个根中完成121次并出现42次名义换动作，其中32次是Risk Pareto冲突；
搜索后单独补future-FIRE风险仍不能闭合目标、观察和风险量词。

双世界共同策略核显式枚举possible projectile存在/不存在、完整敌方动作和ChanceOutcome，并在
同一平台观察组强制共用续行动作。它得到248个完整interval和114个有限时域分离。错误地把其中
103个当终局value证书会使得分16.41%降到12.50%、我方crash 19增至28、FIRE 327降至290。
这证明heuristic horizon interval不是游戏终局lower/upper。

最终实现已fail-closed：114个信号只作排序证据，terminal ownership与proposal均为0，64局动作和
结果相对CURRENT零差异；Hard、Risk domination、restore和timeout均为0。该核额外计算334,842
节点，本地总耗时约2.28倍，只保留为离线/极稀疏工具，不进入production。下一步转向战略目标
生成和verified attack proposal，不再放宽Risk。详见
[共同策略Option interval记录](implementation/common-policy-option-interval.md)。

# 攻击姿态所有权拒绝：下一层必须是长期Option（2026-08-14）

固定32场景的FIRE漏斗表明5,926个候选中Hard只拒绝70个，最大缺口是3,593个没有明确攻击
purpose。EO-safe verified attack产生4次覆盖、零负转换，但W/L/D不变，达不到行为门。

修正完整缓存键后的attack-pose反向场仍把得分从16.41%降到12.50%；全部32场景的68个精确
反事实根得到7改善、15退化、46不变。1/4/8帧没有任何星数或死亡差异，到16帧仅10根可见，
终局却有22根改变，证明局部射线/距离/短Minimax无法取得战略所有权。

全关炸弹和poison虽然让FIRE增加32次，却把得分降到3.13%，并让自撞增加5；333个实际资源
选择中267个已有typed目的。因此不能通过压制资源换开火，也不能让攻击姿态直接接管。下一步只做
事件驱动的`ATTACK / RESOURCE / STAR_CONTROL / TERMINAL`长期Option POC；Minimax保留为
Option内部战术响应服务。详见
[攻击与战略所有权因果研究](implementation/attack-strategy-ownership-causal-study.md)。

# Native Minimax语义隔离：目标从cell升级为攻击姿态（2026-08-18）

Discovery64两个半区已完成原生V2 POC。当前最稳定组合为叶战术值、接触攻击代表、资源动作资格和
Markov历史：128局30胜8平90负，分析得分26.56%；当前V2为12胜5平111负、11.33%。击毁由11增至23，
`LOSS→WIN=23`、`WIN→LOSS=5`。生产源码仍未修改。

后半32场的响应FIRE硬门27.34%，严格maximin绕过26.56%，整数攻击竞速叶18.75%，只对我方使用
攻击代表23.44%，固定80/20最坏/名义备份28.13%且改善/退化均为9。带完整context epoch的持续意图
为26.56%；缺epoch版本20.31%作为陈旧Plan负对照。以上均未超过稳定基线，不进入production。

V1战术stage oracle在同一后半区达到47.66%。64局中63局首次根动作不同，主要为`GO→TURN=19`、
`GO→FIRE=10`、`FIRE→TURN=9`、`FIRE→GO=10`；同一种变更同时存在改善和退化，排除了固定动作
bonus、FIRE阈值或TURN demote。真实结构缺口是搜索目标仍是单一星/敌方cell，不能表达多帧攻击姿态。

下一步固定为AttackPoseOption：`cell + direction + fireDeadline + responseCoverage + ownEscape`，以稳定
generation和lower/upper interval进入已有minimax。Primitive GO/TURN/FIRE只是该Option的执行步骤；
在该表示完成前，不再扫描备份权重、叶评分常量或开火阈值。Holdout、官方simulate与发布均未执行。

# 四帧Option不完整根：唯一原因已闭合为GO/GO规则变体（2026-08-17）

新增固定数组失败账本后，固定32场景的24次失败和开放96 Discovery的67次失败均被精确定位为
`APPLY_UNSUPPORTED_RULE → MOVE_CONTEST → GO/GO`；对应7个与25个不完整根。不存在Hard incomplete、
容量、执行错误或root restore失败，Shadow对动作和整局结果保持零差异。旧统计中的
`NONE/FIRE/BOMB`只是敌方首动作；真正失败发生在第2–4步的状态条件续行。

这不是Minimax深度或预算问题，也不能通过忽略失败列解决。官方事实只证明静态占位GO被阻挡，
GO/GO的同目标、swap和腾空语义仍未校准。下一步限定为诊断三变体包络：
`SEQUENTIAL_BLOCK / INTENT_BLOCK / COLLISION_CRASH`，相同我方策略在三种物理世界逐维取最坏；只有
变体不变的结果才可恢复响应证据。production默认、Risk、Hard、Holdout与平台均未修改。

# Possible-projectile响应闭包：覆盖通过，动作收益中性（2026-08-17）

单个完整敌方possible projectile现在按两个世界计算：缺弹世界先生成四帧我方序列，存在弹丸世界
原样重放该序列；敌方仍可按物理世界响应。毒状态的行动奇偶只在可撤销存在世界中重建。两个世界
逐维取最坏值，多弹、节拍、注入或恢复不完整一律保持UNKNOWN，因此没有把隐藏信息泄漏成虚假优势。

固定32场景的19个possible根中，12个单弹、成功闭合10个，response incomplete由24降到14；
ACTIVE与原攻击owner均为10/51/3、17.97%，动作、FIRE、星和crash零差异。开放96场景的35个单弹
闭合32个，response incomplete由65降到33，完整攻击提案7增至13；19个风险维度被存在世界保守
下调。Shadow整局动作零差异，restore/Hard/Risk/timeout/热分配均为0。

结论：该实现作为Information响应支持层保留，但默认关闭且不读取Holdout；它解决了事实覆盖，却不是
攻击不足的主要动作根因。8个多弹根继续UNKNOWN。下一步先分类剩余22个普通rollout incomplete，
不做多弹贪心合并，也不继续放宽Combat门。

后续行为中性Option审计确认了结构缺口：5,056个无外部事件帧中仍有1,107次Option类别切换，
而当前Plan signature在6,910个跨帧边界中变化6,891次。FIRE、BOMB和aim-setup把frame写入
signature，普通导航又绑定第一动作/落点，因此现有PersistentPlan事实上不能保持同一长期攻击目标。

Risk前沿有攻击的4,096个根中只有574个目的完整；当前放弃其中219个，191个让给星目标。为验证
这是否就是主因，最窄Active POC只让完整、自逃、Risk前沿的FIRE覆盖STAR。前16场景表面提升
3.13pp，但完整32场景由16.41%跌至8.59%：FIRE净增95，敌方击毁反而由8降至5，并产生
7个`WIN→LOSS`。因此“单动作合格攻击优先”也已拒绝；下一步必须先建立稳定target generation，
再比较完整攻击Option和竞争Option的多帧lower/upper interval，不能继续调局部分数或FIRE阈值。

# 严格攻击策略与响应集：量词路线拒绝（2026-08-17）

行为中性的2–4帧 `AttackPolicyReachability` 已在原c992固定32场景验证99个事件根、224个
Risk前沿移动：每个候选在深度2/3/4均被完整反证，`PROVEN=0 / DISPROVEN=224 / UNKNOWN=0`。
总节点61,974、单候选最大373，无budget stop、restore失败或热分配。独立已知c96a固定32又得到
`0/170/0`，因此不是抽样或预算偶然。

一次错误目标定义曾得到39个proof，但全部来自“任意移动后再放全局poison/stun”，与根移动无因果
关系；已改为debuff只能由根技能动作闭合，并保留为负UT。因果定义下虽观察到10/22个局部分支击毁
叶，却没有任何全称策略。

逐敌方首动作的严格响应集POC又验证1,448列：仅2列可淘汰且都属于当前动作；149个替代移动的
coverage全为0，相对当前动作为0严格超集、129相等、4严格子集。该离线诊断使用394,149节点，
本地V2耗时约增至1.998倍，不适合production。

结论：普通ATTACK不能继续按ForcedWin量词定义。下一层改为Risk可调的多维CombatVector，分别保留
deadline、敌方安全后继压缩、行动空间、自身反击暴露、自逃和资源占用；Hard/EO/ForcedWin/严格
响应淘汰仍是高层稀疏证书，soft战斗价值只在Risk可接受集内做epsilon-contamination robust backup。
Production root与Risk默认语义、Holdout和平台状态均未修改。详见
[攻击与战略所有权因果研究](implementation/attack-strategy-ownership-causal-study.md)。

# AttackPoseOption：找到方向性收益，尚未达到显著性门（2026-08-18）

诊断原生owner已把攻击目标从enemy cell升级为
`(firing cell, direction, deadline, response bitset, post-fire escape)`。只有位于最短攻击路线上的GO/TURN
才算进度；具体姿态每帧重算，Hard、Proof、committed EO仍优先。Discovery64由稳定Minimax的
30胜8平90负（26.56%）提高到38胜3平87负（30.86%），击毁23增至29；已用VC0 64场又从
24.22%提高到28.52%。合并128场景为42改善/29退化，提升4.30个百分点，但场景级精确随机化
单侧`p=0.0926517`，尚未通过0.05门。

该收益不是全局规律：对称stun下为15.63%，略低于稳定Minimax的16.41%。因此当前只能视为
poison/stun角色条件下的候选结构，不能接入production默认。

本轮同时拒绝四种看似合理的加强：持续绑定具体姿态降至25.00%；只允许全响应覆盖在VC0由
28.52%降至28.13%；用未覆盖列的一步Minimax值否决长期路线使Discovery64降至28.52%；从所有
敌方响应位置扩展姿态不改变胜负且击毁29降至27。进一步让Attack Option压过全部非终局Minimax
值，在相同前16场使31.25%降至28.13%，FIRE 269降至171。结论是Minimax和长期Option都不能获得
无条件所有权，覆盖数量/固定分差也不是正确控制变量。

新增的因果审计支持多cohort合并，并以一张地图的两次换位作为一个单位做精确配对随机化。下一步
固定为采集42个改善和29个退化的首分歧根，直接学习/证明攻击姿态质量维，而不是继续扫描阈值。
production源码和minified未改，Holdout未读取，未调用官方simulate、publish或challenge。

# AttackPose因果闭合：问题是策略身份，不是静态门（2026-08-18）

71个结果变化首分歧根已全部精确重放。首分歧上看似有效的“一次转向”特征在完整对局中失败；
只启用首个分歧动作以及固定1/2/4/8步干预，在Discovery和VC0都为净负。改善局需要整局反复根据
新状态重规划，退化局却常由第一次覆盖立即造成，因此不能再从首分歧标签生成静态准入条件。

“所有敌方响应五步内仍可到攻击姿态”的后继门只在Discovery前半提升32.81%→35.94%，后半未复现
（28.91%→28.13%），耗时约增加52%，已拒绝。把每层重算出的AttackPose动作加入所有Minimax
分支也已做最小POC：前16场胜负与旧route完全相同（9/2/21，31.25%，击毁同为9），但星差-23
变-25、碰撞16变17，总耗时1,749,983us增至3,346,251us，P95 3,102us增至6,238us，已拒绝。

根因现已收敛：当前Minimax按一种后续策略估值，根后AttackPose又按另一策略改动作，违反策略/
Bellman一致性；单纯扩动作集也没有保存策略身份。下一步必须把“baseline续行”和“每状态重规划的
AttackPose续行”作为两个根策略选项，用同一敌方量词分别计算lower/upper，只有攻击策略lower严格
高于基线upper才允许取得所有权。该实验先限PhysicalState、独立cache namespace、每节点继续执行
Hard/EO，不改production、不读Holdout、不跑平台。

# Policy-first归因：方向成立，简化Policy失败（2026-08-18）

已打开的Discovery后32场重新运行V1 `TACTICAL_SEARCH`策略先验，结果稳定复现27胜7平30负
（47.66%），CURRENT为7胜3平54负（13.28%）；我方碰撞27降至17，弹丸击毁6增至24。
新增行为中性归因表显示，2,823个通过Physical Hard的先验动作中，没有一个在最终所有权点拥有
完整可发布的V2 Minimax value；649个被Risk排除、374个被Pareto标为dominated，1,356个
`robustLower`低于当前动作，仅308个更高，且2,559个缺少单帧`purposeCompleteness`。这证明当前
系统用不完整局部值压制长期策略，是所有权错误，不是搜索深度不足。

同时拒绝了过度简化的原生先验：只用`determineIntent + 单步progress`直接拥有接触动作，前16场从
4胜1平27负降到0胜1平31负，328次覆盖中253次为GO，碰撞11增至29、击毁4降至0。结论不是“关掉
Minimax即可”，而是基准Policy本身必须足够强。下一步改为逐根复刻V1战术stage的完整合同——有界
同时maximin、动作资格、对手期望、intent迟滞、重复状态和叶语义——形成原生`BasePolicyKernel`；
先做到动作等价，再允许V2 Hard/EO/Proof和完整终局证据反证。不嵌入V1/V3，不改production默认。
# Native terminal-trade ownership audit：局部门禁与稀疏 depth-4 均被否定（2026-08-20）

当前稳定诊断配置在固定前16场景、32个候选对局中为`14/15/3`、48.44%；V2发射208次、
击毁20次，V1发射130次、击毁13次。结合固定前32场景的结果，V2已经具有更高的开火和击毁
能力，主要缺口不是FIRE不足，而是攻击计划与终局/长期Option结果没有共同所有权。

新增`NativeTerminalTradeAudit`，默认只在诊断开关下运行，production root未改动。第一层用双方
最早命中帧和星数检查当前直线进攻：1,173个战术根中有26个不利进攻，但17个没有不同的基础
动作，另外9个基础动作raw worst不更好，严格可替换数为0。第二层复用Minimax已经执行过的
root-cell Fast successor，得到41个后继交易差异；其中28个基础动作的不利响应集合是严格子集，
13个是交叉tradeoff。直接让这28个根接管后，结果从`14/15/3`降为`12/18/2`，得分48.44%降至
40.63%，击毁20降至13；转换为1个`LOSS→WIN`、3个`WIN→LOSS`、1个`DRAW→LOSS`，因此拒绝。

再对28个候选做稀疏paired depth-4 raw maximin，共增加26,144节点（相对正常194,339节点约
13.5%），最大单次1,071节点，28/28完成且restore failure为0。11个基础动作获得更高raw值，
但没有一个跨越`-30000` terminal/nonloss带，因此没有ACTIVE资格。这个结果与HP25一致：全局
depth-4不是近期方向，而一帧射线/到达门也不能代替共同后续策略。

同时尝试把Poison作为矩阵额外根。测试发现动作生成与动作所有权仍耦合：保留production Poison
时，它会在诊断仲裁前直接发出；删除后Minimax没有对应row。两次非中性运行分别发出80/77次
Poison并得到42.19%/37.50%，不能作为严格Poison证书的因果结果。下一步必须先实现不分走原动作
预算的合成资源根：基础控制器不可见，Minimax独立固定槽评估，完整支持且逐响应不退化后才由统一
仲裁器取得所有权。不得继续用局部Poison替换器或在相同数据上调阈值。

# BasePolicyKernel BP0：意图子系统已逐根等价（2026-08-25）

固定前16场景、双方换位、`stun`、oracle持有最终动作的64局诊断已完成。修复Shadow先提交
counterfactual造成的跨帧状态污染，并在每个root比较后以V1实际执行结果重基原生状态后，1,549个
可比较战术根的proposed intent、committed intent和intent/action mapping均达到1,549/1,549；
context epoch为1,544/1,549，仍有5个转换事件待闭合。完整原生战术动作只达到1,127/2,024，
即55.68%，说明剩余主差异在`tacticalActions`动作域资格和递归value，而不是意图启发式。

本阶段不改变production默认；Hard、Risk domination、root restore、timeout/error和热分配均为0。
diagnostics 482/482、V3 60/60、Minimax core 220/220通过。下一阶段先闭合5个context转换，
再逐根对齐root/deep动作域；在动作域等价前不调整搜索深度、评分阈值或战略权重。

# Synthetic Resource Root：结构闭合，但单根Poison所有权被否定（2026-08-22）

已实现域外固定槽`NativeSyntheticResourceRootPoc`：Poison不进入production的`ourActions/ourCount`，
不会被原Root、Risk、Plan或资源循环提前选择；bounded Minimax只在正常根已完成后，用相同敌方响应集
独立评估Poison。原动作预算不被合成根分走，状态恢复、Hard incomplete和逐响应cell值均单独审计。

精确`v1-action + v1-epoch + v1-exact`前16场景Shadow重新得到`14/15/3`、48.44%，FIRE 208、
Poison 0，与冻结基线一致；Hard/Risk/restore/timeout和热分配均为0。1,175次合成评估中895次完整，
得到158个“所有敌方响应不退化且至少一列严格改善”的证书。额外39,239节点相对原194,339节点
增加约20.2%，单根最大52节点。

同一配置ACTIVE只实际发出53次Poison，却降到`9/22/1`、29.69%；整局转换为1个
`LOSS→WIN`、7个`WIN→LOSS`、1个`DRAW→WIN`和1个`DRAW→LOSS`。FIRE由208降至174，候选
碰撞由15升至21，对手碰撞由20降至13。全部结构不变量仍为0，因此退化不是接线、Hard或restore
错误，而是证书语义错误：短深度primitive cellwise non-regression没有计入“施法占一帧、技能持续
期和后续策略身份”的完整机会成本。

结论：合成域外根作为因果测试基础设施保留，Poison ACTIVE拒绝。下一层只能把Poison建模为带
`purpose + effective deadline + baseline continuation + poisoned continuation`的ResourceOption，在同一
敌方量词下比较完整持续期lower/upper；在此以前不得再用Poison分数、距离阈值或局部矩阵证书取得
动作所有权。固定命令已固化为`tools/native-synthetic-poison-poc.sh`，新manifest开始保存完整argv。
## Poison ResourceOption：四帧证书仍不足以取得通用动作所有权（2026-08-22）

- 新增诊断层 `NativePoisonResourceOptionPoc`。Poison 仍不进入 production
  root action arrays；原 synthetic root 只作廉价 prefilter。
- baseline feedback policy 与 Poison feedback policy 使用同一敌方 root
  columns、同一递归动作生成、同一 backup 和同一 leaf，在 Poison 的四个相对
  effect frames 内成对求值。任何 budget leaf、Fast/Hard incomplete 或 root
  restore failure 都把 cell interval 恢复为 `[-32000, 32000]`，禁止动作所有权。
- 固定 first16 Shadow 保持原动作与结果：14W/15L/3D，48.44%。158 个短证书中：
  - 73 个四帧搜索不完整；
  - 36 个在共同敌方响应列上出现回归；
  - 49 个通过完整逐列非退化、worst 严格改善和 robust 严格改善；
  - 295,161 个附加 nodes，resource root restore failure = 0。
- 仅允许完整证书 ACTIVE 后：13W/18L/1D，42.19%。共执行19次 Poison：
  - 正向转换为 `LOSS→WIN=1`、`DRAW→WIN=2`；
  - 反向转换为 `WIN→LOSS=4`；
  - FIRE 208→187；候选 tank kills 保持20，但候选 crashes 15→20；
  - Hard、risk domination、root restore、timeout/error仍全部为0。
- 结论：相比单根 synthetic Poison 的29.69%，四帧 ResourceOption 把错误所有权
  大幅收紧，但仍未形成正收益。技能截止帧的 heuristic value没有覆盖一次行动的
  长尾机会成本，且模拟 feedback policy 与真实 controller continuation 之间仍有
  policy-identity gap。因此该 ACTIVE 模式判定为 `REJECTED`，不进入固定32或全量
  V1/V2对战，production hash保持不变。
- 下一候选不再是加深通用 Poison root。应把 Poison 绑定到可验证的攻击事件：明确
  attack purpose、首次受益帧、敌方被删除的关键响应、我方后续 FIRE/escape，以及
  事件结算后的 controller continuation；没有事件级收益证书时保持 `NO_PROPOSAL`。
# BasePolicy候选证书：正确但只覆盖终局（2026-08-26）

整根value-exact普查显示固定16的1,641个搜索根只有8个exact；96.59%的阻塞根同时包含预算叶和
深度叶，不能把`budget-complete`放宽成最终动作证书。随后改为候选级授权，并修复证明对象必须是
真实V3最终动作而非V2 production动作。

Discovery64、128个候选对局中，1,407次ForcedWin检查得到5个严格证明，19,825个搜索行得到2个
逐响应policy-exact支配。两种ACTIVE分别改变5局和2局，但全部发生在frame125–127且均为既有
`V2_WIN→V2_WIN`；W/L/D都保持69/53/6，击毁与死亡完全不变。两种owner默认关闭，保留为终局保险
和诊断服务。下一阶段不再扩大根动作证书，而把Minimax用于长期策略提案的响应包络与反驳。

# PolicyResponseEnvelope：有限标量失去所有权，事件根调度闭合（2026-08-26）

长期AttackPolicy与根动作完成Bellman一致后，固定16 ACTIVE仍由53.13%降至43.75%，逐局3改善、
6退化、候选碰撞13增至17，证明有限horizon标量dominance不能拥有根动作。加入攻击事件闭合后，
25个标量dominance仅3个真正覆盖全部敌方响应列的FIRE/救援事件；22个属于未完成走位或目标中止。
严格ACTIVE只剩同一场景换位的1改善/1退化，净得分0。

统一depth2→3使节点54,739→480,428（8.78倍），完整包络489→262、事件证书3→2，已拒绝。
复用主搜索baseline cells把附加节点压到187，但完整支持仅14/613且无事件证书，只能作为稀疏缓存快路。
最终浅层包络只在根动作即FIRE时运行：613次降到7次，606个GO/TURN长期Option延期，节点降至371，
减少99.32%并保留全部2个would-override。下一步是独立事件有界Long Option evaluator，而不是继续
加深primitive Minimax或恢复标量所有权。production root SHA仍为`43eb56…ffcf7`。

# BP26 Long Option事件前沿：事实层闭合，严格所有权为零（2026-08-26）

606个延期GO/TURN根已进入独立六帧事件前沿：我方每节点只执行一个AttackPose policy动作，敌方响应
展开，相同PhysicalState按hash与剩余帧合并。累计145,832节点、181,632次转移、22,334次合并；
root restore、热分配和TT容量失败均为0。过程中修复了TT index 0空槽与“表满”同为`-1`的真实缺陷，
并增加定向UT。

事件来源拆分后，只有1/606在全部响应下实际到达FIRE，且根动作与现有incumbent相同；5/606达到
终局WIN闭合。453个根含死亡响应、477个含中止、475个转入救援、470个仍未过事件边界、87个不完整。
因此BP26保留为Shadow事实层，不进行ACTIVE。下一步是在同一前沿上加入整数nominal响应质量和共同
baseline比较，而不是把严格AND证书当作普通战略选择，或重新加深primitive Minimax。

# BP27 长Option响应质量：发现36个逐根候选，拒绝全局接管（2026-08-26）

BP27在同一六帧Physical前沿内成对比较incumbent与AttackPose首动作，后续统一使用receding
AttackPose策略，并同时保存最坏事件mask与11维0–10000整数响应质量。固定16场景仍为16/14/2、
53.13%，动作完全不变，production root SHA仍为`43eb56…ffcf7`。

606个根中506个完整、100个不完整；295相等、36候选严格支配、32 incumbent严格支配、181权衡。
完整同动作比较零差异；2个同动作样本只在预算截断边界出现部分前沿漂移，已独立计数并禁止拥有动作。
候选总SUCCESS增加262,972、UNRESOLVED减少263,054，但FAILURE也增加13,285，证明平均质量改善不能
授权整个AttackPose结构接管。下一步只对36个完整、不同动作、逐根严格支配候选做固定16场景ACTIVE
因果POC；Hard、Risk、committed escape和不完整fail-closed语义保持不变。

# BP28 逐根响应质量ACTIVE：Discovery弱正向，等待独立验证（2026-08-26）

只启用完整、不同动作、候选逐维严格支配根后，固定16场景由BP27的16/14/2、53.13%变为
18/14/0、56.25%，净增3.12个百分点。44次覆盖全部为AttackPose的GO/TURN；转换为3个负转胜、
1个平转胜、2个胜转负和1个平转负，净收益仅1个等价胜场，暂不进入production。

ACTIVE同时暴露了宿主架构缺陷：V3/native owner位于V2 FinalActionGate之后，可把已验证FIRE覆盖成
Hard拒绝TURN。现在所有owner输出统一通过末端Hard closure；1,403次检查中1,398通过、1次恢复
production安全动作、4次属于无任何安全动作的全拒绝状态，真正fallback failure为0。最终timeout、
avoidable Hard、Risk支配选择和root restore全部为0。下一步冻结当前规则，在未调参的独立场景切片
验证；不允许读取结果后继续调dominance门槛。

# BP29 独立验证：响应质量动作所有权被否决（2026-08-26）

将host Final Hard closure与response-mass owner拆成正交开关后，在offset 16的独立32场景/64局上，
`GUARDED_SHADOW`为34/28/2、54.69%，ACTIVE为28/32/4、46.88%，下降7.81个百分点。按局
6正12负，按场景4正11负；两边timeout、avoidable Hard、Risk支配选择和root restore均为0。

ACTIVE多发26颗子弹，但少拿6颗星、我方碰撞/击毁计数多3，证明当前`SUCCESS=FIRE|WIN`把“发射”
误当成“攻击成功”。另一个根因是两侧首步之后都执行AttackPose，比较的是条件于AttackPose的局部优势，
不是相对真实incumbent continuation的策略优势。当前ACTIVE owner已拒绝，保留`GUARDED_SHADOW`事实层。
后续若继续，应分开FIRE与hit/kill/terminal nonloss，并以policy identity进入TT，比较两套完整policy，
不能继续调当前Pareto阈值或重复读取该独立切片。

# BP112–BP114 ObjectiveEpoch：目标状态成立，primitive owner被否决（2026-08-31）

固定16 Shadow中，目标epoch覆盖2,955/3,030个决策，现有严格Option执行域覆盖56.24%；一步生成
GO/TURN后覆盖升至75.33%，说明V2确实缺少稳定目标与跨callback执行桥。执行层保持零热分配，
production动作零变化。

ACTIVE先修复了真实所有权缺陷：支持完整的`DIRECT_KILL/ATTACK_SETUP`必须高于普通战略进度。
4个敏感场景中6次已验证攻击正确让行，原负转换消失。随后H4固定16得到+3.12pp，但H8为0且
出现1个负转换；未调参的下一组16场景H4又得到-3.12pp。两个H4切片合并后W/L/D完全相同，
候选星差恶化18。

独立切片所有改变终局的proposal都满足`strictMask=0`：它们只是Hard/Risk允许且一步几何进度更好，
并不属于支持完整的Option。全部硬不变量为0，故这是证书语义错误，不是安全接线或性能故障。
ObjectiveEpoch保留为target generation与效用条件，固定时长primitive owner默认关闭。下一步只量化
support-complete既有Option之间的战略仲裁；生成primitive继续作为搜索候选，在完整Option级证书前
不得执行。机器摘要见
`config/engine-v3/base-policy-kernel-bp112-bp114-objective-epoch-evidence.json`。

# BP115–BP116：局部Minimax足够快，POSITION目标身份错误（2026-08-31）

strict Option Shadow在3,030个决策中找到309个“当前离开持久目标”的根；70个当前动作属于已验证
攻击并正确让行，剩余239个都有支持完整的既有Option，但production搜索值239/239不可比较。

只在这些冲突根运行两Option、全敌方列、depth2、256节点的局部Minimax后，236次触发、232次完整，
总计18,115节点、平均77节点，restore和热分配为0。完整比较中230个目标Option严格更差、0相等、
仅2个更优；ATTACK为3/3更差，POSITION为227更差/2更优，STAR_CONTROL没有冲突。

因此主要问题不是Minimax过早fallback：稀疏调度已达到98.3%完整率。真正错误是把POSITION这种执行
姿态当成独立长期目标。下一步把epoch身份改为`semantic target signature + generation`；同一敌人下的
ATTACK/POSITION和同一颗星下的STAR/POSITION属于同一目标，POSITION只能作为executor alias。
本轮全为Shadow，动作和所有整局指标零变化。机器摘要见
`config/engine-v3/base-policy-kernel-bp115-bp116-option-arbitration-evidence.json`。

# BP117–BP118：语义目标身份修复有效，严格ACTIVE仍未资格化（2026-08-31）

ObjectiveEpoch现改用`semantic target signature + target generation`：同一敌人下的ATTACK_SETUP、
POSITION和FIRE属于同一ATTACK目标；同一颗星下的POSITION属于STAR_CONTROL执行alias。POSITION不再
创建独立epoch。StableOptionLedger也不再“地图有星就把POSITION猜成星目标”，而是读取完整行alias；
多target显式返回ambiguity，本轮歧义为0。

固定16场景中，epoch由189降到112，跨kind延续433次，strict执行支持由1,662增到2,025，gap由
1,293降到930。需要局部Minimax的冲突根由239降到4，节点由18,115降到243（−98.66%）；4个ATTACK
FIRE候选中3个被反驳、1个严格支配，root restore与热分配均为0。

只激活该唯一证书后，V2由`2胜/28负/2平`变为`2胜/27负/3平`，得分9.38%→10.94%（+1.56pp）。
唯一变化是`mat_I2Z8t6EspmMENRW5H` seat 1：第48帧`GO→FIRE`，CURRENT第83帧单方被击毁，ACTIVE
存活到128帧同星平局；负转换、FinalGate拒绝和全部硬不变量均为0。

方向成立但未达到动作owner的+3pp门，所以保持诊断默认关闭，不读Holdout、不扩大全局Minimax。
下一步改上游语义ATTACK target/Option生成，提高“有意义且可验证”的提案覆盖，再复用同一稀疏interval
证书；不能激活3个已被Minimax反驳的候选。证据见
`config/engine-v3/base-policy-kernel-bp117-bp118-semantic-objective-evidence.json`。

# BP119：攻击稀缺主因是执行Option没生成，不是Risk或Minimax（2026-08-31）

行为中性漏斗覆盖固定16场景3,030个根：2,585个没有Combat攻击证据，36个只有zone/belief软证据；
当前攻击生成条件完整的409根中408根进入Portfolio，Hard只过滤8根，Risk过滤114根、Pareto过滤32根，
最终254根有strict ATTACK。胜负、星、crash、FIRE和全部硬不变量零变化，production hash未改。

语义ATTACK epoch共活跃1,851帧，但只有134帧存在同目标strict执行，1,717帧是执行gap，覆盖率7.24%。
254个strict根又有215个只有FIRE，移动执行仅39根（GO/左转/右转各13行）。当前结构把ATTACK近似成
“已经能开火”，没有持续生成“接敌→占射位→开火”的执行Option。

首次普查把末尾`ACTION.NONE` Hard/Safety哨兵误算进策略域，产生63个伪Portfolio缺口；对齐Production
的`selectionCount`后只剩1个，并已用UT锁定。下一步只在ATTACK epoch执行gap生成route-proven
GO/TURN候选，再由完整两Option Minimax逐根验证；不会恢复旧AttackObjectiveField的几何直接owner，
也不放宽Risk。证据见
`config/engine-v3/base-policy-kernel-bp119-attack-option-coverage-evidence.json`。

# BP125：证书根可精确重放，标量动作所有权再次被否决（2026-08-31）

BP123的64个共同续写严格优势现在全部由固定TypedArray slab保存；证书数、根数均为64，溢出为0。
每个根的incumbent/candidate均从第0帧精确重放，双状态哈希命中128/128，incumbent终局复现64/64。

历史EnemyPolicy与历史出星下，candidate击毁数由0增到2，但非败局由7降到6，累计星差由-114降到
-116；转换包含1个败转胜、1个平转胜和2个平转败。有限时域scalar因此只能作为候选证据，不能拥有
primitive。production动作与root SHA 0a8f09…c23e保持不变。

下一步BP126在同一64根上先独立展开ChanceOutcome；替代EnemyPolicy使用单独的reset-history证据。
两个量词不会再混入一个ScenarioGroup，资格判断保留nonloss/kill/death/star多维区间。
机器摘要见
config/engine-v3/base-policy-kernel-bp125-certificate-root-corpus-evidence.json。

# BP126：独立Chance holdout通过0/6（2026-08-31）

BP125的64个精确根扩展为HISTORICAL加R0–R6共1,024个exact-controller-history cell。Discovery
使用HISTORICAL+R0–R2，筛出6个同时满足paired no-regression与完整多维区间支配的候选；这6个在
历史出星中全部仍是败局，没有历史终局正转换。

未参与选择的R3–R6上，6个候选通过0个：出现2次新增死亡与9次可比星差退化。虽然其中3个在聚合
full-vector interval上仍占优，但具体Chance世界线发生好坏交换，证明worst/sum聚合仍不足以替代
逐Chance不退化合同。全量cell为24个正终局、22个负终局、466个相同，7个根同时含正负世界线。

当前标量证书族被整体否决，不继续运行EnemyPolicy矩阵，也不运行ACTIVE。下一步把搜索输出改为基于
当前可观察状态的Objective进度区间；Chance终局只作为离线反证，不再直接监督primitive。
机器摘要见
config/engine-v3/base-policy-kernel-bp126-chance-interval-evidence.json。

# BP127：Objective进度Pareto仍不能拥有动作（2026-08-31）

在BP125的64个标量证书根上增加六维可观察攻击目标向量：progress、deadline、muzzle coverage、
response viability、escape branches和counter exposure。维度保持分离、只做Pareto，不读终局或未来星。

64根全部完整，59根candidate dominance、5根incomparable，热分配和root restore失败均为0；Shadow
对整局行为影响为0。与BP126的8条Chance逐根离线连接后，59个支配根包含22次胜负改善和16次胜负
退化；只有1根在全部8条Chance上无退化，但严格无退化和最终资格均为0。

因此保留该向量作解释证据，拒绝其取得动作所有权。它与AttackPose候选生成共享同一目标，59/64的高
通过率主要是相关证据重复，不是独立确认。下一步BP128不再雕刻这64个正证书，而是捕获211个完整
paired comparison（更好/相等/更差）并构造精确历史混淆矩阵，直接检查Minimax leaf/backup是否同时
存在假阳性和假阴性。

证据：
config/engine-v3/base-policy-kernel-bp127-objective-progress-evidence.json。

# BP128：完整比较证明正scalar没有终局方向性（2026-08-31）

固定16场景捕获全部211个支持完整的paired comparison：64个candidate higher、109个equal、38个
candidate lower。修复跨帧旧hash和replay技能默认值后，422条分支全部命中精确物理根，211个
incumbent全部复现源终局。

正scalar的64根仅2个改善、2个退化、60个胜负不变；terminal Pareto也是候选支配13、原动作支配11。
累计非败局−1、击毁+2、星差−2，value margin无法区分真实收益和退化。lower关系有1改善/5退化，
只能保留为诊断veto信号，不能写入Hard。Objective非progress维度的事后子集仍含terminal tradeoff，
不升级为证书。

因此继续拒绝有限深度scalar直接拥有primitive，不调margin阈值。下一步BP129按预注册depth/node-budget
梯度测同根判决稳定性，区分horizon/leaf不稳定与稳定的评价目标错位。证据见
`config/engine-v3/base-policy-kernel-bp128-comparison-confusion-evidence.json`。

# BP129：加预算零改判，加深暴露语义不闭合（2026-08-31）

BP128的211组固定incumbent/candidate现已通过四条cache隔离lane重算。depth2从256节点扩大到2048
节点后，64 higher、109 equal、38 lower的关系211/211完全不变，合计工作量只由20,907增至21,311。
所以当前根族的误判不能靠增加同深度预算解决。

depth1到depth2有41/211个关系改变；depth2到depth3只有30个根完整，其中8个再次改变关系。剩余
181个depth3根虽然不完整，却没有一个命中节点预算，单根最多只执行470个合计节点；唯一命中预算的
根反而已经完整。depth3完整的18个正scalar在历史终局中是0改善、1退化、17不变。

因此拒绝直接提高production depth或预算，production动作和SHA
`0a8f09c3bf54e7ecd708346b08ff1133a716aa62634484b10e549968a0cbc23e`保持不变。下一步BP130分类
181个支持出口，并用event/deadline quiescence和显式叶区间闭合搜索语义，而不是让更深搜索继续返回
不完整或方向不稳定的点值。证据见
`config/engine-v3/base-policy-kernel-bp129-depth-stability-evidence.json`。

# BP130：181个depth3不完整根全部由代表宽度早停（2026-08-31）

在BP129相同211组pair上加入内建abort reason遥测后，181个depth3不完整根已全部分类：176个先在
incumbent分支失败，5个incumbent完整后在candidate分支失败；181/181都是
`NONEXACT_ABORT_REASON.WIDTH`。其中incumbent多出1个representative为123根、多出2个为53根，
candidate多出1个为5根。

budget interrupt、Fast/Hard不完整、root restore和未分类全部为0。不完整根合计11,244节点，单根最大
470。当前搜索在已有exact depth2 owner时，depth3 width=2一旦截断就fail-closed早停；这是具体的
性能/完整度边界，而不是节点预算耗尽。

因此BP129的“不要盲目加预算”保持成立，但下一步从宽泛的leaf/closure调查收敛为BP131代表宽度
W2/W3/W4标定。production动作与SHA保持不变。证据见
`config/engine-v3/base-policy-kernel-bp130-depth3-support-evidence.json`。

# BP131：W3恢复145个完整根，但正scalar仍无方向（2026-08-31）

固定211组pair的depth3宽度标定完成。W2仅30根完整；W3恢复到175根完整，节点从24,472增至
91,945（3.7571倍）。W4仍为175根，节点增至93,103；W4预算从2048翻倍到4096后只多15个节点，
状态与关系仍211/211完全相同。当前代表生成器的饱和宽度是3，剩余36根不是宽度或预算问题。

更高完整率没有带来更好的游戏方向。W3的55个candidate higher是1个历史改善、1个历史退化、53个
胜负不变；28个candidate lower是0改善、4退化、24不变。W3适合作为评价语义调试的完整证据层，
不适合作为production owner；W4和加预算均拒绝。

这一步正式把“让Minimax执行更多/更深”与“修正Minimax提高胜率”拆成两条独立工作线。下一步BP132
分类剩余36个transition/interval出口；评价器方向使用175个完整W3根，不再调scalar margin。
production动作和SHA保持不变。证据见
`config/engine-v3/base-policy-kernel-bp131-depth3-width-evidence.json`。

# BP132：剩余36根不是Minimax规模问题，而是物理支持边界（2026-08-31）

在已排除宽度与预算的D3/W4/B4096 lane上，36个不完整pair已全部归因且未分类为0。35根都在ply2
执行`GO/GO`时返回`UNSUPPORTED_RULE / JOINT_TANK_RELOCATION /
OCCUPIED_AFTER_EARLIER_MOVE`；其中baseline分支21根、candidate分支14根。Fast容量、执行错误、Hard
内部Fast失败、预算中断、root restore均为0。

最后1根是baseline的`GO/FIRE`：Fast成功，但敌弹到达土堆后`narrowProofComplete=0`，Hard的
ReverseViability返回`-1`。hazard自身完整、horizon为2，且没有shield/boost/teleport特殊逃生；这应
继续保持保守UNKNOWN，不能伪装成死亡或安全。

因此不再通过提高Minimax depth、width或预算处理这36根，也不把unsupported分支固定写成负分。
下一步BP133直接用模拟平台构造联合移动oracle，确认`GO/GO`顺序、同目标、跟随、占位和swap语义，
再决定是否扩展FastKernel。production动作和SHA
`0a8f09c3bf54e7ecd708346b08ff1133a716aa62634484b10e549968a0cbc23e`保持不变。证据见
`config/engine-v3/base-policy-kernel-bp132-depth3-transition-support-evidence.json`。

# BP133：35个联合移动缺口已按证据等级拆分（2026-08-31）

BP132的35个`GO/GO`物理缺口现已精确拆分：26个是普通双方争同一目标格，9个是stun影响导致仅
一方能进入严格预备目标集合；后者7次影响seat0、2次影响seat1。35根全部在ply 2，没有direct swap，
也没有已经由官方replay闭合的vacated-follow。历史胜负仍双向：同目标根有2个原动作更好、1个候选
更好；stun根有1个候选更好，不能用固定正负值补洞。

证据所有权现分开保存：官方定向probe确认22次静止占位阻挡；动态官方历史确认31次同record跟随
已离开起点，且seat0/seat1分别有17/14次；同目标、swap和stun竞争仍无官方判定样本。固定模拟器
采用seat0后seat1的顺序占位语义，但这只是一个有限规则世界，而且不能整体解释官方的双座位follow
证据，因此不移植到production。

本步行为中性、root restore失败0、热分配0，production SHA仍为
`0a8f09c3bf54e7ecd708346b08ff1133a716aa62634484b10e549968a0cbc23e`。下一步BP134只比较显式
规则变体的共同区间；规则世界发生分歧时保持UNKNOWN。证据见
`config/engine-v3/base-policy-kernel-bp133-joint-movement-oracle-evidence.json`。

# BP134：三规则世界完整，标量方向仍与历史反向（2026-08-31）

BP133的35个联合移动缺口已在顺序阻挡、意图阻挡、碰撞同归三个完全隔离的有限规则世界中重算。
三个世界各真正执行182次移动竞争；35根全部完整，逐根value和关系完全一致，restore失败、热分配和
行为变化均为0。共同关系为candidate higher 17、equal 9、candidate lower 9。

这排除了“规则分歧、搜索规模或空接线”作为剩余主因，却给评价语义提供了强反证：17个higher根在
历史中改善0、退化2；两个历史改善全部落在lower的9根中。三世界envelope因此只接受为完整性诊断，
拒绝成为动作owner；production继续fail-closed，SHA保持
`0a8f09c3bf54e7ecd708346b08ff1133a716aa62634484b10e549968a0cbc23e`。

下一步BP135在同一35根上分解leaf/backup分量，查明scalar为什么系统性抬高退化、压低改善；不再修改
物理规则、搜索规模或production所有权。证据见
`config/engine-v3/base-policy-kernel-bp134-depth3-move-variant-evidence.json`。

# BP135：Leaf/backup归因排除星权重，定位响应量词错位（2026-08-31）

BP134的35根已通过8条leaf因果lane和三个物理世界重算；全部lane均35/35完整且跨世界一致，FULL与
BP134逐值零差异。NO_STAR仍是17 higher、9 equal、9 lower，零改判；本批错误不是抢星分量造成。
NO_ATTACK让两次历史退化都从higher降为equal，说明攻击几何参与了假阳性，但它不能恢复两次真实改善，
不能全局删除或只调权重。

根矩阵揭示更深的组合问题：两个真实改善都是混合enemy response，maximin判lower而均值判higher；
两个历史退化在maximin和均值下都判higher。简单均值和独立行maximin都不足以拥有动作。下一步BP136
把incumbent/candidate放入同一个`2×N` simultaneous StageMatrix，比较逐列支配、混合均衡和风险污染
共同policy backup；仍不改变production所有权。证据见
`config/engine-v3/base-policy-kernel-bp135-leaf-backup-evidence.json`。

# BP136：共同StageMatrix仍然偏爱真实退化动作（2026-09-01）

BP135的35根已放入共享敌方列的`2×N` simultaneous StageMatrix；原始和风险污染矩阵全部完成，三个
移动规则世界逐根一致，restore失败、热分配和行为变化均为0。两个超出StageMatrix值域的根使用全矩阵
共享正仿射scale，6个世界实例发生scale、归一化碰撞0，未做静默截断。

共同矩阵没有修复方向：两个历史改善都是tradeoff，原始候选概率28.70%和20.43%；两个历史退化同样
是tradeoff，却都得到100%候选支持。风险污染后改善为29.04%/55.48%，退化仍为99.88%/100%。因此
StageMatrix support、混合概率和ε-contamination均不能成为动作证书；问题仍是ATTACK叶证据与敌方响应
模型的组合错位，而不是矩阵没有共享列。

production SHA保持
`0a8f09c3bf54e7ecd708346b08ff1133a716aa62634484b10e549968a0cbc23e`。下一步BP137拆分可验证攻击进展与
ATTACK scalar，并用根观察条件化敌方policy；继续Shadow，不调risk/scalar/solver。证据见
`config/engine-v3/base-policy-kernel-bp136-response-matrix-evidence.json`。

# BP140-Q0：35个历史方向根全部是Chance混合标签（2026-09-01）

BP133/BP139的35个方向根已用BP128原始compact action prefix精确重建，并分别运行历史Chance与
RANDOM0–RANDOM6。560/560个cell均命中相同物理root、强制相同首动作且exact controller history完整。
双向资格要求Discovery和独立Holdout都满足逐Chance无退化与多维区间严格支配；结果candidate稳健根0、
incumbent稳健根0、MIXED 35、INCOMPLETE 0。

历史31个相等、2个candidate改善、2个incumbent改善全部落入MIXED。candidate仅Discovery通过1根、
仅Holdout通过6根，交集0；incumbent对应为1、2、交集0。这说明历史四个方向样本是单次stun/星随机
世界的实现结果，不能作为BP140评价器的训练真值。下一步不再拟合四个历史标签，而是在严格FIRE证明
与全局终局之间建立有限事件窗口的refusal-aware字典序regret interval。production行为和SHA保持不变。
证据见`config/engine-v3/base-policy-kernel-bp140q0-chance-qualified-label-evidence.json`。

# BP140-Q1：拒绝价值搜索闭合，但单一策略无正向证书（2026-09-01）

35个exact方向根已使用有限horizon字典序向量重算。向量保留terminal、committed安全、已结算攻击、
反击安全、射线/机动/接触、星与资源维度，固定mixed-radix仅用于精确字典序比较，不恢复ATTACK加权
分数。enemy action、ChanceOutcome和三个移动规则世界保持完整，我方深层为BP139的单一确定性重规划
策略。

首版715,852节点且24根不完整。绝对死亡下界短路把节点降至464,618、不完整降至8；固定容量语义TT
产生10,594次命中，最终降至333,717节点，35/35根和105/105规则实例全部完整，单搜索最大3,265，
restore失败与热分配均为0。相对首版节点减少53.38%，没有提高预算或缩减对手/Chance域。

最终25根相等、8根tradeoff、2根严格支持原动作、候选严格证书0。Q1保留为负向verifier和高性能向量
搜索内核，不取得正向动作所有权。下一步用少量持久命名策略组成portfolio，逐策略求完整区间后在根上
选择；不恢复每层primitive展开。production行为和SHA保持不变。证据见
`config/engine-v3/base-policy-kernel-bp140q1-refusal-interval-evidence.json`。

# BP141：持久策略组合没有扩展最坏值前沿（2026-09-01）

Q1已扩展为三个命名策略的独立完整求值，策略身份在整个horizon内固定，根上按跨规则世界最坏值选择。
35/35根和105/105规则实例完整，restore失败与热分配均为0。最初发现counter-safe判断位于射线开火
之后，导致互相瞄准时规避分支不可达；新增UT并调整顺序后，活动计数确认侧翼实际执行15,644次、
拒绝对枪实际执行350次。

尽管分支真实执行，incumbent和candidate在35/35根都仍选择`DIRECT_PURSUIT`。侧翼相对direct从未
提高最坏值，并分别使4根和8根更差；counter-safe全部与direct最坏值相等。最终仍是25相等、8 tradeoff、
2个严格保护原动作、0个候选证书。总节点844,150，是Q1的252.95%，不应为不变的根选择支付该成本。

因此保留逐策略完整区间与根选择机制，拒绝两个新增策略取得动作所有权，也不再盲加手写策略。下一步
执行有界单次偏离的policy improvement：在一个可达状态尝试受支持动作后恢复direct，以近似线性规模
寻找真正的响应条件和动作witness。production行为和SHA保持不变。证据见
`config/engine-v3/base-policy-kernel-bp141-refusal-policy-portfolio-evidence.json`。

# BP142：一次响应偏离恢复局部价值，但仍没有攻击证书（2026-09-01）

direct策略现允许在每条已观察世界线最多偏离一次，偏离资格进入TT身份；选择baseline可继续保留资格，
选择其他动作后剩余horizon恢复direct。敌方、Chance和三规则世界仍完整。4096–16384节点均不完整；
32768暴露2048槽TT容量瓶颈，固定扩大到8192槽后容量失败归零。

精确maximin行剪枝把相同四根节点从800,615降至327,304，减少59.11%，所有值和偏离选择不变。
最终35/35根、105/105实例完整，得到13相等、9 tradeoff、5个严格保护原动作和8个严格支持候选，
而Q1候选证书为0。预算、TT容量、Fast、Hard、动作生成、restore和热分配失败均为0。

但8个候选首动作全部是`TURN_RIGHT`，历史结果全部相等且仍为V1胜。决定维度是反击安全2、机动压缩2、
接触距离3、资源1；terminal、committed safety、已结算攻击和射线控制均没有优势。因此这证明响应条件化
policy有价值，却没有证明更多开火或击毁。只覆盖第一步会丢失证书依赖的continuation，不做伪ACTIVE。

下一步BP143在8根上运行单次偏离的安全攻击事件证明，并要求导出可执行continuation policy后才能进入
ACTIVE POC。production行为和SHA保持不变。证据见
`config/engine-v3/base-policy-kernel-bp142-one-deviation-evidence.json`。

# BP143：现有位置candidate无法形成安全攻击事件（2026-09-01）

BP142的8个局部证书已改用严格攻击事件AND/OR证明。每条世界线最多一次偏离，敌方、Chance和三规则
世界完整；时域无事件保持UNKNOWN，正证明必须导出无跨规则动作冲突的语义continuation policy。

depth4和引擎上限depth6下，8根的安全威胁与目标必死证明均为0。candidate搜索观察到105次FIRE，
但威胁和必杀为0。进一步扫描全部35根仍是两个目标各35个`NEITHER_PROVEN`；candidate共执行366次
FIRE但威胁为0。incumbent部分分支出现48次威胁和36次必杀，但未覆盖全部敌方响应。

420个搜索仅40,644节点，单搜索最大516，预算、TT、支持、restore和热分配失败均为0。结论不是搜索
太浅或太慢，而是这35个由联合移动/位置scalar产生的候选本来就不是攻击机会。全部拒绝接入owner。

下一步BP144从真实对战抽取V1开火/命中/击毁、V2接触未开火与paired首次分歧，建立新的攻击机会根，
再让事件证明直接生成根动作。production行为和SHA保持不变。证据见
`config/engine-v3/base-policy-kernel-bp143-one-deviation-attack-event-evidence.json`。
# BP152–BP155：Minimax参与率与支持恢复否决全局所有权（2026-09-02）

Discovery64的8,322个接触根中，默认exact Physical搜索只覆盖约3.6%，但关闭后少1胜，证明它稀疏而
净正。全接触Information搜索完成1,182个根却全部是incomplete evidence，计算增加60.8%、得分下降
1.57pp；无消费者搜索也会推进runtime fallback，不能称为行为中性Shadow。

接触普查发现8,010个inexact根中6,487个可由完整possible-projectile pool严格恢复为PhysicalState。
然而宽恢复在固定16将得分9.38%降至6.25%；safe-FIRE门在固定16弱正，扩到Discovery64后变成
8.20%→6.64%，并出现2个`WIN→LOSS`。逐敌方响应FIRE支配verifier检查231根、提案0，且纯搜索work
仍改变7局动作流。

因此保持全部新开关默认关闭。根架构下一步转为native BasePolicyKernel长期incumbent，Minimax只对
明确challenger提供有消费者的terminal/strict event/policy interval反驳。证据见
`config/engine-v3/base-policy-kernel-bp154-bp155-support-restoration-evidence.json`，详细说明见
`docs/implementation/base-policy-kernel-bp152-bp155-minimax-participation.md`。

# BP156–BP158：高收益BP68开始按可达闭包迁入production薄层（2026-09-02）

BP68已冻结为长期BasePolicy incumbent的迁移基线。动作owner、资源/FIRE domain和战略Intent现分别位于
`engine-v2/src/base-policy/`，通过注入接口组合；production root尚未接线，默认行为和SHA
`73e08f1471a450967e26e931c639c88bf88d986870cb5b07a72e456ec2a8b551`不变。

owner在4096个root零差异，domain在2048个FastState零差异；Intent在4096个连续root上逐项比较
context epoch、精确分类、动作映射、成员、bonus与提交连续性，差异0。三片逐项替换后的固定16候选
动作指纹始终为`33c5b8ebf82d6eee72123ed70f6f3538641083624544ca5c6322b3c50d11b925`，结果保持
22胜/10负/0平、68.75%。Minimax core 234/234通过，Hard、restore、timeout/error和joint-dominated
均为0。

Intent薄类不包含oracle矩阵、simple/frontier备选算法或直接攻击捷径；19,013源码字节、10,524独立
压缩字节。下一步BP159仅迁移bounded policy search的BP68可达配置闭包，不复制18.8万字节诊断容器。
证据见`config/engine-v3/base-policy-kernel-bp156-owner-migration-evidence.json`、
`base-policy-kernel-bp157-domain-migration-evidence.json`与
`base-policy-kernel-bp158-intent-migration-evidence.json`。
