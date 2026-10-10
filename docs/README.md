# AgentTank Minimax V2

本目录是项目文档入口。项目工作区已经迁移到 WSL 原生文件系统：

```text
/home/skill/workspace/git/agentank_client
```

不要再以 `/mnt/c/Users/skill/Documents/agent tank` 作为工作目录。旧路径只保留旧 Git 元数据和
空目录，不再是源码权威位置。

## 项目概览

本项目实现高性能 AgentTank V2：以固定整数和 TypedArray 为基础，组合 PhysicalState、
InformationState、Hard Safety、AND/OR Proof、Minimax/StageMatrix、多维风险门、策略选择、
弹丸生命周期、技能模型和可重放历史回归。

主要目录：

| 路径 | 用途 | Git 属性 |
|---|---|---|
| `engine-v2/src/` | V2 算法唯一源码 | 应纳入 Git |
| `test/` | IMP、SR、Minimax 和回归 UT | 应纳入 Git |
| `tools/` | 构建、平台、benchmark、simulate 和回归工具链 | 应纳入 Git |
| `config/` | 不含密钥的规则与配置 | 应纳入 Git |
| `docs/design/` | 详细设计和合同 | 应纳入 Git |
| `docs/implementation/` | 阶段验收与结构修复记录 | 应纳入 Git |
| `battle-records/` | 下载的真实对战和本地索引 | 本地保留，Git 忽略 |
| `battle-baselines/` | 历史对战基线 | 本地保留，Git 忽略 |
| `artifacts/` | 构建、Capsule、benchmark 和报告 | 可再生，本地保留，Git 忽略 |

当前旧production默认入口仍是`engine-v2/src/runtime/production-entry.js`。BP179已资格通过的新V2
工作基线入口是`engine-v2/src/runtime/native-base-policy-production-entry.js`；它尚未冻结为官方
Candidate。任何生成的source/minified都不是源码，不能手工修改。

## 文档入口

- [基本操作](operations.md)：环境、测试、构建、回归、平台操作和 Git 规则。
- [当前状态](current-status.md)：当前算法、验证证据、代码大小阻塞和下一步。
- [设计索引](design/README.md)：详细设计与规范。
- [实施索引](implementation/README.md)：IMP/SR 和结构修复记录。
- [平台运行合同](design/platform-operations-contract.md)：simulate、publish、限流和错误处理。
- [代码大小约束](implementation/platform-code-size-constraint.md)：UTF-8 上传限制和当前测量。
- [SS-A0 Soft 风险栈因果消融](implementation/ss-a0-soft-stack-ablation.md)：固定 266
  场景的预注册 Discovery、停止门与后续方向。
- [STRAT2 战略层实现](implementation/strat2-strategy-layer.md)：默认击杀、离散
  StrategyBand、统一 Minimax/Eval/Risk、本地结构证据与未完成的 D4 资格。
- [PAC2 SurvivorFrontier](implementation/pac2-survivor-frontier.md)：候选弹丸的敌方存活
  前沿、性能实现、因果A/B和6,608局全量拒绝结论。
- [V3–V2组件因果测试](implementation/v3-v2-component-causal-testing.md)：冻结V1行为宿主、
  64场景Discovery/Holdout、VC0–VC8组件贡献和当前`V3_BEST`清单。
- [V2组件因果验证与原生回迁计划](design/v3-v2-component-transplant-recovery-plan.md)：
  修正V3/V1基准错误，以`V3_BASE + 单个V2组件`对战原版V3，再将正向组件逐个回迁真实V2。
- [V2组件因果验证 CTR0–CTR8](implementation/v2-component-transplant-ctr0-ctr8.md)：
  已执行的组件评分、真实V2_BASE 9.38%基线、空BEST和新盲测场景缺口。
- [HP10–HP11 Minimax值所有权](implementation/hp10-hp11-minimax-value-ownership.md)：
  精确P1回退、P2完整证书、非所有权早停与最新性能基线。
- [HP12 Consumer-aware Information调度](implementation/hp12-consumer-aware-information-schedule.md)：
  识别无消费者的Information近似计算，将预算转移给可发布严格证书的Physical Minimax。
- [HP13 Information区间所有权](implementation/hp13-information-interval-ownership.md)：
  将点估计排序与严格`lower > upper`所有权分离，并证实旧近似搜索当前不能安全接管动作。
- [HP14 Common-policy区间Shadow](implementation/hp14-common-policy-interval-shadow.md)：
  exhaustive验证同观察共同动作，分离单层几何支持并确定下一步选择性搜索边界。
- [HP15 选择性单层几何Shadow](implementation/hp15-selective-geometry-shadow.md)：
  基准动作加普通/攻击challenger的三行完整敌方矩阵，验证零差分和57.82%节点节省。
- [HP16 真实预算选择性几何Shadow](implementation/hp16-runtime-selective-geometry-shadow.md)：
  证明几何机制有辨别力，但逐接触帧调度会提前fallback并挤压Physical完整搜索。
- [HP17 稀疏几何调度](implementation/hp17-sparse-geometry-schedule.md)：
  用零搜索根特征和4帧冷却保留一半几何机会，同时把Information节点减少73.1%。
- [HP18 单层几何Proposal所有权](implementation/hp18-geometry-proposal-ownership.md)：
  独立Holdout证明局部完整几何值不能独立拥有动作，拒绝Active并保留C4 Shadow。
- [HP19 P2规模预估](implementation/hp19-depth-two-preflight.md)：
  精确定位P1停滞主要来自低预算和stun旧调度，而不是完整P2矩阵节点下界过大。
- [HP20 低预算full-width P1](implementation/hp20-low-budget-full-p1.md)：
  threshold 192没有增加深度或完整owner且增加work，因此保持production门槛250。
- [HP21 选择性stun Direct-P2](implementation/hp21-selective-stun-direct-p2.md)：
  小Chance矩阵增加精确P2 owner，宽根保持legacy成本，production采用48节点门。
- [HP22 P2支持中止归因](implementation/hp22-p2-support-census.md)：
  证明剩余P2中止来自未校准的GO移动争用，而不是depth、节点预算或Hard性能。
- [HP23 静态占位阻挡闭合](implementation/hp23-static-occupied-block.md)：
  用官方replay闭合静态占位公共路径，量化Minimax完整覆盖提升、整局中性与新增计算成本。
- [HP24 无效GO别名拒绝](implementation/hp24-no-effect-go-alias-rejection.md)：
  证明局部别名语义精确但真实命中稀疏、不能提升深度，因而完整撤销运行时代码。
- [HP25 Minimax逐层成本标定](implementation/hp25-minimax-cost-census.md)：
  固化逐ply操作census，分离完整值深度和selective proof深度，并量化冷P3的节点目标。
- [HP26 Physical TT跨帧容量](implementation/hp26-physical-tt-successor.md)：
  用父帧到实际后继帧实验排除同根warm假象，拒绝扩容并修复标定源码身份覆盖。
- [HP27 P3状态身份census](implementation/hp27-p3-state-identity-census.md)：
  排除TT、静态排序和Chance合并，定位缺少递归α/β bound传播的结构瓶颈。
- [NO_ACCEPTABLE与Observation所有权](implementation/no-acceptable-observation-ownership.md)：
  定位Observation审计不对称，拒绝全局Safety/Information开关，并固化第一分歧根语料。
- [目标条件延续与Risk所有权](implementation/objective-conditioned-continuation.md)：
  证明目标语义和future-FIRE Pareto顺序有因果杠杆，同时拒绝不完整Physical证据直接接管动作。
- [Common-policy Option interval](implementation/common-policy-option-interval.md)：
  新盲Discovery证明同观察共同策略是必要量词，但有限时域启发式区间不能冒充终局value证书。
- [终局监督与Chance量词](implementation/base-policy-kernel-bp107-bp111-terminal-chance-bootstrap.md)：
  分离OwnPolicy、EnemyPolicy和ChanceOutcome，量化历史未来泄漏与controller-history偏差，并拒绝终局
  primitive/category直接所有权。
- [语义攻击策略区间](implementation/base-policy-kernel-bp121-bp122-semantic-attack-policy.md)：
  分支独立策略恢复32个短视界优势，但ACTIVE因果测试下降1.57pp；下一步收敛到事件结算和
  terminal/nonloss区间，而不是继续让标量Minimax直接拥有动作。
- [共同宿主攻击续写](implementation/base-policy-kernel-bp123-bp124-common-continuation.md)：
  修正“证明未提交Plan”的反事实合同；共同BasePolicy续写得到弱正向+1.56pp但未过owner门，
  下一步转为根状态反事实区间语料。
- [BP133 联合移动规则Oracle](implementation/base-policy-kernel-bp133-joint-movement-oracle.md)：
  将35个Depth-3物理缺口拆成26个同目标和9个stun竞争，并严格分离官方证据、固定模拟器假设与
  未决有限规则世界。
- [BP134 三规则世界Depth-3闭合](implementation/base-policy-kernel-bp134-depth3-move-variant.md)：
  三个显式移动世界均完整且逐根关系一致，但候选高值与历史改善反向，故只接受为完整性工具并转向
  leaf/backup价值语义分解。
- [BP135 Leaf与响应Backup归因](implementation/base-policy-kernel-bp135-leaf-backup.md)：
  排除星权重，证明攻击叶值参与假阳性，并把真实改善的漏判定位到混合敌方响应与独立行maximin的
  组合错位；下一步验证共同`2×N` StageMatrix。
- [BP136 共同StageMatrix响应错位](implementation/base-policy-kernel-bp136-response-matrix.md)：
  共享`2×N`矩阵和风险污染仍更支持历史退化，拒绝矩阵support成为动作证书并转向条件化敌方响应。
- [BP137 一步响应与结构攻击进展](implementation/base-policy-kernel-bp137-response-conditioned.md)：
  一步真实响应和近均匀OpponentModel均无法判向；严格结构进展达到零退化误报但只覆盖一半真实改善。
- [BP138 结构事件与固定叶边界](implementation/base-policy-kernel-bp138-event-deadline.md)：
  去掉ATTACK标量消除历史退化假优势，但固定depth叶无法等待未来FIRE，事件lane不能成为owner或veto。
- [BP139 严格事件horizon](implementation/base-policy-kernel-bp139-event-horizon.md)：
  正向保证开火证书在35个方向根上零覆盖，证明敌方拒绝暴露应进入Minimax价值而不是被视为证明失败。
- [BP144–BP146 真实攻击根、严格证明与ACTIVE POC](implementation/base-policy-kernel-bp144-bp146-real-attack-events.md)：
  真实弹丸归因恢复48个安全威胁/30个必杀证书，4个V2漏射严格证书的exact POC得到1正0负转换。
- [BP147–BP148 严格攻击证书调度与全部可干预根ACTIVE](implementation/base-policy-kernel-bp147-bp148-attack-certificate-scheduler.md)：
  独立盲半集零漏证、证明节点减少95.2%，22个可干预根得到6正0负和分析点`+11`；production等待固定内存证明器性能收敛。
- [BP149–BP151 生产严格证明、所有权反证与剪枝成本](implementation/base-policy-kernel-bp149-bp151-production-proof.md)：
  100根production证明逐节点等价；Discovery64证明safe-threat直接owner为负、常驻剪枝成本约收益731倍，默认保持关闭。

## 当前原则

1. `engine-v2/src` 是算法权威；历史 Candidate 和生成 bundle 只作为证据。
2. Hard 失败、严格 Proof、root restore 和弹丸生命周期不能为胜率或体积优化让步。
3. Production 压缩必须保持 source/minified 动作与语义一致。
4. 本地耗时只用于同输入相对比较，不能替代平台 3000 ms 证据。
5. simulate、publish 和 challenge 是不同权限；没有显式授权不得 publish/challenge。
- [BP152–BP155 Minimax参与率与支持恢复](implementation/base-policy-kernel-bp152-bp155-minimax-participation.md) — 解释为何高性能Minimax仍输给V1式长期控制，并固定BasePolicy incumbent＋门控战术反驳方向。
- [BP156–BP157 BasePolicy生产薄迁移](implementation/base-policy-kernel-bp156-bp157-production-migration.md) — 将BP68所有权器和动作域从诊断容器迁入production源码，保持固定16动作流完全等价并显著缩小独立组件体积。
