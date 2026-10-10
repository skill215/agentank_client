# BP408 可执行实验流程

后续优化通过 `npm run experiment -- …` 运行。BP407 的控制器现在由逐局执行器实际调用。历史 BP399–BP407 的协议、产物及百轮脚本保留用于复现；本入口用于新项目，不能自动约束绕过入口直接调用的历史脚本。

## 操作顺序

```sh
npm run experiment -- init config/experiments/bp408-quality-start.json artifacts/my-new-experiment
npm run experiment -- run artifacts/my-new-experiment
npm run experiment -- status artifacts/my-new-experiment
npm run experiment -- review artifacts/my-new-experiment review.json
```

`init` 只允许新目录，冻结协议、候选登记、批次和文件哈希。`run` 至多执行一个批次；批次最多 10 轮，全项目最多 100 轮。每批结束进入 `NEEDS_REVIEW`，重复运行不会继续派发。评估可由分析脚本或代理生成，不要求额外人工审批；但必须依据预先声明的规则提供理由和可追溯证据。

当前起始计划没有获准质量候选，也没有新的独立地图，所以执行会返回 `STOP_NO_CANDIDATES`，不启动任何对局。只有完成机制诊断、登记可证伪候选、补齐数据和精度方案后，才创建新的实验计划。

## 协议格式

- `version: 1`；`root` 可省略，默认当前仓库；`adapter` 指向单局适配器。
- `objective` 必填 `question/metric/minimumEffect/evaluationRule/stopRule/independentUnit`。用实际指标和停止阈值，不能事后改标准。
- `governor` 保存质量/性能轨道、SCREENING/CONFIRMATION 阶段、预算、活动候选、机制证据和样本精度计划。确认阶段须带冻结候选名单。
- `candidates` 的每项包括 `id/mechanism/falsifier/evidence`。证据文件必须列入 `inputs`，提供实际 SHA256。
- `inputs: [{path,sha256}]` 固定数据、候选代码和证据。适配器通过 `readFrozen` 读取声明输入。
- `codeRoots` 可增加需要冻结的依赖目录。本地原生适配器自动冻结 V2/V3 源码、Agentank 工具、模拟器目录及包清单。自定义适配器须明确列全依赖目录。
- `batches` 固定批次顺序；每项包含 `id/kind/rounds`，`kind` 为 `optimization` 或 `measurement`。
- 每轮包含 `id/jobs`。单局包含 `id/candidate/kind/independentUnit/timeoutSeconds/payload`。`candidate: null` 表示公共对照；候选专用对照及预热必须绑定候选 ID，淘汰时才能一并省去。
- 任务类型为 `candidate/control/warmup/preflight/measurement`。一个任务恰好一局，不允许适配器隐藏重试或额外预热。所有种子、座位、预热、对照都提前列成任务。

同一地图的两侧座位、不同种子必须使用同一个 `independentUnit`。准入时用冻结任务中实际列出的不同候选地图数限制样本计划，不能仅靠自报 `availableIndependentUnits` 放行。这个检查验证去重记账，不能证明地图来自新的独立分布；数据来源仍需可审计的外部证据。

## 逐局预算与故障处理

派发前检查整批成本。游戏局数和轮数先持久化预留，再启动工作进程；失败、超时仍占用预算。每局在独立进程运行，时间上限取任务时限与项目剩余时间的较小值，超时强制终止进程组。计时包括工作进程启动和调度期间的输入检查，不把跨次调用之间的空闲时间记为计算消耗。

初始化和评估检查也计入实际时间。外部统计分析耗时通过评估文件的 `analysisSeconds` 显式入账；该值需依据分析日志填写，执行器无法自动测量其进程之外的工作。

工作进程必须返回 `games: 1` 和明确的 `integrityPassed/safetyPassed`，否则立即停止后续任务。原生适配器的安全检查仅覆盖执行健康，不能替代质量实验的死亡率约束。单局原生/VM回放带完整动作签名与模拟器身份；它本身不提供正式性能确认协议。跨进程的预热任务不能替下一进程预热，正式性能实验需独立设计适合该执行方式的测量。

任务结果、预留记录和事件哈希链保存在运行目录。工作进程失败或未完成的记录不自动重试。中断恢复会保守扣除未完成任务的全部预留时间，并返回 `STOP_INTERRUPTED`；应先复核已消耗工作再另立恢复协议。不要删除记录重跑来隐藏成本。

`.lock` 阻止并发写入。父进程异常退出可能留下锁；先核实记录中的 PID 和工作进程确已退出，再处理锁。普通重复调用不能绕过评估，也不会重复执行已预留任务。状态以临时文件写入、fsync 后原子替换；这不是防恶意篡改系统或断电恢复数据库。

## 批次评估

评估文件示例：

```json
{
  "batchDigest": "status 输出中的当前批次摘要",
  "decision": "retire",
  "analysisSeconds": 2.5,
  "retire": ["candidate-id"],
  "reason": "依据冻结阈值，主要指标没有达到最低实际收益；完整数据见证据文件。",
  "evidence": [{"path": "artifacts/my-new-experiment/batch-analysis.json", "sha256": "文件实际 SHA256"}]
}
```

决策为 `retain/retire/improve/rollback/stop`：

- 保留：进入下一冻结批次。
- 淘汰：移除对应候选及其后续任务，最后一个候选淘汰后立即结束，不补基线局数。
- 改进：结束当前协议，记录失效机制，再以新协议表达修改后的假设。
- 退回：结束当前协议，保留原生产基线。本流程没有自动部署，因此无需覆盖生产文件。
- 停止：结束该项目。

确认阶段允许继续固定样本或停止/退回，禁止淘汰、改参和自适应追加。启动确认前预留全部剩余确认任务的局数和最长执行时间。完成后即使预算正好用尽，也允许评估固定结果。

每份评估绑定完整批次摘要和证据哈希；评估前重查所有持久化结果，拒绝过期评估和被改写的负结果。评估内容应至少给出：有效配对地图数、主要指标与区间、预注册最低收益、安全变化、实际资源消耗，以及保留/改进/退回/停止的原因。执行器强制留证和阶段约束，不声称能自动判断理由的科学有效性。

## 验证

`npm run test:experiment-flow` 覆盖实际子进程运行、强制超时、失败计账、整批和确认预算、每批评估、输入/协议/结果漂移、候选淘汰、空集合停止、重复地图、并发锁和中断恢复。BP408 另用 1 局历史基线完整回放验证原生适配器；这是流程验收，不计优化轮数和策略成功率。

本次验证结果：核心回归 **578/578 通过**（新增 17 项）；原生回放完整签名一致，重复调用没有多派发任务；当前质量起始计划停止在 0 局。仅新增 1 局流程验收、0 轮优化，生产源码及 BP407 归档保持不变。证据位于 `artifacts/native-causal-audit/bp408-experiment-workflow/summary.json`。
