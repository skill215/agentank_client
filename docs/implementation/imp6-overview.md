# IMP6 缓存、RuntimeController、Production Build 与六层性能 Overview

状态：`G4_G7_G9_LOCAL_PASS / ACCEPTED / IMP7_ELIGIBLE / RELEASE_NOT_READY`，2026-07-16。

本 Overview 记录[实施计划](../design/implementation-plan.md)中 IMP6 的实现与验收结果。IMP6 建立本地可执行的高性能边界，但没有把未知的平台引擎、脚本字节上限或未完成的runtime校准伪装成发布资格。

## 0. 验收结论

执行链为：

```text
./tools/imp6-toolchain.sh verify
./tools/wsl-node.sh tools/agentank/cli/implementation-ops.js accept --stage IMP6
```

`A6-01`至`A6-10`全部PASS，最终194/194测试通过。最终Gate fingerprint为`cd67825a09391066c7a76fd16e8c5612f6768ad210600deaf9ee2ca0b9cb8a1f`；Acceptance fingerprint为`f7a3edefa7f7676de8e29abbe98b932921f09b844548a57945f1b387f0ea8253`。

current报告位于[imp6-acceptance-report.json](../../artifacts/reports/acceptance/IMP6/imp6-acceptance-report.json)，不可变报告为[imp6-acceptance-f7a3edefa7f7676de8e29abbe98b932921f09b844548a57945f1b387f0ea8253.json](../../artifacts/reports/acceptance/IMP6/history/imp6-acceptance-f7a3edefa7f7676de8e29abbe98b932921f09b844548a57945f1b387f0ea8253.json)。两者SHA-256相同：`fdfd295ccef4e3e0c8271c464c72c4aa87e410003bd382ce22c05ba68dfc921f`。

## 1. 11个canonical cache与失效

- 只实现DD8登记的11个ID；每个cache均为独立、有界、预分配TypedArray SoA，并使用双uint32 key、双uint32 compact signature、version和generation核验；
- 支持2-way/4-way构造，本地profile选用2-way；Proof的PROTECTED/PINNED条目在同bucket无合法替换位时返回MISS，不用软值覆盖；
- terrain、entity、opponent、profile、plan等依赖通过dependency mask与完整uint32 signature精确失效；`0xffffffff`也可作为真实signature，不再兼任通配哨兵；
- cache disabled/full/collision/stale均返回MISS并走同语义直接计算；cache不能返回“无危险”“0分”或旧动作作为默认；
- active projectile、bomb和PersistentPlan仍由PhysicalState/Plan Arena持有，缓存淘汰或全关不会删除物理事实；
- 诊断cache保留probe/hit/write等counter用于benchmark；production bundle改用无统计counter的专门化cache，避免热probe/write支付诊断成本。

当前本地cache总TypedArray为12,784 bytes；`REGRET_WARM_CACHE`和`TRANSITION_CACHE`默认关闭，直到后续profile证明净收益。

## 2. 累计Runtime、fallback与Emergency

- 平台目前没有经确认安全可用的wall clock，因此正式路径使用版本化整数work counter，不伪造毫秒；
- 本地profile以120,000进入DEGRADED、150,000进入永久FALLBACK、250,000进入EMERGENCY；这些是1500/2500ms目标的待平台校准等价值；
- 相同frame、frame倒退或可疑fingerprint变化不能清空累计预算；只有保守确认的新局才reset；
- `canStartBatch`在开始节点批次前预测reserve侵入，mode跨界后立即重写搜索预算，不会拿NORMAL旧预算进入FALLBACK；
- FALLBACK仍运行Minimax，当前本地选择depth 3、node 192、proof 128、matrix 32×batch 8，不是2步常量、贪心或MCTS；
- Hard、Terminal、Tactical closure和strict Proof语义不随runtime mode缩减；normal/fallback strict fingerprint差分为0；
- 2,688-byte EmergencyReserve独立持有最小root/hazard/action工作区；Emergency emitter在11个cache全关时仍逐action调用共享HardGate。

由于缺少匹配平台engine/build hash的校准profile，上述work门不能用于授权发布；进入IMP8前仍须从平台source/minified P99反推更保守的charge和limit。

## 3. Production build

- `tools/agentank/build/imp6-builder.js`从固定production entry递归收集`engine-v2/src`相对模块，生成确定性单文件source；
- Terser固定为5.43.1，固定ECMA/options，不mangle平台入口；相同输入的source、minified和BuildManifest hash完全一致；
- 当前Poison build只含一个`OwnPoisonEmitter`和Generated evaluator，同时保留八个enemy skill descriptor的O(1)整数查表能力；
- strip审计确认Reference、external simulator、replay/v1/log、IO/network、Worker/async、动态eval、随机、Float32/64语义数组和`Math.imul`为0；production cache诊断counter也为0；
- 无`Math.imul`的目标sandbox完成parse/init、24字段fixture和onIdle调用；source/minified semantic fingerprint同为`72ab697452bca2fd3e80bd816ff39e76477d327f2156490303c36436c688816b`；
- Build fingerprint为`effe9405773261238d5dc04f452560fb32d1f15752b07f5821dcbc8cd9ab1912`；source为129,165 bytes，minified为104,712 bytes。

构建产物仍是性能/语义骨架，`onIdle`尚未接完真实平台ObservationAdapter和完整动作输出，因此不具备发布资格。IMP8 Candidate freezer也尚未运行。

## 4. 六层benchmark

[benchmark-report.json](../../artifacts/benchmarks/imp6/benchmark-report.json)固定报告P50/P95/P99/max、operations、instrumented allocation、high-water和bytes。本次验收的本地五层均有非零分母且tracked allocation为0：

| 层 | 场景/样本 | P50/P95/P99/max µs | high-water | bytes |
|---|---:|---:|---:|---:|
| function cache/risk/matrix/runtime | 4 / 64 | 9 / 124 / 224 / 224 | 16 | 12,784 |
| composite projectile/bomb/dodge Hard | 3 / 33 | 67 / 491 / 1,844 / 1,844 | 28 delta/event | 14,614 |
| source/minified/onIdle pipeline | 3 / 12 | 892 / 4,675 / 4,675 / 4,675 | 1,250 work | 129,165 |
| terminal matrix/Proof | 4 / 32 | 61 / 229 / 373 / 373 | 10 nodes | 54,784 |
| 128-frame full-game synthetic | 3 / 9 | 786 / 3,667 / 3,667 / 3,667 | 160,000 work | 57,472 |
| source/minified platform | 0 / 0 | `BLOCKED` | — | — |

这些时间是本机WSL/Node 24的单次观测，不是稳定SLA，也不能和平台3秒直接等同。第六层明确为`PLATFORM_ENGINE_BYTE_LIMIT_AND_RUNTIME_CALIBRATION_PENDING`，符合“非零分母或按合同BLOCKED”的规则。

## 5. 自动化与证据

- `./tools/imp6-toolchain.sh test`运行IMP6专项；
- `./tools/imp6-toolchain.sh verify`运行IMP0–IMP6全回归、build、strip、差分和benchmark，并写current与不可变Gate证据；
- `./tools/implementation-toolchain.sh accept --stage IMP6`已注册为独立验收入口，进入acceptance前会重跑Gate；
- Build source/minified/manifest和benchmark report分别按内容fingerprint写入不可变history，Gate只引用并重新校验SHA-256。

## 6. 下一阶段与边界

IMP7已获准入。下一步实现动态MatchLedger、持续增长历史扫描、Failure/PositiveWindow、Truth/Observed双轨和双方反事实。IMP7可以用历史发现弱点和回归fixture，但不能修改本阶段的Hard/Proof事实，也不能把外部模拟或历史单例升级成平台规则。

release继续被三项阻塞：`PLATFORM_ENGINE_UNKNOWN`、`PLATFORM_SCRIPT_BYTE_LIMIT_UNKNOWN`、`PLATFORM_RUNTIME_CALIBRATION_PENDING`。这些应在IMP8/IMP9用精确Candidate字节和官方simulation关闭，而不是在IMP6本地报告中删除。
