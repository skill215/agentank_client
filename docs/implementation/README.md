# Implementation stage overviews

Each IMP stage writes one immutable overview here with input hashes, commands, test denominators, benchmark evidence, deviations, unresolved issues, and the next-stage decision.

后续优化项目统一使用 `npm run experiment -- …`，见 [实验执行流程](experiment-execution-bp408.md)。历史百轮脚本保留用于复现，不能作为新项目的默认入口。

研究方向、候选准入及跨项目停止/重开条件见 [持续优化策略](continuous-optimization-strategy.md)。

首项诊断结果见 [BP409 状态转移与动作排序](transition-ranking-diagnosis-bp409.md)。

- [turn-schedule-protocol-bp391.md](turn-schedule-protocol-bp391.md) — 第四批十轮转向条件预注册、刷新样本与参考等价协议。
- [turn-schedule-ten-rounds-bp391.md](turn-schedule-ten-rounds-bp391.md) — 完成 R31–R40，执行 16580 局、复用 2304 局；诊断候选 R31, R32, R33, R34, R35, R36，475 项测试通过。

- [path-component-protocol-bp390.md](path-component-protocol-bp390.md) — 第三批十轮路径评分子项预注册与逐局检查点协议。
- [path-component-ten-rounds-bp390.md](path-component-ten-rounds-bp390.md) — 完成 R21–R30，执行 6764 局、复用 768 局；诊断候选 R28, R29，468 项测试通过。

- [ranking-tuning-protocol-bp389.md](ranking-tuning-protocol-bp389.md) — 第二批排序单因素实验预注册及验证集隔离。
- [ranking-tuning-ten-rounds-bp389.md](ranking-tuning-ten-rounds-bp389.md) — 完成 R11–R20 / 15516 局；诊断候选 R15, R16, R19，461 项测试通过，生产未改动。

- [efficient-tuning-protocol.md](efficient-tuning-protocol.md) — 固化单因素、地图隔离、反事实去重和逐级晋级门。
- [efficient-tuning-ten-rounds-bp388.md](efficient-tuning-ten-rounds-bp388.md) — 完成10轮/1149局，四个候选均未通过预设门；456项回归通过，生产基线不变。

- [native-bomb-phase-calibration-bp384-386.md](native-bomb-phase-calibration-bp384-386.md) —
  冻结1243场景/2486局，仅校准炸弹phase；1162胜1093负231平，得分51.39%，
  810局无炸弹控制零差异，453项回归通过，生产源码与预算不变。

- [base-policy-kernel-bp178-bp179-thin-upload.md](base-policy-kernel-bp178-bp179-thin-upload.md) —
  完成无旧ProductionRoot的薄NativeBasePolicyEngine，并在64场景/128局中验证模块、bundle source和
  180,466字节minified逐帧语义零差异；265项Minimax测试全绿，确立新的V2工作基线。
- [base-policy-kernel-bp174-bp177-upload-footprint.md](base-policy-kernel-bp174-bp177-upload-footprint.md) —
  定位旧ProductionRoot与BasePolicy双栈体积根因，提取精确Observation，删除纯诊断负担并对固定BP68
  profile做编译期特化；fixed16/Discovery64逐动作零差异，完整Risk/Safety闭包压到199,115字节。
- [base-policy-kernel-bp173-production-hook.md](base-policy-kernel-bp173-production-hook.md) —
  把原生BasePolicy作为默认关闭的显式依赖接入真实ProductionRoot，识别并修复非poison资源帧历史偷跑；
  固定16与Discovery64逐动作零差异，完整Minimax UT 247/247。
- [base-policy-kernel-bp172-native-root.md](base-policy-kernel-bp172-native-root.md) —
  将七个已验收thin组件收敛为单一无V1 VM原生根；固定16和Discovery64逐动作零差异，root不新增
  TypedArray或world state，完整Minimax UT 246/246。
- [base-policy-kernel-bp160-bp170-performance.md](base-policy-kernel-bp160-bp170-performance.md) —
  移除V1 VM双重审计、按runtime evidence生成thin search/leaf/path、两项精确星图缓存、root+delta地形
  身份、固定几何表，以及Discovery64逐动作零差异和本地15.5%候选总耗时下降。
- [base-policy-kernel-bp156-bp157-production-migration.md](base-policy-kernel-bp156-bp157-production-migration.md) — BP68最终所有权器、资源/FIRE动作域、战略Intent与原生对手历史迁移，以及BP160双重搜索审计消融；native-only固定16动作零差异，本地总耗时/P95降至匹配V1的56.11%/45.72%。

- [gr0-global-recovery.md](gr0-global-recovery.md) — GR0 artifact retention、committed danger 所有权、Minimax/Risk/EO 纯 UT 门和 6,608 局 compact arena 合同。
- [gr0-change-causality.md](gr0-change-causality.md) — rejected 变更区间的单因素/holdout 因果审计、正负修改分类和选择性 shallow Information 恢复。
- [ss-a0-soft-stack-ablation.md](ss-a0-soft-stack-ablation.md) — Soft Safety / Information
  风险栈的预注册五模式 Discovery、死亡护栏拒绝和 Holdout 停止结论。
- [strat2-strategy-layer.md](strat2-strategy-layer.md) — STRAT2 D0–D3：
  默认击杀、静态descriptor、统一Minimax/Eval/Risk、离散band、oracle、
  本地性能/构建证据与尚未完成的D4资格门。
- [strat3-portfolio-rearchitecture.md](strat3-portfolio-rearchitecture.md) — STRAT3 RST1：
  中立基础估值、post-Risk strategy portfolio、post-selection commit、V1式contact-gated
  Minimax边界、结构UT和32场景止损样本。
- [pac1-projectile-attack-closure.md](pac1-projectile-attack-closure.md) — Candidate FIRE
  的逐敌方根动作弹丸生存闭包、ReverseViability证书、StageMatrix接线与行为中性A/B。
- [pac2-survivor-frontier.md](pac2-survivor-frontier.md) — 存活分支双frontier、
  endpoint机会成本、位集性能实现、6,608局全量拒绝及后续攻击continuation方向。
- [v3-v2-component-causal-testing.md](v3-v2-component-causal-testing.md) — VC0–VC8
  固定64场景、V3共享状态桥、逐组件消融、独立Holdout和`V3_BEST`最终128局结论。
- [v3r0-v3r8-hierarchical-recovery.md](v3r0-v3r8-hierarchical-recovery.md) — V3R0–V3R8
  历史实验与撤销说明：无VM V3 的50%仅为V1基准等价，不是V2恢复；组件负向/中性证据保留。
- [v2-component-transplant-ctr0-ctr8.md](v2-component-transplant-ctr0-ctr8.md) —
  正确身份下的V3_BASE单组件因果验证、真实V2_BASE 9.38%基线、Strategy接线修正、
  空`V3_COMPONENT_BEST`以及CTR7/CTR8阻塞结论。
- [v2-root-ownership-counterfactual-audit.md](v2-root-ownership-counterfactual-audit.md) —
  精确root反事实标签、早期轨迹oracle、局部几何/时序ranker及Poison、Direct、Plan所有权
  POC的拒绝证据，并把下一步收敛为stateful option/intent实验。
- [hp9-runtime-work-calibration.md](hp9-runtime-work-calibration.md) — 五批exclusive阶段计时、
  十类work charge、搜索中断fail-closed、16/32场景本地资格和冻结的HP9深度基线。
- [hp10-hp11-minimax-value-ownership.md](hp10-hp11-minimax-value-ownership.md) — Physical
  depth-2差分oracle、精确浅层所有权保留、full-width P1/P2调度、非所有权早停和HP11冻结标定。
- [hp12-consumer-aware-information-schedule.md](hp12-consumer-aware-information-schedule.md) —
  Information支持损失探针、无消费者近似计算门、同源码性能A/B和HP12冻结标定。
- [hp13-information-interval-ownership.md](hp13-information-interval-ownership.md) —
  Information点估计/区间所有权分离、严格`lower > upper`合同及固定16场景零支配证据。
- [hp14-common-policy-interval-shadow.md](hp14-common-policy-interval-shadow.md) —
  ObservationSplit共同策略量词oracle、深层融合上限与选择性单层几何搜索方向。
- [hp15-selective-geometry-shadow.md](hp15-selective-geometry-shadow.md) —
  Risk/Pareto后三行单层几何Shadow、full/compact零差分及57.82%节点节省。
- [hp16-runtime-selective-geometry-shadow.md](hp16-runtime-selective-geometry-shadow.md) —
  三行几何进入真实work ledger后的预算排挤证据、常驻调度拒绝与HP17稀疏触发方向。
- [hp17-sparse-geometry-schedule.md](hp17-sparse-geometry-schedule.md) —
  零搜索特征Discovery/Validation、2/4/8帧冷却标定及C4 Shadow调度冻结。
- [hp18-geometry-proposal-ownership.md](hp18-geometry-proposal-ownership.md) —
  单层几何严格Proposal接线、同工作量A/B与独立Holdout所有权拒绝证据。
- [hp19-depth-two-preflight.md](hp19-depth-two-preflight.md) —
  P2节点下界Shadow、调度阻塞分类及低预算full-width P1方向。
- [hp20-low-budget-full-p1.md](hp20-low-budget-full-p1.md) —
  低预算Direct调度A/B、切换root审计及threshold 192拒绝证据。
- [hp21-selective-stun-direct-p2.md](hp21-selective-stun-direct-p2.md) —
  stun Chance矩阵规模门、五批宽根反例、独立Holdout与production默认接线。
- [hp22-p2-support-census.md](hp22-p2-support-census.md) —
  P2中止原因与动作对统计、移动争用规则阻塞、独立Holdout和零语义变化标定。
- [hp23-static-occupied-block.md](hp23-static-occupied-block.md) —
  官方静态占位规则闭合、Reference/Fast公共边界、独立因果A/B和新增搜索成本标定。
- [hp24-no-effect-go-alias-rejection.md](hp24-no-effect-go-alias-rejection.md) —
  精确但稀疏的无效GO后继别名、双顺序五批标定、真实arena节省量和完整运行时撤销。
- [hp25-minimax-cost-census.md](hp25-minimax-cost-census.md) —
  外部逐ply成本对账、P3/P4节点预算阶梯、selective depth分离与下一轮640等效目标。
- [hp26-physical-tt-successor.md](hp26-physical-tt-successor.md) —
  父帧到实际后继帧的Physical TT容量消融、源码指纹修复及32项production保留结论。
- [hp27-p3-state-identity-census.md](hp27-p3-state-identity-census.md) —
  精确state身份、排序上限、Chance别名与Fast/Hard对账，定位递归窗口缺失。
- [hp28-windowed-maximin.md](hp28-windowed-maximin.md) —
  父maximin窗口递归传播、显式bound返回、独立oracle、固定栈差分与五批深度标定。
- [hp29-node-budget-allocation.md](hp29-node-budget-allocation.md) —
  HP28后P3预算曲线、576/620完整回调A/B、独立Holdout与全局加预算拒绝。
- [joint-vacated-follow-and-rule-variant-poc.md](joint-vacated-follow-and-rule-variant-poc.md) —
  31个官方腾空跟随样本、Reference/Fast共同路径、剩余swap/同目标边界，以及7/7闭合但
  零接管的三世界P2反证。
- [two-stage-attack-setup-shadow.md](two-stage-attack-setup-shadow.md) —
  全移动候选的两阶段物理攻击闭包、7个证书、Information区间阻塞及零接管ACTIVE POC。
- [possible-projectile-attack-setup-shadow.md](possible-projectile-attack-setup-shadow.md) —
  弹丸存在/不存在共同策略闭包、poison节拍局部重建、2证书/4反证及零接管结论。
- [no-acceptable-pose-fallback.md](no-acceptable-pose-fallback.md) —
  `NO_ACCEPTABLE` 冷分支的projected-pose排序修复、精确反事实链和固定16场景`LOSS→WIN`证据。
- [no-acceptable-observation-ownership.md](no-acceptable-observation-ownership.md) —
  1,922个`NO_ACCEPTABLE`根的来源census、Observation审计不对称、三个全局POC拒绝、
  第一动作分歧语料和下一步有限延续证据边界。
- [objective-conditioned-continuation.md](objective-conditioned-continuation.md) —
  目标条件延续、无主移动继承STAR缺陷、future-FIRE早期Pareto冲突和固定16场景
  `+4.69pp`但生产拒绝的因果证据。
- [common-policy-option-interval.md](common-policy-option-interval.md) —
  新盲Discovery的possible-projectile双世界共同策略interval、错误有限时域所有权的
  `-3.91pp`反证、fail-closed终局证书合同与常驻性能拒绝。
- [attack-strategy-ownership-causal-study.md](attack-strategy-ownership-causal-study.md) —
  ATTACK/STAR所有权、持久目标反例、两行动Option局部Minimax零支配证据，以及singleton
  possible-projectile共同策略响应闭包的覆盖提升与ACTIVE零动作收益。
  FIRE漏斗、EO-safe攻击提案、攻击姿态与资源反例、事件边界Option抖动审计，以及
  `qualified attack > star`完整Discovery `-7.82pp`反例、稳定target-generation账本和
  99个事件化四帧Option interval冲突的零所有权证据；score-band TargetLifecycle账本证明Plan覆盖
  99.34%的决策重复提交，而长期target run平均仅3.07帧；新增双Discovery即时FIRE owner得到
  `+1.56pp/+0.52pp`弱正向但未过+3pp门，收敛到跨帧ATTACK target而非阈值调优。
- [base-policy-kernel-bp0-stage-equivalence.md](base-policy-kernel-bp0-stage-equivalence.md) — BasePolicyKernel BP0逐根意图/动作映射等价、Shadow状态污染修复、剩余5个context转换与55.68%完整战术动作差异。
- [base-policy-kernel-bp1-action-domain.md](base-policy-kernel-bp1-action-domain.md) — BasePolicyKernel BP1隔离原生动作域、根/二层99%以上集合与顺序等价、BOMB资格结构修复及BP2 transition/value边界。
- [base-policy-kernel-bp2-transition-value-contract.md](base-policy-kernel-bp2-transition-value-contract.md) — BasePolicyKernel BP2 stun相位闭合、公共域Minimax排序归因、78.80%动作一致与ACTIVE `+21.87pp`，并收敛到紧凑policy-local搜索内核。
- [base-policy-kernel-bp3-policy-local-search.md](base-policy-kernel-bp3-policy-local-search.md) — BasePolicyKernel BP3 policy-local动作/列视图、V1确定性stun量词、84.52%动作一致、预算叶下降17.30%与ACTIVE 48.44%。
- [base-policy-kernel-bp4-committed-search.md](base-policy-kernel-bp4-committed-search.md) — committed danger 内继续Minimax的因果验证：补回406个漏搜根但ACTIVE降至37.50%，因此诊断保留、所有权拒绝。
- [base-policy-kernel-bp5-tactical-invocation.md](base-policy-kernel-bp5-tactical-invocation.md) — 精确战术调用域因果消融：拒绝broad-visible与bomb/predictive负交互，只补回enemy-stunned窗口后固定16场景从48.44%提升到53.13%。
- [base-policy-kernel-bp6-stun-fire-funnel.md](base-policy-kernel-bp6-stun-fire-funnel.md) — 202个新增stun根的FIRE逐层漏斗：201个由V1-shaped source domain过滤且verified opportunity为0，因此拒绝盲目扩域或调分。
- [base-policy-kernel-bp7-qualified-fire-value-audit.md](base-policy-kernel-bp7-qualified-fire-value-audit.md) — 169个合格FIRE的价值归因：73个被选、56个逐响应被支配、37个矩阵权衡、10个被意图连续性反转，排除全局开火加分。
- [base-policy-kernel-bp8-qualified-fire-counterfactual.md](base-policy-kernel-bp8-qualified-fire-counterfactual.md) — intent-only与response-tradeoff FIRE所有权整局反事实：分别降至46.88%和26.56%，证明软命中与单步自逃不足以绕过战略连续性或最坏响应。
- [base-policy-kernel-bp9-dominated-fire-fidelity.md](base-policy-kernel-bp9-dominated-fire-fidelity.md) — 56个逐响应被支配FIRE的V1/native价值保真审计：30个共同拒绝、10个原生排序缺陷、16个无共同根；缺陷根物理完全一致，主差异收敛到缺失的response-conditioned ACTION路径价值。
- [base-policy-kernel-bp10-response-conditioned-fire.md](base-policy-kernel-bp10-response-conditioned-fire.md) — apply后响应条件FIRE增量的同轨迹保真正证据与ACTIVE反证：根值排序更接近V1，但固定16得分由53.13%降至39.06%，因此只保留Shadow。
- [base-policy-kernel-bp11-first-divergence-causal-audit.md](base-policy-kernel-bp11-first-divergence-causal-audit.md) — BP10结果变化局的同状态首次分歧审计：软响应增量拥有7/7次选择翻转却产生6负1正，证明局部V1估值一致不是动作所有权证书。
- [base-policy-kernel-bp12-value-ownership-split.md](base-policy-kernel-bp12-value-ownership-split.md) — robust/nominal双整数通道消融：软值移出robust后由39.06%恢复到50.00%，但唯一nominal破同分仍把胜局改成负局，因此软预测不得直接拥有动作。
- [base-policy-kernel-bp13-host-and-exact-ownership.md](base-policy-kernel-bp13-host-and-exact-ownership.md) — 修复诊断`CAST_STUN→TURN_RIGHT`与伪V3 fallback，证明budget-complete不等于value-exact；真正V3宿主上启发式覆盖产生1个负转换，exact覆盖零退化但尚无胜局收益。
- [base-policy-kernel-bp14-exact-blocker-census.md](base-policy-kernel-bp14-exact-blocker-census.md) — 1,641个根的精确性阻塞普查：整根exact仅0.49%，预算与深度叶共同阻塞96.59%，因此拒绝把有限深度点值恢复成动作所有权。
- [base-policy-kernel-bp15-bp17-candidate-certificates.md](base-policy-kernel-bp15-bp17-candidate-certificates.md) — 候选级ForcedWin与逐行policy-exact证书、真实V3 incumbent接线及Discovery64因果验证；7个覆盖全部集中在frame125–127既有胜局，默认所有权关闭。
- [base-policy-kernel-bp18-bp25-policy-response-envelope.md](base-policy-kernel-bp18-bp25-policy-response-envelope.md) — Bellman一致的策略响应包络、有限标量ACTIVE反证、攻击事件闭合、深度/共享baseline标定，以及根FIRE调度99.32%节点削减。
- [base-policy-kernel-bp26-long-option-event-envelope.md](base-policy-kernel-bp26-long-option-event-envelope.md) — 606个延期长Option的单策略动作/敌方响应前沿、PhysicalState合并、TT哨兵缺陷修复，以及严格事件闭合零新所有权结论。
- [base-policy-kernel-bp27-long-option-response-mass.md](base-policy-kernel-bp27-long-option-response-mass.md) — incumbent与AttackPose共同后续策略的成对整数响应质量、36个完整逐根Pareto候选、预算截断漂移合同与全局所有权拒绝。
- [base-policy-kernel-bp28-response-mass-active.md](base-policy-kernel-bp28-response-mass-active.md) — 逐根Pareto ACTIVE固定16因果验证、`+3.12pp`弱正向、末端统一Hard closure缺陷修复及独立验证门。
- [base-policy-kernel-bp29-independent-rejection.md](base-policy-kernel-bp29-independent-rejection.md) — 公平`GUARDED_SHADOW`独立64局、ACTIVE `-7.81pp`否决、FIRE伪成功与共同AttackPose continuation根因。
- [base-policy-kernel-bp102-bp106-policy-horizon.md](base-policy-kernel-bp102-bp106-policy-horizon.md) — 共同视界下Base/Combat/逐层组合/根绑定策略的因果对比，确认策略身份可恢复7.81pp、未闭合AttackSetup是负收益，而主要剩余缺口属于horizon bootstrap。
- [base-policy-kernel-bp107-bp111-terminal-chance-bootstrap.md](base-policy-kernel-bp107-bp111-terminal-chance-bootstrap.md) — 90-root终局监督、整数ranker反证、Own/Enemy/Chance三量词、exact-controller-history和独立Chance holdout，拒绝primitive/category owner并收敛到持久objective interval。
- [base-policy-kernel-bp112-bp114-objective-epoch.md](base-policy-kernel-bp112-bp114-objective-epoch.md) — 持久ObjectiveEpoch与执行gap普查、已验证攻击优先级修复、H4/H8 ACTIVE及独立切片反证；保留目标状态，拒绝一步几何progress直接拥有primitive。
- [base-policy-kernel-bp115-bp116-option-arbitration.md](base-policy-kernel-bp115-bp116-option-arbitration.md) — strict Option仲裁漏斗、239个稀疏两Option Minimax、98.3%完整率与230/232反驳；定位POSITION被错误升级为长期目标身份。
- [base-policy-kernel-bp117-bp118-semantic-objective.md](base-policy-kernel-bp117-bp118-semantic-objective.md) — semantic target身份、POSITION执行alias、局部搜索节点减少98.66%，以及唯一严格FIRE证书把被击毁改为平局但仅`+1.56pp`、未过动作owner门的ACTIVE证据。
- [base-policy-kernel-bp119-attack-option-coverage.md](base-policy-kernel-bp119-attack-option-coverage.md) — semantic ATTACK目标执行漏斗：1,851个目标帧中1,717个无strict执行，254个strict根中215个只有FIRE；定位主缺口在Risk/Portfolio之前的接敌Option生成。
- [base-policy-kernel-bp120-attack-execution-interval.md](base-policy-kernel-bp120-attack-execution-interval.md) — 306个route-progress候选的完整两Option比较：208/208被Minimax反驳、0严格支配；证明一步接近射位不是完整攻击Option，并定位第一步route与后续策略身份断裂。
- [base-policy-kernel-bp121-bp122-semantic-attack-policy.md](base-policy-kernel-bp121-bp122-semantic-attack-policy.md) — 分支独立ATTACK策略把0个primitive优势恢复为32个策略优势，但19次ACTIVE覆盖使得分下降1.57pp并把同星平局改成炸弹死亡；保留策略身份，拒绝短视界标量动作所有权。
- [base-policy-kernel-bp123-bp124-common-continuation.md](base-policy-kernel-bp123-bp124-common-continuation.md) — 候选与incumbent只在根动作不同、之后共享BasePolicy；64个Shadow优势的45次ACTIVE覆盖仅+1.56pp且星差/crash恶化，保留verifier、拒绝owner。
- [base-policy-kernel-bp125-certificate-root-corpus.md](base-policy-kernel-bp125-certificate-root-corpus.md) — 64个标量证书根的零遗漏TypedArray捕获与128条精确前缀分支重放；candidate多2次击毁却少1个非败局、星差再差2，确认有限时域scalar不能直接拥有动作。
- [base-policy-kernel-bp126-chance-interval.md](base-policy-kernel-bp126-chance-interval.md) — 64根、1,024个exact-controller-history Chance cell；Discovery筛出6个，独立R3–R6 holdout通过0个，证明paired世界线不能由聚合区间替代。
- [base-policy-kernel-bp127-objective-progress.md](base-policy-kernel-bp127-objective-progress.md) — 六维可观察Attack Objective Pareto过滤仅5/64；59个支配根在独立Chance上仍有16次胜负退化、严格全Chance资格为0，拒绝把候选生成条件当独立证书。
- [base-policy-kernel-bp128-comparison-confusion.md](base-policy-kernel-bp128-comparison-confusion.md) — 211个完整paired comparison的精确历史反事实；正scalar仅2改善/2退化且terminal Pareto 13/11，拒绝有限深度点值拥有primitive，并修复跨帧hash与技能矩阵两项诊断身份缺陷。
- [base-policy-kernel-bp129-depth-stability.md](base-policy-kernel-bp129-depth-stability.md) — 同一211组动作的cache隔离深度/预算标定；depth2预算扩大8倍零改判，depth3有181个非预算型不完整出口且30个完整根中8个改符号，转向事件/截止期闭包而非盲目加深。
- [base-policy-kernel-bp130-depth3-support.md](base-policy-kernel-bp130-depth3-support.md) — 181个depth3不完整根全部精确归因为representative WIDTH早停（incumbent 176、candidate 5），预算/Fast/Hard/restore均为0；下一步标定W2/W3/W4而非修改leaf或盲目加预算。
- [base-policy-kernel-bp131-depth3-width.md](base-policy-kernel-bp131-depth3-width.md) — W3把depth3完整率由30/211提高到175/211但节点增至3.76倍；W4及双预算零新增，且W3正scalar仍为1改善/1退化，明确分离搜索覆盖与游戏质量。
- [base-policy-kernel-bp132-depth3-transition-support.md](base-policy-kernel-bp132-depth3-transition-support.md) — 剩余36个depth3不完整根全部归因：35个是ply2 `GO/GO`联合移动物理支持缺口，1个是敌弹命中土堆后的正确Hard保守未知；否决继续加深/加宽/加预算。
- [base-policy-kernel-bp133-joint-movement-oracle.md](base-policy-kernel-bp133-joint-movement-oracle.md) — 35个联合移动缺口按同目标、stun竞争、follow与规则证据等级拆分，拒绝把固定模拟器语义冒充平台真值。
- [base-policy-kernel-bp134-depth3-move-variant.md](base-policy-kernel-bp134-depth3-move-variant.md) — 三种隔离移动规则世界全部闭合且关系一致，排除物理规则分歧并暴露标量方向与历史结果反向。
- [base-policy-kernel-bp135-leaf-backup.md](base-policy-kernel-bp135-leaf-backup.md) — 八条leaf消融排除星权重，定位ATTACK假阳性和独立maximin/均值敌方响应量词不足。
- [base-policy-kernel-bp136-response-matrix.md](base-policy-kernel-bp136-response-matrix.md) — 共享`2×N` StageMatrix、混合均衡和风险污染仍更支持两个历史退化，拒绝矩阵support拥有动作并转向response-conditioned证据。
- [base-policy-kernel-bp137-response-conditioned.md](base-policy-kernel-bp137-response-conditioned.md) — 同列FULL/NO_ATTACK与历史响应标签证明一步响应无法判向；严格结构攻击进展零退化误报但只有50%改善召回。
- [base-policy-kernel-bp138-event-deadline.md](base-policy-kernel-bp138-event-deadline.md) — 两条无ATTACK标量事件lane消除退化假优势但也无法确认改善，定位固定depth叶与真正event horizon的差异。
- [base-policy-kernel-bp139-event-horizon.md](base-policy-kernel-bp139-event-horizon.md) — 深度4正向strict事件证明、单动作重规划策略规模压缩、390/420完整搜索与零证书结论；下一步转向对敌方拒绝暴露进行有限时域字典序价值结算。
- [base-policy-kernel-bp140q0-chance-qualified-labels.md](base-policy-kernel-bp140q0-chance-qualified-labels.md) — 35个方向根的560个exact Chance cell双向资格；历史2改善/2退化全部为MIXED，禁止把单次stun/星结果当作Minimax真值。
- [base-policy-kernel-bp140q1-refusal-interval.md](base-policy-kernel-bp140q1-refusal-interval.md) — 有限horizon拒绝价值向量、绝对下界短路与固定TT使节点减少53.38%并闭合105/105规则实例；得到2个原动作保护证书、0个候选证书。
- [base-policy-kernel-bp141-refusal-policy-portfolio.md](base-policy-kernel-bp141-refusal-policy-portfolio.md) — 三个持久命名策略逐一覆盖完整敌方/Chance/规则世界；侧翼15,644次、拒绝对枪350次均未提高最坏值，根35/35仍选direct，拒绝以2.5295倍节点接入owner。
- [base-policy-kernel-bp142-one-deviation.md](base-policy-kernel-bp142-one-deviation.md) — 每条世界线最多一次响应偏离、显式资格缓存与精确maximin剪枝闭合105/105实例，恢复8个局部候选证书；决定维度均非攻击，因此保持Shadow。
- [base-policy-kernel-bp143-one-deviation-attack-event.md](base-policy-kernel-bp143-one-deviation-attack-event.md) — depth6严格安全威胁/必杀事件证明扫描35根；candidate虽执行366次FIRE但威胁为0，确认失败在位置候选来源而非搜索性能。
- [base-policy-kernel-bp144-bp146-real-attack-events.md](base-policy-kernel-bp144-bp146-real-attack-events.md) — 932个真实V1 FIRE、476个严格证明根与4个漏射ACTIVE POC；得到48个安全威胁、30个历史击毁必杀证书和1正0负整局转换，production保持关闭。
- [base-policy-kernel-bp147-bp148-attack-certificate-scheduler.md](base-policy-kernel-bp147-bp148-attack-certificate-scheduler.md) — 已缓存清晰射线与当前非FIRE构成零额外几何的严格证明调度器，盲半集11/11召回、总证明节点减少95.2%；全部22个可干预证书ACTIVE得到6正0负、分析点`+11`。
- [base-policy-kernel-bp149-bp151-production-proof.md](base-policy-kernel-bp149-bp151-production-proof.md) — TT64共享arena与production证明逐节点等价；修复根FIRE no-op假证书，Discovery64拒绝safe-threat动作所有权与731倍成本的常驻PAC剪枝。
- [base-policy-kernel-bp152-bp155-minimax-participation.md](base-policy-kernel-bp152-bp155-minimax-participation.md) — 全局搜索参与率、refuted possible-projectile Physical支持恢复、宽搜索与StageMatrix所有权反证，以及BasePolicy incumbent＋门控战术反驳的新根组合。
- [imp0-overview.md](imp0-overview.md) — IMP0 implementation overview and accepted machine-evidence link.
- [imp0-platform-foundation-overview.md](imp0-platform-foundation-overview.md) — earlier platform-control slice retained as supporting history, not the IMP0 completion owner.
- [imp1-overview.md](imp1-overview.md) — IMP1 multi-profile/read-only platform implementation and accepted real-context evidence.
- [imp2-overview.md](imp2-overview.md) — accepted IMP2 Reference Oracle, 125-test G1 evidence, 12 official probes, poison failed-cast finding, and runtime capability reconciliation.
- [imp3-overview.md](imp3-overview.md) — accepted IMP3 TypedArray FastKernel, apply/undo, committed hazards, ReverseViability, per-action Hard, overflow and 20-case Reference differential.
- [imp4-overview.md](imp4-overview.md) — accepted IMP4 sound Value intervals, restricted Double Oracle, InformationState Proof/DFPN, recursive robust risk, deep Fast make/undo and exhaustive small-state oracle.
- [imp5-overview.md](imp5-overview.md) — accepted IMP5 integer FeatureRegistry, Table/Generated evaluation, hysteretic strategy selection, current-match OpponentModel, poison-specialized skill policy, PersistentPlan and hidden-risk strict isolation.
- [v1-risk-fire-runtime-fallback-comparison.md](v1-risk-fire-runtime-fallback-comparison.md) — frozen V1 risk-fire/fallback semantics, V2 logic/performance comparison, and repeatable paired battles.
- [v2-structural-repair-v1.md](v2-structural-repair-v1.md) — first V1-guided V2 structural repair, dynamic rolling corpus, 2,128-match local evidence, strict invariant results, and unresolved platform boundaries.
- [v2-performance-tuning-v1.md](v2-performance-tuning-v1.md) — matched-input fallback benchmark, selected frame/work profile, post-tuning 2,128-match action traces, performance result, and pending gameplay review.
- [v2-projectile-terminal-structural-repair-v2.md](v2-projectile-terminal-structural-repair-v2.md) — four-way projectile/fire/collision/frame-128 audit, structural rule/search repairs, reselected performance profile, strict failure replay, and final 2,128-match evidence.
- [fast-regression-overview.md](fast-regression-overview.md) — append-only battle evidence, Replay Capsule reconstruction, independent Minimax oracle, dynamic V1 history, and layered fast-regression commands.
- [multi-frame-risk-bounds-structural-repair.md](multi-frame-risk-bounds-structural-repair.md) — historical R6 four-frame future-FIRE path repair and its immutable evidence.
- [possible-projectile-path-support-repair.md](possible-projectile-path-support-repair.md) — possible-projectile joint path support, revision-keyed shared hazard cache, 25/165 current survivors, root-cause split, and performance evidence.
- [current-full-historical-regression-r17.md](current-full-historical-regression-r17.md) — current-source full historical replay, exact R12-to-R17 death rescue/regression transitions, remaining failure surfaces, and 19,136-root invariant evidence.
- [no-acceptable-rescue-structural-repair.md](no-acceptable-rescue-structural-repair.md) — policy-consistent reclassification of the four apparent regressions, the constrained causal fallback repair, rejected broad alternatives, and R20 no-regression evidence.
- [full-regression-r21.md](full-regression-r21.md) — post-migration 19,136-root verification, R17/R12 survival deltas, remaining failure buckets, and the local-runtime caveat.
- [full-regression-r22.md](full-regression-r22.md) — post value-depth/perf repair vs R21: +35 primary survivors, 5 regressions, controls flat, capsule-all faster.
- [structural-repair-baseline-b0.md](structural-repair-baseline-b0.md) — frozen pre-repair baseline: workingSourceSha256, test:4, R21 buckets, production byte snapshot, and build-drift caveat.
- [death-category-probe-b0.md](death-category-probe-b0.md) — Step-1 stratified 25-root death categories: 0 Hard wiring leaks, 8 continuation gaps, 17 information-only.
- [fact-layer-scan-b0.md](fact-layer-scan-b0.md) — Step-2 full R21 frame observation↔Physical mismatch scan: 0 mismatches.
- [escape-obligation-step3a.md](escape-obligation-step3a.md) — Step-3a EscapeObligation production wiring, UT, and test:4 gate.
- [continuation-reprobe-post-eo.md](continuation-reprobe-post-eo.md) — post-EO CONTINUATION re-probe: 8/8 still die; same-frame clearing-only scope.
- [deadline-kernel.md](deadline-kernel.md) — DeadlineKernel + EscapeObligation: 1/8 CONTINUATION survival (FIRE→TURN_LEFT).
- [deadline-projectile-aware.md](deadline-projectile-aware.md) — projectile hit-tick + GO-into-contact demotion: 3/8 CONTINUATION, 826c TURN_LEFT live.
- [continuation-cleared-r23.md](continuation-cleared-r23.md) — remaining CONTINUATION cleared 8/8; R23 full regression vs R21/R22c.
- [value-depth-probe-b0.md](value-depth-probe-b0.md) — Step-3b offline diagnosis of 23 VALUE_DEPTH_NON_DISCRIMINATION cases.
- [value-depth-step4.md](value-depth-step4.md) — Step-4 leaf/Risk comparison semantics: 4/23 live survival flips.
- [information-recursion-step5.md](information-recursion-step5.md) — Step-5 budgeted Information depth≤2 with Physical continuation leaves.
- [value-depth-residual-post-s5.md](value-depth-residual-post-s5.md) — Post-S5 residual diagnosis + perf: 12/23 survival, ~54 avg nodes.
- [value-depth-convergence-r22b.md](value-depth-convergence-r22b.md) — Tighten death-pressure slack: 5→1 SURVIVE→DIE, 75/256 survivors.
- [forced-win-information-step6.md](forced-win-information-step6.md) — Step-6 Information ForcedWin AND over small complete HiddenWorld sets.
