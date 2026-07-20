# IMP0 平台工具链基础切片 Overview

状态：`PRE_IMP1_PLATFORM_FOUNDATION_SLICE_PASS / SUPERSEDED_AS_IMP0_OWNER / EXTERNAL_MUTATIONS_DISABLED`，2026-07-16。

IMP0的权威完成结论已迁移到[imp0-overview.md](imp0-overview.md)。本文只保留提前实现的平台控制面基础切片，不再决定IMP0状态。

本切片优先落实多TankProfile目录和平台控制面。它不是完整IMP0完成声明：Candidate/Build冻结、六层benchmark执行器和production构建尚未完成。JSON Schema执行器与RunManifest不可变revision已经落地。

## 1. 运行环境结论

```text
kernel    WSL2 Linux 6.6.114.1-microsoft-standard-WSL2
node      v24.16.0
npm       11.13.0
execPath  /home/skill/.nvm/versions/node/v24.16.0/bin/node
binary    ELF 64-bit Linux x86-64
```

Codex非交互shell不加载NVM，因此直接`node`曾不可见；用户交互WSL会加载NVM。统一入口不依赖shell启动文件，而是读取`.nvmrc`并直接调用WSL NVM中的Linux Node。启动器同时把`TMPDIR`和npm cache放到WSL `/tmp`，避免继承Windows临时目录。

## 2. 唯一物理布局

```text
engine-v2/                         新引擎；不导入v1或platform工具
  src/{abi,state,rules,reference,fast,search,policy,cache,runtime,generated}
  test/{unit,fixture,property,differential,replay,fault,integration}
  bench/{micro,composite,pipeline,terminal,full-game,platform}

tools/agentank/                    v1/v2/未来tank共享控制面
  core/                            canonical JSON、hash、atomic、paths、sanitize
  profiles/                        registry、secretRef、context identity
  platform/                        bootstrap、client、context、doctor、owner限流
  cli/                             薄CLI
  build/ corpus/ analyze/          后续切片边界

battle-records/
  control/                         本地registry、capability、locks、rate-limit
  tanks/v1/{runs,baselines,standing,imports}
  tanks/v2/{runs,baselines,standing,imports}
  corpus/{ledger,heads,snapshots,cohorts,forward}

artifacts/{builds,candidates,reports}
```

历史目录和v1源码未移动、未改写。`battle-records/control/tank-registry.json`为本机生成文件并被Git忽略；它只保存环境变量名，不保存key值。

## 3. 重复操作入口

所有重复步骤已收敛到一个脚本：

```text
./tools/platform-toolchain.sh bootstrap
./tools/platform-toolchain.sh doctor
./tools/platform-toolchain.sh profiles
./tools/platform-toolchain.sh context --tank-profile v2
./tools/platform-toolchain.sh register-tank --tank-profile v2 --expected-tank-id <id>
./tools/platform-toolchain.sh scan-secrets
./tools/platform-toolchain.sh test
./tools/platform-toolchain.sh verify
```

`bootstrap`只补充缺失目录/profile；不会覆盖现有identity、baseline、run、corpus或candidate。实测第一次`changed:true`并创建v1/v2，第二次`changed:false`且registry fingerprint不变。

`verify`是完整本地基础门：按固定顺序执行`bootstrap -> doctor -> scan-secrets -> test`。
文档和人工流程不得每次重新拼装这条链；新增重复动作时必须先增加脚本子命令及测试。

## 4. 当前已实现

- 固定WSL原生Node/npm启动器、`.nvmrc`、package/lockfile；
- v1/v2共享ownerScope、独立secretRef和独立物理目录；
- canonical JSON安全整数、SHA-256 fingerprint、同目录原子写；
- profile/path/branch验证及path traversal拒绝；
- TankRegistry结构与semantic validation、profile/alias/branch唯一性；
- Tank Key只从profile的ENV secretRef解析；CLI拒绝`--key`及key-like值；
- authenticated GET context客户端，错误和response落盘前脱敏；
- tankId/skill/branch/published code identity提取与交叉核验；
- BOOTSTRAP context可检查但不能自动绑定；首次绑定要求显式expected tankId并再次GET；
- context artifact按内容hash复用，不因重复检查重建同一文件；
- ownerScope文件锁和共享2秒rate-limit state；多个key不能绕过；
- DD10 JSON Schema通用validator与全部平台schema编译检查；
- RunManifest不可变revision、latest pointer、hash链和篡改检测；
- source/config/new artifact secret扫描；
- doctor检查WSL kernel、Linux Node、版本、registry和profile目录隔离。

## 5. 当前明确禁用

- 服务器simulate；
- publish；
- ranked challenge；
- 自动下载/ledger ingest；
- key轮换；
- Candidate/RunManifest推进。

这些命令不是“尚未测试但可以调用”，而是CLI中尚未暴露。必须先完成对应intent、attestation、authorization、reconcile和artifact合同。

## 6. 测试证据

统一命令：

```text
./tools/platform-toolchain.sh test
```

结果：以`verify`的实时输出为准；本次基线为26/26 PASS，0 fail，覆盖：

- bootstrap幂等与v1/v2目录隔离；
- canonical JSON/fingerprint；
- HTTP auth只驻留内存、错误脱敏；
- context identity和跨tank/skill拒绝；
- 首次绑定expected tankId硬门、context artifact无secret；
- ownerScope跨profile共享限流和服务器nextSimulationAt延长；
- registry幂等与semantic validation；
- 全部DD10 schema编译、example schema校验；
- RunManifest不可变revision链及篡改检测；
- path traversal、CLI secret、ENV secretRef和sanitize。

`doctor`实测全部检查PASS；`scan-secrets`本次扫描68个文件、0 findings。计数随工具、测试和artifact增加而动态变化，以每次`verify`实时结果为准。没有调用真实AgentTank API。

## 7. Key处置

用户在聊天中提供的key未进入任何文件、命令、环境变量、测试或artifact。本切片不使用它。由于它已经出现在聊天记录中，应在平台轮换后再设置到WSL的`AGENTANK_KEY_V2`，然后执行：

1. `context --tank-profile v2`读取并人工核对脱敏tankId/skill；
2. `register-tank --tank-profile v2 --expected-tank-id <核对后的id>`完成绑定；
3. `scan-secrets`复核本地artifact。

## 8. 一致性与下一步

本切片不进入3秒production路径，不修改Minimax、Hard、Proof、Risk或v1行为。Build可以未来共享，但TankProfile目录、context、baseline、Run和Forward从物理层已经分开。

下一平台切片顺序：

1. Build/Candidate artifact manifest与exact candidate bytes；
2. SimulationPlan与本地preflight；
3. ownerScope调度下的official simulation及attestation；
4. publish intent/授权/GET verify/reconcile；
5. challenge/download/ledger。
