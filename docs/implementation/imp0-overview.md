# IMP0 工程骨架与性能护栏 Overview

状态：`IMP0_ACCEPTED / IMP1_ELIGIBLE / RELEASE_NOT_READY`，2026-07-16。

本Overview记录[实施计划](../design/implementation-plan.md)中IMP0的实现结果；正式阶段状态由[IMP验收合同](../design/imp-acceptance-contract.md)和机器AcceptanceReport决定。它不证明任何坦克物理、Minimax质量、平台性能、production bundle或发布资格。

## 0. 正式验收结论

执行：

```text
./tools/implementation-toolchain.sh accept --stage IMP0
```

结果：`ACCEPTED`。`A0-01`至`A0-10`全部PASS，blockers为0；验收前自动重跑实现门，52/52测试通过。验收报告绑定的合同SHA-256为`5293c72a292aa6674c219e33066a9b57280482be26656da12fd971f9002083f8`。

权威不可变报告：[imp0-acceptance-42f7c4651006276d833140802126a3cac1ee38db46d651b70cb353386c335555.json](../../artifacts/reports/acceptance/IMP0/history/imp0-acceptance-42f7c4651006276d833140802126a3cac1ee38db46d651b70cb353386c335555.json)，Acceptance fingerprint为`42f7c4651006276d833140802126a3cac1ee38db46d651b70cb353386c335555`。

## 1. 唯一执行入口与结论

```text
./tools/imp0-toolchain.sh verify
```

该命令固定执行测试、工具版本核验、结构审计、fixture重建、六层benchmark骨架、production边界、密钥扫描和IMP0网络隔离审计，并原子写入`artifacts/reports/imp0/`。同名文件是方便查看的current副本；门内证据全部引用`history/<kind>-<full hash>`不可变文件。不得把这些步骤重新拼成临时命令。

最终机器门：`PASS`，blockers为0。原始报告为[imp0-gate-report.json](../../artifacts/reports/imp0/imp0-gate-report.json)。

## 2. 实施前冲突审计

| ID | 原计划与现有数据/结构冲突 | 处理 | 结果 |
|---|---|---|---|
| IMP0-C01 | Benchmark合同把replay写成第六层，实施计划/目录把platform写成第六层 | 固定六个性能层为function/composite/pipeline/terminal/full-game/platform；replay改为独立验证轨；`DEC-0092` | CLOSED |
| IMP0-C02 | 现存历史对局位于根级legacy目录，缺TankProfile血缘；新合同要求`tanks/<profile>` | 不搬迁、不默认归v1；旧目录只读作为IMP7迁移输入，新写入才按profile隔离；`DEC-0093` | CLOSED |
| IMP0-C03 | 计划仍写“WSL无Node/package”，与已经建立的wrapper和lockfile冲突 | 更新为WSL2 Linux Node v24.16.0，非交互NVM差异由版本化wrapper吸收 | CLOSED |
| IMP0-C04 | 逻辑目录只列engine测试，实际共享平台工具测试在根`test/platform` | 明确根`test/imp0`与`test/platform`为离线工具测试，不进入engine/production | CLOSED |
| IMP0-C05 | IMP1部分只读控制面已经提前实现，容易被误计为IMP0通过依据 | 保留实现但从IMP0分母排除；IMP0隔离审计禁止依赖platform/profile模块 | CLOSED |
| IMP0-C06 | minifier未固定 | Terser 5.43.1作为精确devDependency进入lockfile，不进入production runtime | CLOSED |

设计同步记录见`FA-13/FA-14`和`DEC-0092/DEC-0093`。

## 3. 现有数据兼容结论

审计时动态发现：

```text
summary.json       257
raw.json           257
events.json        257
mat_* directories 241
legacy top dirs     33
profile artifacts  v1=0, v2=0
```

这些数字只是本次运行快照，不是常量、门限或固定分母。新可执行代码中没有历史固定局数。原始结构证据为[structure-audit.json](../../artifacts/reports/imp0/structure-audit.json)，其artifact SHA-256为`9679fde7ea0369c154aed0572a4dd86c29f09e54450d2eac98521593c60bbcae`。

旧的根级下载、分析和v1脚本没有被移动或修改；它们不进入`engine-v2`、IMP0 benchmark或production allow-list。

## 4. 已实现范围

- WSL原生Node/npm解析器、`.nvmrc`、精确package manager与lockfile；
- Ajv 8.17.1、ajv-formats 3.0.1、Terser 5.43.1精确锁定；
- 既有canonical JSON、安全整数、SHA-256、原子写、manifest revision与schema runner；
- 固定seed的整数PRNG与canonical fixture loader；
- 显式allocation counter和Arena high-water tracker；
- `hrtime.bigint()`整数微秒时钟及可控SyntheticClock；
- 整数TypedArray semantic fingerprint、全字段snapshot比较和root restore硬失败；
- Reference/Fast通用差分报告格式及机器schema；
- 六个性能层的计划、runner、目录与报告schema；
- production import allow-list、Reference/dev deny-list和forbidden construct审计；
- IMP0依赖图静态隔离，不能到达platform network/profile mutation模块；
- 本地/CI可复用的唯一`verify`命令；零benchmark、零测试均不得标PASS。

没有实现任何地图、坦克、子弹、炸弹、技能、Hard、Proof、Risk或Minimax逻辑。

## 5. 输入与工具指纹

| 输入 | 指纹 |
|---|---|
| Toolchain | `24ef09843da739c501748312df80345392e49d0f6ca25c8bac0eef1b9ef0fa35` |
| FixtureSet | `788eebadbfc2d5e7046682dd25da3d64cf907562eaefa37bd3e31520535b2832` |
| BenchmarkPlan/report skeleton | `d849b658d09bb33824878e9592fa794579d0a1feffba56ddfbc2d22df5f6ab8d` |
| ProductionPolicy | `407be9a89dabf3aaadbaa3fd3b21fcd3e525549531cb2df0268efbc6cd4947e3` |
| IMP0 isolation audit | `122d730f3b1dec04a94d189ae1c281f2d9a2f39d4983bdb6afbad9388679e48d` |

工具版本原始证据为[toolchain-report.json](../../artifacts/reports/imp0/toolchain-report.json)。

## 6. 测试与故障注入

正式验收所绑定的实现门运行`52/52 PASS`、0 fail。原始TAP为[test-output.tap](../../artifacts/reports/imp0/test-output.tap)，报告为[test-report.json](../../artifacts/reports/imp0/test-report.json)。覆盖的故意破坏包括：

- malformed IMP0 schema必须失败；
- root TypedArray单格变化必须失败；
- allocation超过零预算必须失败；
- Arena超过capacity必须失败且current不漂移；
- 未strip的console/Reference必须失败；
- import逃到Reference、tools或runtime module必须失败；
- RunManifest hash链篡改必须失败；
- 零测试即使进程exit code为0也必须失败；
- 六层零benchmark必须全部`NOT_RUN`而非PASS。

测试原始输出artifact SHA-256以机器门当前`artifacts[]`为准；测试计时会使每次合法重跑产生新的raw hash。

## 7. Benchmark结果边界

[benchmark-skeleton.json](../../artifacts/reports/imp0/benchmark-skeleton.json)包含六层且总状态为`NOT_RUN`：

```text
function    NOT_RUN / ZERO_SAMPLES
composite   NOT_RUN / ZERO_SAMPLES
pipeline    NOT_RUN / ZERO_SAMPLES
terminal    NOT_RUN / ZERO_SAMPLES
full-game   NOT_RUN / ZERO_SAMPLES
platform    NOT_RUN / ZERO_SAMPLES
```

IMP0通过的是“入口存在且不会把零样本伪装成性能PASS”，不是性能本身。函数/复合/全景/终局的真实样本从对应内核阶段开始加入；full-game和platform在更晚阶段保持NOT_RUN/BLOCKED。

## 8. Production与平台边界

[production-boundary-audit.json](../../artifacts/reports/imp0/production-boundary-audit.json)的policy为PASS，但`productionSourceStatus=NOT_RUN`，因为当前engine故意没有JavaScript物理代码。[imp0-isolation-audit.json](../../artifacts/reports/imp0/imp0-isolation-audit.json)确认IMP0依赖图无platform/profile控制面依赖；本次运行外部请求0、mutation 0。

因此：

- IMP0不能生成Candidate；
- 不能simulate、publish或challenge；
- 不能把本地Node耗时解释成平台3秒证据；
- 不能把提前存在的IMP1平台基础切片解释为profile注册已经完成。

## 9. 回退与下一阶段资格

IMP0报告均有内容寻址的不可变history artifact；相同bytes复用，任何不同bytes只能新增，冲突写入硬失败。同名current报告可更新但不被门作为证据引用。实现未修改v1源码或历史artifact，回退不需要恢复战斗数据。

IMP1可以开始，范围仅限多TankProfile控制面、只读context/baseline、key rotation和fake transport。真实v2 key必须先轮换后只通过WSL环境变量注入；IMP1仍不得publish/challenge。所有G0–G11、production、server simulation和release状态继续为`NOT_RUN/BLOCKED`。
