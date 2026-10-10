# Minimax深度性能标定

这条工具链只标定“同一预算能完成多少搜索”，不使用胜率作为性能门。任何修改
`ProductionDepthSearch`、`ProductionInformationSearch`、Fast/Hard/Hazard、搜索容量或runtime计费的
变更，都必须重新运行标定。

固定合同位于：

```text
config/engine-v2/minimax-depth-calibration-contract.json
```

它覆盖Physical P1–P6，以及Information root一层叠加Physical continuation P0–P5；Information分别
使用1、2、4个HiddenWorld。每个profile区分冷缓存和热缓存，默认预热一批后测量五批。

## 标准流程

修改Minimax之前：

```bash
./tools/minimax-depth-calibration.sh run
./tools/minimax-depth-calibration.sh verify --report <run-report>
./tools/minimax-depth-calibration.sh freeze --report <run-report> --name before-hp2
```

`freeze`同时写两份内容相同的基线：可清理的运行artifact，以及持久化的
`config/engine-v2/minimax-depth-baselines/<name>.json`。后续比较应优先使用持久化基线。

修改后先检查旧标定是否过期：

```bash
./tools/minimax-depth-calibration.sh status --baseline <frozen-baseline>
```

源码指纹变化时必须返回`RECALIBRATION_REQUIRED`。随后重新运行并比较：

```bash
./tools/minimax-depth-calibration.sh run
./tools/minimax-depth-calibration.sh compare \
  --baseline <before-report> \
  --candidate <after-report> \
  --output /tmp/minimax-depth-comparison.json
```

对缓存/复用组件必须优先使用同一源码消融，避免把环境漂移误判成优化：

```bash
./tools/minimax-depth-calibration.sh run --root-transitions off
./tools/minimax-depth-calibration.sh run --root-transitions on
./tools/minimax-depth-calibration.sh compare \
  --baseline <off-report> \
  --candidate <on-report> \
  --output <ablation-report>
```

报告的`features.rootTransitionSlab`记录消融状态，`rootTransitionHits`记录实际命中；
`rootTransitionReplayFailures`属于硬不变量，必须为0。RootTransitionSlab源码本身已纳入搜索源码
指纹，修改Slab而未重跑标定会返回`RECALIBRATION_REQUIRED`。

选择性深化使用同样的同源码消融：

```bash
./tools/minimax-depth-calibration.sh run --selective-continuation off
./tools/minimax-depth-calibration.sh run --selective-continuation on
```

`selectiveCompletedDepthHistogram`只表示稳定根动作已在该深度证明，不冒充完整矩阵，也不改变
`completedDepthHistogram`的含义。

## 报告解释

- `requestedCompletionPer10000`：请求深度完整完成率；
- `completedDepthHistogram`：最后完成遍历的深度，不再冒充当前值所有者；
- `valueSupportDepthHistogram`：当前发布`rootScore/rootCellScore`的严格证书深度，0表示没有
  完整值所有者；
- `valueSupportExpansionLimitHistogram`：严格值所有者使用的代表动作宽度；
- `informationRootDepthHistogram`与`physicalContinuationDepthHistogram`：防止把Physical续行冒充成
  多层Information证明；
- `cold/warm.p95Micros`：冷/热缓存成本；
- `cold/warm.p95Nodes`：节点预算消耗；
- `cold/warm.meanNodes`：对早停、选择性深化等优化更敏感的平均节点；
- `exactOwnerEarlyAborts`：已有精确值后，因深层support损失而停止的非所有权尝试；
- `warmColdSemanticMismatches`：同一输入、双方support完整且完成深度相同时，缓存前后值不同；必须为0；
- `cacheDepthGainHistogram`：热缓存让同一预算多完成或少完成的深度。多完成不算语义错误；
- `rootRestoreFailures/rootRestoreMismatches/hotAllocations`：全部必须为0。

比较还要求固定合同、16个场景的内容指纹、标定器指纹、Node/CPU环境全部一致；任何一项变化都拒绝
生成性能结论。`status`会同时检查搜索源码与标定器自身，任一变化都返回
`RECALIBRATION_REQUIRED`。

完成深度、节点和耗时是性能结果；W/L/D、击毁和星数不属于这份报告。决策强度应在冻结性能profile后
另行验证。

当前HP2成对基线：

```text
config/engine-v2/minimax-depth-baselines/before-hp2-final.json
config/engine-v2/minimax-depth-baselines/after-hp2.json
```

HP3缓存感知计费完成后的当前基线：

```text
config/engine-v2/minimax-depth-baselines/after-hp3.json
```

HP2到HP3保持合同、16场景、harness和Node环境不变。Physical P2–P6的冷P95节点从250提高到
512；P2冷P95耗时由651us变为646us。P3–P6的宽root仍只发布P1/P2，说明新增节点已经可用，
但下一深度受joint-action规模限制。生产窄接触fixture则使用436节点完整发布P3并尝试P4。
Information各profile的节点与深度分布保持不变。全部标定不变量为0。

机器对比位于：

```text
artifacts/benchmarks/minimax-depth-calibration/hp2-to-hp3-comparison.json
```

HP4根转移复用完成后的当前基线：

```text
config/engine-v2/minimax-depth-baselines/after-hp4.json
```

HP4采用同源码ON/OFF消融。Physical P1–P6 cold P95分别从
`468/623/1180/1044/1055/1052us`降至`356/591/999/993/1000/1013us`，warm P95从
`424/706/1116/1142/1131/1123us`降至`196/566/936/942/939/949us`。固定节点预算下
完成深度分布保持不变；生产接触root在相同39,044 work上限下从436节点提高到493节点。
Information隐藏世界不接入该Slab，因为首轮消融证明它几乎不命中且多数profile变慢。
最终值语义、根恢复、热分配和回放校验错误均为0。机器对比位于：

```text
artifacts/benchmarks/minimax-depth-calibration/hp4-root-transition-ablation-final.json
```

HP5浅层区间合同完成后的当前基线：

```text
config/engine-v2/minimax-depth-baselines/after-hp5.json
```

HP5为每个根cell、我方行和整个根保存sound lower/upper。完整支持收敛为`[v,v]`；未访问、Fast
不支持或Hard incomplete保持`[-32000,32000]`。完整性使用稀疏异常标记：正常cell沿用既有
`iterationCellScore`访问事实，不在递归热帧传播额外complete状态。

相对HP4，Physical P1–P6 cold P95从`356/591/999/993/1000/1013us`变为
`355/622/1026/1018/1018/1018us`，warm P95从`196/566/936/942/939/949us`变为
`208/552/958/980/953/991us`。所有profile均在110%护栏内，节点与完成深度分布不变。运行报告：

```text
artifacts/benchmarks/minimax-depth-calibration/runs/7e0969bfcbbac8e65e6e7e3917b701004dc3fa7f6b43a90e8512fafecec1d38b/report.json
```

HP6选择性深化完成后的当前基线：

```text
config/engine-v2/minimax-depth-baselines/after-hp6.json
```

最终同源码OFF/ON报告的源码指纹均为
`95e135aca0d447e0d66bd91d3726b6ce19c3edda39588465716b17540ee3b176`。P1/P2不进入选择性路径；
P3在40/80次调用中证明depth-3稳定动作，冷/热节点中位数分别从512降至418和243。P3冷/热P95
耗时从1050/972us降至1012/534us。Information profile不使用该开关，其墙钟变化用于识别同机
负载漂移，不归因于HP6。机器对比位于：

```text
artifacts/benchmarks/minimax-depth-calibration/hp6-selective-continuation-final.json
```

HP7共享ThreatLattice完成后的当前基线：

```text
config/engine-v2/minimax-depth-baselines/after-hp7.json
```

最终报告为：

```text
artifacts/benchmarks/minimax-depth-calibration/runs/bfe255250979858bf1d1f80be157604ab99d39ad67add0972e1179041a4e3b3b/report.json
```

节点数、请求深度、完整深度、选择性证书分布和全部语义不变量相对HP6保持不变。HP7期间同一机器的
重复标定出现明显墙钟漂移，因此跨时报告只证明搜索规模没有变化，不用来声称HP7墙钟收益。HP7的
阶段性能证据使用同一进程、五批测量的ThreatLattice专用对照：真实Hard/Safety/EO流水线的重复
反向构建节点从149,704降至53,080（-64.54%），语义差异和声明热分配均为0。报告位于：

```text
artifacts/benchmarks/threat-lattice-sharing/hp7.json
```

HP6到HP7标定结构对比位于：

```text
artifacts/benchmarks/minimax-depth-calibration/hp6-to-hp7-comparison.json
```

HP8精确Successor-TT program ordering完成后的当前基线：

```text
config/engine-v2/minimax-depth-baselines/after-hp8-final.json
```

标定器新增同源码开关：

```bash
./tools/minimax-depth-calibration.sh run --successor-tt-pv off
./tools/minimax-depth-calibration.sh run --successor-tt-pv on
```

最终OFF/ON报告分别为：

```text
artifacts/benchmarks/minimax-depth-calibration/runs/9cc739c52783e8b5b0c8fdfdf10f26a6925e9a2338f7a76b410fc9c11ddc01fd/report.json
artifacts/benchmarks/minimax-depth-calibration/runs/af64d90bf6029cb639dbe39506f47a92ba9c65aaacbb781b9c74fcdd8627f8f5/report.json
```

两份报告的源码指纹均为
`de220dc04f901dc8e684f40bb9d698aa0a96ba3dd61eef416ad9782ee0e1288f`。标准16场景各profile的
节点、请求完成率和完整深度直方图不变；墙钟变化有正有负，不能从标准独立root标定归因于跨帧
复用。对比报告为：

```text
artifacts/benchmarks/minimax-depth-calibration/hp8-successor-tt-pv-final.json
```

HP8的阶段性能结论来自专门的实际后继基准：先搜索父root、提交实际动作、应用一个真实joint
successor，再搜索精确后继。16个fixture中，OFF/ON节点为5,651/5,573（-1.38%），P95为
300.12/272.91us（-9.07%），语义差异、根层PV提升、root restore和容量溢出均为0。报告为：

```text
artifacts/benchmarks/cross-frame-pv/hp8.json
```

上一帧完整根PV排序单独消融为负（节点+3.45%），所以production只观察该证据，不用它排序根；
默认启用的只有exact、complete、较低深度Successor-TT程序在深层子树内的访问顺序。以后修改
PV身份、TT program打包、RootTransitionSlab容量或失效条件，都必须重跑标准标定和该实际后继基准。

## HP9 runtime work标定

HP9把“深度/节点性能”与“整局何时fallback”接成两条可重复工具链。先采集五个独立批次：

```bash
./tools/runtime-schedule-poc.sh \
  --profiles CURRENT --role DISCOVERY --scenarios 8 \
  --capture-work-ledger true --capture-phase-timing true \
  --output /tmp/runtime-work-batch-N.json

./tools/runtime-work-calibration.sh \
  --inputs /tmp/runtime-work-batch-1.json,/tmp/runtime-work-batch-2.json,/tmp/runtime-work-batch-3.json,/tmp/runtime-work-batch-4.json,/tmp/runtime-work-batch-5.json \
  --output artifacts/benchmarks/runtime-work-calibration/hp9-local.json
```

计时使用exclusive阶段时间，避免Fast/Hard/Information等嵌套阶段重复收费。ReverseViability把
cache hit和实际lattice build分开；StageMatrix按真实solver iteration收费。标定结果必须是正整数，
128帧固定ROOT+EMITTER不得单独越过degraded门。它只产生本地微秒等价量，不改变平台3000ms证据。

应用work charge后，必须用同一8场景旧/新报告、16场景开发和不重叠32场景验证生成资格报告：

```bash
./tools/runtime-work-qualification.sh \
  --calibration artifacts/benchmarks/runtime-work-calibration/hp9-local.json \
  --baseline <old-8-scenario-report> \
  --development <new-8-scenario-report> \
  --support <new-16-scenario-report> \
  --validation <new-independent-32-scenario-report> \
  --output artifacts/benchmarks/runtime-work-calibration/hp9-qualification.json
```

本地资格要求：搜索帧、节点、首次fallback和emergency同时改善；8/16/32场景的每个搜索帧必须只
发布完整迭代；Hard/Risk支配/root restore/hot allocation全部为0；同输入开发集总耗时与最大局P95
均不得超过旧profile的110%。当前状态为`PASS_LOCAL`，但`releaseCalibrated=false`和
`PLATFORM_RUNTIME_SCALE_PENDING`必须保留。

修改work accounting后的标准深度基线为：

```text
config/engine-v2/minimax-depth-baselines/after-hp9.json
```

对应24-profile报告为：

```text
artifacts/benchmarks/minimax-depth-calibration/hp9-runtime-work.json
```

HP9完成后，任何决策强度改动都属于HP10；不得因胜率结果反向修改这份性能标定。若Minimax、Fast、
Hard、runtime计费或profile再次变化，先用`status`得到`RECALIBRATION_REQUIRED`，再完整重跑。

## HP10–HP11 精确值所有权

当前基线：

```text
config/engine-v2/minimax-depth-baselines/after-hp11-final.json
```

HP10发现更深但不完整的迭代会覆盖浅层精确值，同时旧support证书没有检查Fast/Hard incomplete。
HP11把遍历深度与值所有者深度拆开，直接调度先建立full-width P1，再尝试full-width P2；深层首次
出现support损失后，在保留Successor-TT principal的前提下提前停止。

固定16根、每profile 80次调用中，P2–P6严格支持从25%提高到93.75%：40次由P2拥有，35次回退
P1，5次同格移动争用保持未知。P2 cold P95节点512→489、P95时间1606→1486us；P3 cold
P50节点512→305、P95时间2583→1490us。全部restore、replay、cache语义和热分配不变量为0。
完整结论见[HP10–HP11实施记录](implementation/hp10-hp11-minimax-value-ownership.md)。

## HP12 Consumer-aware Information调度

当前基线：

```text
config/engine-v2/minimax-depth-baselines/after-hp12.json
```

HP12不改变24-profile搜索函数的节点、深度或值支持。它在ProductionRoot调度层停止默认运行没有
消费者的近似Information值：固定32局的1,282次调用全部support incomplete，且Risk/StageMatrix
禁止其取得动作所有权。旧路径保留为`LEGACY_INFORMATION_EVIDENCE`诊断profile。

同源码A/B中match work下降39.9%、Emergency 397→0，Physical搜索帧32→73、完整值所有者
32→70；paired正负转换各1，游戏结果分类为中性。24-profile重新标定的所有结构分布与HP11一致，
全部不变量为0。完整结论见
[HP12实施记录](implementation/hp12-consumer-aware-information-schedule.md)。
