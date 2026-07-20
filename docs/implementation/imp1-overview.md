# IMP1 多TankProfile控制面与只读平台基线 Overview

状态：`IMP1_ACCEPTED / IMP2_ELIGIBLE / RELEASE_NOT_READY`，2026-07-16。

本Overview记录[实施计划](../design/implementation-plan.md)中IMP1的实现结果。阶段资格只由[IMP验收合同](../design/imp-acceptance-contract.md)及机器AcceptanceReport决定；本地实现通过不能替代真实平台context。

## 0. 正式验收结论

执行：

```text
./tools/implementation-toolchain.sh accept --stage IMP1
```

当前结论：`ACCEPTED`。`A1-01`至`A1-08`全部PASS，blockers为0。v1/v2均通过两次真实GET与显式expected tankId绑定，随后由验收器再次GET复核main身份、baseline和CapabilityProfile；整个阶段平台mutation为0。

权威不可变报告为[imp1-acceptance-21b8020ab1671af94b857f33397b025e09a624fe8675f80cee382806dcc6f994.json](../../artifacts/reports/acceptance/IMP1/history/imp1-acceptance-21b8020ab1671af94b857f33397b025e09a624fe8675f80cee382806dcc6f994.json)，Acceptance fingerprint为`21b8020ab1671af94b857f33397b025e09a624fe8675f80cee382806dcc6f994`。current指针为[imp1-acceptance-report.json](../../artifacts/reports/acceptance/IMP1/imp1-acceptance-report.json)。

## 1. 已实现范围

- v1/v2及未来TankProfile的非密钥registry和run/baseline/standing/import物理隔离；
- secret只通过`secretRef(provider/name/keyGenerationId)`从环境解析，命令行key和值模式硬拒绝；
- `context/register-tank/verify-profile/rotate-key`统一函数和CLI；
- tankId、tankUrlId、own skill、branch逐次GET核对；首次绑定要求显式expected tankId；
- v2的用户确认预期技能`poison`进入bootstrap mismatch guard；平台GET前registry仍保持`UNKNOWN`；
- 轮换要求expected current generation，stale generation和换绑其他tank硬失败；
- context先检查secret回显，再写脱敏内容寻址artifact；
- 每profile/branch归档main源码、baseline manifest和CapabilityProfile；未证实能力保持UNKNOWN；
- ownerScope共享2秒调度器，服务端nextSimulationAt只能延长；
- registry共享锁、fingerprint CAS、原子写中断清理和不可变history；
- `--dry-run`不解析secret、不访问网络、不写本地；HTTP client在IMP1仅允许GET；
- simulate、publish、challenge命令仍不可达，平台mutation计数为0。

## 2. 实现门与测试

唯一实现门：

```text
./tools/imp1-toolchain.sh verify
```

本地门为`PASS`，gate fingerprint为`2b8d7b4a7a1b3f4513da371af7023c42a33376ee1f892a52e9a5a61e1c0e1a31`。正式验收重跑时测试`48/48 PASS`、0 fail；171个受控文件secret扫描0 findings；v1/v2真实context均PASS。原始TAP、registry/目录、secret、只读边界和external-context证据全部保存在`artifacts/reports/imp1/history/`。

故障与负向控制覆盖：wrong/cross-profile identity、tankUrlId漂移、skill预期冲突、stale generation、新key指向其他tank、secret回显、POST前拒绝、dry-run零I/O、共享owner限流、server cooldown缩短尝试、registry并发锁和rename前中断。

IMP1是离线控制面，不进入tank production bundle或Minimax热路径，因此本阶段没有用本机HTTP耗时冒充平台3秒/搜索性能证据。高性能物理与搜索benchmark仍按IMP2–IMP6阶段合同执行。

## 3. v2 poison证据边界

用户确认的名称/技能先作为bootstrap mismatch guard，随后已由平台GET确认：v1为`tiny tank / stun`，tankId `6821`；v2为`Slay The Tank / poison`，tankId `7214`。两者正式`TankProfile.skillProvenance`均为`PLATFORM_CONTEXT`。

## 4. 本地credential与复核流程

用户明确授权把玩具key保存在被Git忽略的`.env.agentank.local`；统一wrapper只把它们加载为registry secretRef所指向的环境变量，不写入registry、context、baseline、CapabilityProfile、日志或验收artifact。Windows DrvFS无法可靠表达0600，本项目接受其777挂载显示；这不改变artifact零key边界。

需要手动复核时执行：

```text
./tools/platform-toolchain.sh verify-profile --tank-profile v2
```

正式阶段复核使用：

```text
./tools/implementation-toolchain.sh accept --stage IMP1
```

当前报告已经满足该条件，允许开始IMP2；这不授权simulate、publish或challenge。
