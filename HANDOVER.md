# 云端 Agent 交接入口

更新：2026-10-10（Asia/Shanghai）。目标仓库 skill215/agentank_client，分支 codex/v2-global-recovery。代码检查点 88fc306；本交接提交在其后。用户准备通过 ChatGPT dot 在云端继续；本文件不表示云端任务已启动。

## 当前任务与原则

改进 Minimax 调优方法，追求快速判断、快速迭代；多目标生成候选，主目标加约束筛选，新数据复核，组合单独验证。每批预设预算和退出条件，保留负结果。调优决策必须编号留痕（不是局内棋步决策）。读取 docs/implementation/optimization-decisions/fast-multi-objective-opt-p005.md。

当前生产基线不变，期望权重全局加倍已被否决。不要以通过率为目标放宽门槛，不再执行无目的百轮调参。用户本次只要求准备并push交接；收到继续实验指令后再执行下列下一步。

## 云端恢复（仓库根目录）

需要 Node 24.16.x（项目要求 >=24.16.0 <25）、Python 3.9+。新环境依赖可用 npm ci 安装；本证据恢复与台账校验不需平台账号/密钥，也不需下载对局。

```sh
npm ci --ignore-scripts --no-audit --no-fund
python3 handover/bp423/restore.py
node tools/agentank/diagnostics/optimization-decision-ledger.js verify config/experiments/optimization-decisions
```

恢复脚本检查压缩包和逐文件SHA-256，仅写回 artifacts/。已有同哈希文件跳过，不同内容拒绝覆盖；重复运行安全。包含所有38个台账事件直接引用的本地产物、完整BP422/BP423、固定版本模拟器（含其原有许可证文件）。此前批次的全部原始产物及平台对局不在包内；不要宣称拥有完整历史证据。清单见 handover/bp423/manifest.json。Git原有 artifacts/ 忽略规则保留，交接包是为本次云端接续专门选取的快照。

旧计划里的root、codeRoots及部分来源路径含旧机器绝对路径。它们是冻结证据，不修改、不重新启动已关闭run。新批次生成新计划：root使用当前仓库路径；vendor codeRoot使用恢复后的当前绝对路径；重新冻结源码哈希和输入哈希。新增交接工具可能改变工具树哈希，这是新批次应记录的变化，不要为了匹配旧哈希改写旧记录。

## 最近证据

- BP421：12张新地图×4臂48局，期望权重候选9胜/12，基线6胜/12，候选暂胜；浅搜索与组合未合格。
- BP422：8张新地图×3对手技能配置×2臂48局。基线得分13.5、死亡2；候选得分12.5、死亡8，否决全局推广。对手共用V3策略；shield和teleport技能实际动作均为0，不能声称覆盖主动技能作战。
- BP423：审核全部24对，对6组新增死亡重放双方共12局，12/12签名精确复现。6组死亡距首次共同状态分歧13—84帧，不能直接推断单步致死；其中2组从acceptable=1动作切到acceptable=0动作，hard/final gate均允许。
- 完整评审：docs/implementation/optimization-decisions/bp423-regression-review.md；场景入口：artifacts/native-causal-audit/bp423-regression-diagnosis/next-intervention-scenes.json。

## 下一步：BP424 单步因果干预（尚未执行）

先注册新OPT-D，冻结预算与判定标准。当前台账38事件，末方案/评审OPT-D-0019/OPT-R-0019；后续使用下一空闲编号，不假设没有其他Agent写入。

两个候选干预：opponent-5-shield第62帧，将候选动作3换成基线动作1；opponent-6-stun第33帧，将候选动作1换成基线动作2。帧是0起始的模拟帧，核对现有追踪后使用。仅替换这一帧，后续仍由加倍权重候选自行决策。保持初始场景、座位、事件种子一致；先核验干预前轨迹一致且替换恰好发生一次，再比较死亡、得分及工作量。

这是历史场景的因果诊断，独立新样本数为0。若有改善，还须在收益案例检查副作用、注册一般化机制、再用新地图验证，不能直接增加全局acceptable硬门槛或上线。若无改善，停止该假说并记录，不继续调权重寻找想要结果。

实现入口：tools/agentank/diagnostics/blend-regression-trace.js、opponent-skill-screen.js、factorial-method-screen.js、fresh-game-escape-adapter.js、experiment-runner.js。可参考escape-handoff-intervention.js的单帧干预方式，但先核实是发射层替换还是策略提交层替换，记录其适用范围。

## 验证与注意事项

最近完整核心测试608通过：node --test test/minimax-core/*.test.js（2026-10-10提交前）；BP423以12局签名一致性验证追踪不改变行为。交接恢复额外在干净目录验证，不把旧测试冒充新实验。

生产engine-v2/src冻结哈希：285f9863227d6af3638bed74e008f0260fd25440034d95eec5e3f8cac44d9120。

台账和其引用文件不可原地改写，修订另存版本。tools/agentank/diagnostics/quiet-search-ablation.js是保留的失败实验源码，存在已知语法错误；可执行版本是quiet-search-ablation-v2.js。不要批量修复历史证据导致哈希漂移。运行失败计预算，不自动重试，不为凑轮数加局。
