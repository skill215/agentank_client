# V1/V2 精确脚本成对失败诊断

状态：`DIAGNOSTIC_COMPLETE / STRUCTURAL_GAPS_CONFIRMED / NO_CORE_FIX_APPLIED`，2026-07-17。

## 1. 结论

可以直接让冻结 V1 与冻结 V2 Candidate 在简化模拟平台对战，而且本轮已经完成全量实验。244 个历史场景分别保留地图、双方初始位置、初始方向、历史星坐标和最早生成帧；每个场景运行两个确定性 seed，并执行原技能换边与技能交叉换边四格，共 1,952 场精确脚本对战。

V2 原生 poison 对 V1 stun 为 315 胜、661 负，胜率 32.27%。V2 在两个出生位的原生胜率分别为 31.96% 和 32.58%，出生位差异只有 0.62 个百分点。488 个原生换边对中，V2 双胜 55 对、双败 228 对、一胜一负 205 对；其中 67/244 个历史场景在两个 seed、两个出生位下都双败。当前主要问题不是单一出生位或单张地图。

诊断确认四个结构性缺口：生产路径没有接入 PersistentPlan；InformationState 不进入深层搜索；严格 ForcedWin 根只展开一帧；work-unit fallback 没有被平台 3 秒证据校准。它们必须在下一 Candidate 前闭合，不能通过修改几个分数或为具体地图打补丁解决。

## 2. 实验身份与可重复性

| 项目 | 冻结值 |
|---|---|
| Candidate | `imp8-v2-a5ce6f8ef59abb61` |
| Candidate fingerprint | `48c2e5c49fb4beb9d2e0726a250b5694db999337551351f5cfe9f30a8383f67a` |
| V1 script SHA-256 | `8da68843a292c6a6230a32baf60392916f9fb85aaa5d9a94feac7085ddc9e82e` |
| V2 minified SHA-256 | `45a96d1c4c7a2b5ae7957a2c7813fa1cc2840a9d1937f164e5df3fb982d2eea4` |
| DD9 assignment | `46bd2d93615c77d4b87206670d7fb39621cbf8420a0c22fb839d664085ae29c8` |
| 场景数 | 244；其中地图/出生组合 238 个唯一值 |
| 精确对战 | 244 × 2 repetitions × 4 variants = 1,952 |
| 失败 trace | 24 个分层代表局 |
| Exact report fingerprint | `222990b718649f1612b8541fbfacbf869f41b6a70699837857dada0daa206e32` |
| Diagnostic fingerprint | `08ceaa97be7f7cbb33bf919024da111841a42a4035e470cbdf4d09a4f09acd3e` |

精确通道把两份冻结脚本都载入隔离 VM。脚本预编译结果可以复用，但每局创建新的 context、脚本全局状态、动作队列和模拟器；不并行运行，因为 V1 会读取 `Date.now()`，CPU 争用会改变其 runtime fallback 和 128 帧 tiebreak。每局结果立即追加到带 RunContext 指纹的 JSONL journal，中断后只允许同 Candidate、同 V1/V2 hash、同场景和同模拟器版本续跑。

诊断镜像只重跑 24 个原生失败代表局，保存 Hard、InformationState、Proof、完成深度、runtime mode、候选动作分数、输入子弹/炸弹和死亡前六帧。24/24 的精确脚本与镜像胜负、终局原因一致，mirror divergence 为 0。

完整机器证据位于 [failure-diagnostic-report.json](../../artifacts/diagnostics/v1-v2/imp8-v2-a5ce6f8ef59abb61/v1_v2_exact_paired_failure_diagnostic_v1/failure-diagnostic-report.json)，全量逐局结果位于 [exact-match-report.json](../../artifacts/diagnostics/v1-v2/imp8-v2-a5ce6f8ef59abb61/v1_v2_exact_paired_failure_diagnostic_v1/exact-match-report.json)。

## 3. 对战结果

| 分组 | 对局 | V2 胜 | V2 负 | 胜率 |
|---|---:|---:|---:|---:|
| 原生：V1 stun / V2 poison | 976 | 315 | 661 | 32.27% |
| 技能交叉 | 976 | 416 | 560 | 42.62% |
| 合计 | 1,952 | 731 | 1,221 | 37.44% |

技能交叉不能解释为“V2 使用 stun 更强”。冻结 V2 是 poison 专门化代码，获得 stun 时不会自动变成完整 stun 策略；同时 V1 失去了自己的 stun。该分组只用于检查技能依赖和换位稳定性，不能进入 V2 poison 发布胜率。

原生重复稳定性较低：488 个“历史场景 + variant”组中，221 组两次签名完全相同，173 组直接改变胜负，94 组胜负相同但终局原因或死亡类别变化。技能交叉则有 487/488 组稳定。原生 stun/poison 交互下只跑单 seed 会产生严重抽样偏差。

## 4. 原生失败结构

661 次原生失败分为：

- 515 次敌方弹道/碰撞类死亡，占 77.91%；
- 20 次炸弹死亡，占 3.03%；
- 126 次 128 帧非击毁失败，占 19.06%。

失败帧分布为早期 13、中期 306、后期 211、128 帧区间 131。V2 精确脚本本地 VM timeout/error 均为 0；V1 原生出现 2 次本地 callback timeout。该事实只说明脚本在本地 200ms callback 限制内运行，不覆盖平台整局 3 秒。

### 4.1 炸弹：缺少跨帧逃生 obligation

24 个 trace 中有 14 个炸弹失败：12 个直接死于 V2 自己的炸弹，2 个死于敌方炸弹；13 个样本在死亡前观察到 V2 自己放置炸弹。

自放炸弹时信息完整，Hard 均为 `ALLOW`，通常只完成 1–2 层搜索；爆炸约在 10 帧后，当前深度无法看到终点。多个样本中 `THROW_BOMB` 只比 `FIRE` 高 100 分，选择后没有物化带爆炸 deadline、危险实体依赖和逃生走廊的 PersistentPlan。直到最后几帧，动作集合才收缩为一个动作或全部 `REJECT_PROVEN`。

代码结构与 trace 一致：[production-root.js](../../engine-v2/src/runtime/production-root.js) 的 `bombUtility` 和 `planProgress` 是即时启发式；[plan.js](../../engine-v2/src/policy/plan.js) 已有 `PersistentPlanArena`，但生产决策路径没有调用 `createActionSketch`、`materialize` 或 `validateContinuation`。Plan 目前只在构建 fixture 中被演示。

修复方向不是全局降低炸弹分数，而是：放置前用现有 HazardKernel reverse viability 检查爆炸 deadline 的安全可达性；无路径时 Hard 拒绝放置；有路径时物化 `BombEscape` obligation，并在每帧 action 打分前验证 action 是否仍位于可行逃生链中。该状态和反向可达表必须缓存到炸弹失效。

### 4.2 子弹：已提交威胁和潜在开火必须分开

8 个弹道代表失败全部确认由敌方子弹命中：

- 4 个子弹在死亡前已经飞行 2 帧，属于 committed threat；
- 4 个敌方在死亡同帧才开火，决策前不存在实体子弹，属于 possible fire risk。

已在途子弹的部分样本到死亡帧才变成全动作必死，而前一帧仍有 5–6 个 Hard 可行动作，且常处于 InformationState、完成深度 0。HazardKernel 已实现时间索引轨迹和 `reverseViable`，但生产 Plan 没有保存“上一帧必须继续沿这条逃生链”的 obligation。还需要用 Fast/Reference 与模拟器逐帧差分确认观察/移动 phase；在差分闭合前不能直接修改物理规则。

同帧潜在开火不能作为 Hard 必死。它应进入 EnemyAction/HiddenWorld 上的 ε-contamination robust backup，由风险偏好、对手开火模型、位置价值和抢先开火收益共同决定。当前 V2 原生动作中 `GO` 占 67.73%、`FIRE` 占 6.16%；V1 分别为 47.97% 和 8.57%。这与暴露在枪线中持续前进的样本方向一致，但动作频率本身不构成因果证明。

### 4.3 InformationState：设计存在，生产深搜未接入

24 个死亡窗口中有 12 个进入 InformationState，7 个出现完成深度 0。[production-root.js](../../engine-v2/src/runtime/production-root.js) 只有在 `informationComplete` 时构造严格 SearchEngine 根；普通 ProductionDepthSearch 又要求 `enemyVisible`。隐藏或观测不完整时，两条深搜都跳过，最终只使用单步 `possibleRisk + actionScore`。

[risk.js](../../engine-v2/src/search/risk.js) 的整数 ε-contamination kernel 和通用 InformationGraph 已存在，但生产 root 没有生成 HiddenWorld、EnemyAction、ChanceOutcome 的递归图。因此“SearchState = PhysicalState | InformationState”目前只完成了底层组件，没有完成生产接线。

### 4.4 ForcedWin：当前只是单帧严格矩阵

[tank-root-adapter.js](../../engine-v2/src/search/tank-root-adapter.js) 会枚举当前一帧的我方动作、敌方动作和 stun chance，但非终局结果直接落到 ordinary leaf，没有递归扩展 InformationState AND/OR proof。Frozen G10A 中 ForcedWin 计数为 0。直接获胜 Hard 优先级仍保留，但多步强制胜利链尚未实现。

### 4.5 128 帧与 runtime

126 次原生 frameLimit 失败中，75 次 V2 星更少；51 次同星，而这 51 次 V2 本机累计耗时全部高于 V1。V2 在 frameLimit 获胜的 142 局全部星更多，说明本地终局比较方向与“同星默认我方耗时更多”的设计假设一致。

所有 1,952 局中，V2 每局本机 P95 为 887,988 微秒，V1 为 561,326 微秒；原生累计 V2/V1 约为 1.53。绝对本机时间不能映射到平台时间，但方向与官方 cold-smoke 在 3012ms timeout 一致。Frozen G10A 中 10.15% 决策进入 fallback mode，emergency action 为 0；当前 work-unit 阈值没有在平台超时前提供足够降级，必须生成新 Candidate 校准，不能重试旧 hash 或原地改 D3。

## 5. V2 已确认的优点

- 精确脚本本地 error/timeout 为 0，24 个诊断镜像与精确结果完全一致；
- G10A 的 avoidable Hard reject、root restore failure、hot allocation 均为 0；
- 两个出生位胜率接近，结果不是依赖单边出生优势；
- Projectile/Bomb 实体、时间索引 Hazard、ReverseViability、整数 Risk、固定数组和缓存底座已经存在；问题主要在生产编排接线，而不是必须推翻底层结构。

## 6. 下一轮结构性修复顺序

本轮没有修改 V2 核心。建议用户 review 后按以下顺序进入新 Candidate 周期：

1. 先冻结性能合同：为 HiddenWorld 上限、Plan 验证、reverse viability cache、每 callback work 和完整对局设预算；保持生产热路径零临时对象。
2. 接通 PersistentPlan：优先实现 `BombEscape` 与 `ProjectileEscape` obligation、deadline、实体 generation 依赖、缓存和失效，不添加坐标/对手/帧数补丁。
3. 接通 InformationState root：严格分开 EnemyAction、HiddenWorld、ChanceOutcome，使用有界支持和整数 robust backup；隐藏世界不足时返回区间，不伪造完整概率。
4. 把 ForcedWin 扩展为有预算的 InformationState AND/OR proof；任何证明不完整都不能触发强制胜利。
5. 用官方 3012ms 证据预注册新的 runtime 候选矩阵，降低深度/节点/矩阵预算或更早进入 fallback/emergency；旧 Candidate 永久保持失败身份。
6. 在新的 Discovery/Calibration split 上比较风险、Path/GO、Fire、Poison 和 terminal 策略；本报告已经观察过原 DD9 三类数据，不能继续把它们当新 Candidate 的盲 Frozen 集。

## 7. 证据边界

模拟器固定为 `cyhhao/agentank-simulator@1ef804e…`。已知 bomb phase、poison 冷却/持续、同帧 terminal 和平台 runtime 模型并非完全等价。本报告属于 `DISCOVERY`，可以定位生产接线缺口和生成下一候选假设，不能升级为官方规则真值、发布验收或新 Frozen 分母。

重复命令：

```text
./tools/v1-v2-diagnostic.sh
./tools/v1-v2-diagnostic.sh --limit 2 --repetitions 2 --max-traces 4 --output /tmp/v1-v2-probe
./tools/v1-v2-diagnostic.sh --limit 8 --repetitions 4 --max-traces 8 \
  --progress-every 8 --output /tmp/v1-v2-repeat-4
```

脚本会分别输出 exact 与 trace 阶段的百分比、已用时间、每秒处理量、ETA，
以及 `new`/`resumed` 累计数量。同一输入和输出目录可安全续跑；修改重复次数、
场景范围，或要求真正从零复跑时应使用新的输出目录。

相同 RunContext 会复用逐局 journal；Candidate、脚本 hash、场景、重复数或模拟器版本变化时 fail closed，必须使用新的输出目录。
