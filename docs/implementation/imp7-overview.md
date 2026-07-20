# IMP7 动态历史、窗口、双轨与双向反事实 Overview

状态：`G5_G6_PASS / ACCEPTED / IMP8_ELIGIBLE / RELEASE_NOT_READY`，2026-07-16。

本 Overview 记录[实施计划](../design/implementation-plan.md)中 IMP7 的实现与验收结果。IMP7 是离线证据系统，不进入tank production bundle，也没有进行平台请求、simulate、publish或challenge。

## 0. 验收结论

执行链为：

```text
./tools/imp7-toolchain.sh verify
./tools/wsl-node.sh tools/agentank/cli/implementation-ops.js accept --stage IMP7
```

`A7-01`至`A7-09`全部PASS，最终203/203测试通过。最终Gate fingerprint为`e4aac566feccfa64e4cc7df7d6d8f7e1a805a916cb6ef8ec8517c4f0cda624f8`；Acceptance fingerprint为`06d20f83ae3b00a05c49e66bd5c9b972fd9fc7ad98cd1f44b74a8bbccbe7ddf3`。

current报告位于[imp7-acceptance-report.json](../../artifacts/reports/acceptance/IMP7/imp7-acceptance-report.json)，不可变报告为[imp7-acceptance-06d20f83ae3b00a05c49e66bd5c9b972fd9fc7ad98cd1f44b74a8bbccbe7ddf3.json](../../artifacts/reports/acceptance/IMP7/history/imp7-acceptance-06d20f83ae3b00a05c49e66bd5c9b972fd9fc7ad98cd1f44b74a8bbccbe7ddf3.json)。两者SHA-256相同：`3fb2ffdeedb596757aa2d69efd06e2e91cdd759f5ce9437c5ec4b33896260553`。

## 1. 动态Ledger与不可变证据

- 导入器扫描所有合法`all-<count>-*`聚合目录，按manifest中的实际唯一match数与生成时间选择当前源，不含固定244、266或未来总数常量；
- 当前一次观测选择`all-266-20260716-1505-cst`，账本含266个唯一v1 match；这只是本次Snapshot分母，不是协议常量；v2当前为0并保留独立空Snapshot，不能借用v1分母；
- 每个entry保存profile、双方seat/code、raw result spelling、terminal分类、skill provenance以及summary/events/raw的bytes和SHA-256；提交前逐文件存在性、JSON、hash、双主键和entry hash校验；
- 相同urlId/replayHash/artifact为幂等duplicate；同键不同artifact、部分下载、非法schema或来源冲突均在水位推进前失败；迟到match只追加，不重排旧sequence；
- `CorpusPolicy`冻结1,800,000ms session gap与3,600,000ms allowed lateness；rolling session key为subject code、opponent tank与opponent code，关闭后生成稳定CohortAssignment；当前22个post-legacy match形成11个关闭cohort；
- current head、v1/v2 Snapshot和analysis另有内容寻址history。当前Head fingerprint为`499c45d04fc2d8926d64a922e75d7d3906c168866247accd41bdc51a4af15612`，v1 Snapshot fingerprint为`6a505245c7dcc52a6f6671f7183fd2c27d0be673e1b8609f39bb01755de31445`。

`LEGACY-244-20260715.1`没有被滚动分组重写。732个raw/events/summary文件按冻结编码重新计算后仍得到artifact root `c985073623505f9a463d97ca410fffea35e0ff5206593257bbfb7d1f65718f9a`；historical regression和split fingerprint也继续由DD9 manifest保护。

## 2. Skill与Terminal provenance

- 我方skill只有精确codeHash对应baseline manifest或本局观察到cast时才登记；敌方只有本局cast才登记`OBSERVED_CAST`；
- “没有施法”没有被解释为`none`。当前82局敌方skill保持`UNKNOWN`，不会进入某技能的严格胜负率分母；
- runtime缺失保存`null`，不写0；`resultReasonRaw`保留平台原拼写；terminal分类同时检查record count、crash events、winner、stars和runtime；
- 当前266局分类为223 SINGLE_CRASH、14 MUTUAL_CRASH_STAR、15 FRAME_LIMIT_STAR、10 RUNTIME_TIMEOUT、1 MUTUAL_CRASH_RUNTIME、2 FRAME_LIMIT_RUNTIME、1 SCRIPT_ERROR；11个基础设施/性能失败先于战术归因单列。

## 3. L0–L4与正反窗口

本次Snapshot覆盖12,587 replay frames，生成748个Failure/PositiveWindow以及1,496个双方视角反事实结果：

```text
L0 artifact/schema       266
L1 terminal/provenance   266
L2 Truth/Observed track  266
L3 windows/metrics       748
L4 side perspectives    1496
```

窗口包含Failure、Kill、Escape、BombEscape、SkillValue、TerminalTrade、StarDeadline与PerformanceHot；事件指标使用整数计数moves、turns、fires、bombs、skills、stars和crashes。projectile/bomb失败窗口从可识别的创建事件反推，不把所有死亡机械裁成“最后4帧”；timeout/error则从frame 0归为可靠性链。

正向保护以同一Snapshot作为当前baseline/candidate自检，并有删除Kill窗口的负向fixture证明Gate会失败。后续安全修改必须同时报告死亡窗口改善与Kill/Escape/Bomb/Skill/Endgame保护，不能只优化“少死”。

## 4. Truth/Observed与双方反事实

- 离线重建使用预分配整数TypedArray保存Truth签名和双方各自Observed签名、unknown/provenance mask；当前临时track总量402,784 bytes，热循环无每帧对象状态树；
- policy入口只接受带`trackKind=OBSERVED`的只读视图；TruthTrack对象会被拒绝。隐藏Truth改变但某一方Observed不变时，其动作必须不变；
- causal signature首次分叉后，`historicalSuffixConsumedFrames`永久为0，不用真实后缀偷看未来；
- 同一checkpoint按完全相同的`EXISTS own / FOR_ALL enemy / FOR_ALL hidden / FOR_ALL support chance / strategy-consistent observation`量词分别控制双方；矩阵“每行选择不同敌方列”的陷阱fixture保持UNKNOWN；
- 只有support、observation、rule完整且assumption mask为0时才调用IMP4 Coverage Proof并允许`ROBUST_AVOIDABLE`或`STRICT_UNAVOIDABLE`。

现有历史没有保存当时每帧完整public input，且大量历史v1 code只有replay support。因此本次1,496个严格标签全部为`UNKNOWN`。这是有意的证据边界：窗口仍可用于发现弱点和生成fixture，但不能声称已证明某次死亡必然或可避免。

## 5. 性能与production边界

- IMP7全量扫描、三artifact rehash、12,587帧重建和报告生成约为十几秒量级的离线任务，不占平台3秒callback预算；
- 双轨内部使用uint32/uint16列式数组，概率、分数和指标不使用float语义数组；
- production isolation审计确认`engine-v2/src`不包含Ledger、TruthTrack、历史窗口、反事实或battle-records依赖；
- 可重复入口统一为`./tools/imp7-toolchain.sh test|verify`，不需要每次手工重写下载或分析步骤。

## 6. 下一阶段与边界

IMP8已获准入。下一步只能使用Discovery提出候选，再由Calibration选择risk/weights/search/cache/runtime参数，并冻结Candidate、Snapshot和TestPlan；v1历史与窗口不能直接调优Frozen或Forward结果。

release仍被三项阻塞：`PLATFORM_ENGINE_UNKNOWN`、`PLATFORM_SCRIPT_BYTE_LIMIT_UNKNOWN`、`PLATFORM_RUNTIME_CALIBRATION_PENDING`。此外，v2当前历史分母为0；在IMP9预注册ForwardBatch前，任何新增且已查看结果的v2对局只能成为Discovery，不能冒充前向验证。
