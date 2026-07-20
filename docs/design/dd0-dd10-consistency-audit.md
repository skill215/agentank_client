# DD0–DD10 全局一致性与修订审计

状态：2026-07-16。本文增量审计 DD10 对 DD0–DD9 的影响；[dd0-dd9-consistency-audit.md](dd0-dd9-consistency-audit.md) 保留为当时审计记录，但其“无新冲突”结论已由真实平台和动态语料新证据更新。

## 1. Owner 矩阵

| 问题域 | 当前唯一 owner | DD10 是否改算法语义 |
|---|---|---|
| Frame/Terminal/Hard/Proof | DD1/DD4/DD6 | 否；只增加 SCRIPT_ERROR fixture |
| State/Information/ABI | DD2/DD3 | 否 |
| Fast/Hazard | DD5 | 否 |
| Value/Matrix/Proof/Risk | DD6 | 否 |
| Eval/Strategy/Opponent/Skill/Plan | DD7 | 仅收窄 Poison cadence UNKNOWN，不改评分权威 |
| Cache/Runtime/Production | DD8 | 移除平台不支持的 Math.imul；增加 capability manifest |
| Immutable legacy/counterfactual | DD9 | 244 snapshot 保留；旧 rolling/quarantine 解释被 DD10 修订 |
| Dynamic ledger/platform operations | DD10 | 新 owner |
| Artifact identity/manifest lineage | DD10 artifact lineage | 新owner；消除Build/Candidate/Run重复字段歧义 |
| Tank/key/profile identity | DD10 TankRegistry + platform operations | 新owner；不改变生产搜索语义 |

## 2. 关键不变量复核

### Hard/Proof/Risk

技能 evidence provenance 只决定历史重建是否 complete；实时根仍读取公开 `enemy.skill.type`。UNKNOWN 历史技能不能生成严格 Proof，符合 DD1/DD6 的 incomplete 规则。软层的同 tank inferred skill仍可进入 opponent prior，不改变 support。

### 性能

平台 runner 和 corpus 全离线。生产单线程、同步、整数、TypedArray、显式栈和 fallback 不变。删除 `Math.imul` 是兼容性修复；任何替代 hash 必须继续通过 cache collision/canonical signature 测试。

多TankProfile只增加离线registry、身份核验、目录分区和owner-scope调度，不进入3秒tank bundle。v1/v2若使用相同构建字节，可以共享BuildManifest输入和通用规则fixture，但不能共享Candidate、SimulationAttestation、Forward或rollback资格。

### 冻结语料

244 artifact roots 和 match 集不变。DD10 没有把 255 覆盖到 244；它新增 Ledger/Head 层。旧 DD9 split 只对该 snapshot 有效，禁止推广到 rolling head。

### Forward 与发布

DD9 要求 candidate/build 先冻结、随后采集 forward 保持不变。DD10 只澄清真实挑战需要先发布 exact hash，因此引入 canary publish 与最终 accepted 两级状态；ForwardBatch 仍不得用于调同一 candidate。

## 3. 已确认并修复的冲突

| 旧表述 | 新证据/问题 | 当前处理 |
|---|---|---|
| BitMath 使用 Math.imul | v25 第1帧真实 SCRIPT_ERROR | 生产禁止依赖；shift/add hash + capability test |
| enemy skill null=none | raw 只在 cast 时保存技能 | UNKNOWN + provenance |
| DSU role 对追加稳定 | groupId 含全成员列表 | 仅冻结 snapshot；rolling 用 stable session |
| prebuild quarantine 不可用于调设计 | 已查看新局包含平台兼容致命证据 | Discovery append、仍非 forward |
| Poison parity 未知 | 30个完整 replay cadence 一致 | cadence confirmed；empty repoll unknown |
| error 可用一般 terminal 文本覆盖 | 非错误方 runtime 可缺失 | 增加 SCRIPT_ERROR adapter fixture |
| G0..G10 后才可首次发布并采 forward | real challenge 只能跑已发布 main | canary publish / release accepted 两级门 |
| source通过simulation但上传minified | 两份字节可能存在平台语义差异 | attestation与publish都绑定publishArtifactSha256 |
| rolling corpus只有prose字段 | 多个导入器会生成不兼容ledger/head | DD10 corpus schema冻结六类artifact |
| 平台脚本隐含单key/单tank | v2将使用新key，未来还会继续增加tank | 非密钥TankProfile Registry；mutation显式profile并核对远端identity |
| 目录与发布分母可跨tank混用 | 相同bundle/hash不足以证明同一tank/skill | Candidate/Run/Snapshot/Forward/rollback绑定profile/tank/skill/branch |
| 每个key独立限流 | 同一owner的多key可能绕过平台用户级限制 | ownerScopeId共享锁；未知关系保守串行 |
| 新tank首次发布可能没有旧代码 | “必须有rollback”会阻塞合法首次上传 | 优先归档main；确无基线时独立授权、扩大simulation并显式停止策略 |

## 4. 未被新证据推翻的部分

- 单方 crash、双方 crash、128帧、runtime/timeout 的 Terminal hierarchy；
- Overload 两独立 projectile、timed expiry before later normal fire；
- Boost compound action；
- Stun `{NORMAL,REVERSED}` support 与概率未知；
- Teleport 只在请求 star tile 时展开相邻 chance，任意 target 不作此剪枝；
- Shield 两 hit 仍由官方 Update/Guide 定义；历史单 hit 生存不构成反例；
- Cloak/grass 继续使用 InformationState 和 PossibleHazard，omniscient replay 不冒充当时观察。

## 5. 文档优先级修订

出现以下差异时：

- 当前总对局数、追加、session、skill evidence、run storage：服从 DD10；
- `LEGACY-244-20260715.1` 文件与旧角色复现：服从 DD9 immutable manifest；
- 平台 API 调用和错误：当前 Guide > DD10 contract > 旧根脚本；
- 平台物理/技能：Updates/Guide/RuleCorpus，不由 ops runner 定义；
- 发布资格：更新后的 release gate + DD10 two-level state。
- tank/key身份、secret、目录、owner-scope限流与回滚：服从DD10 TankRegistry和platform operations。

## 6. 结论

DD10 修订的是证据和平台生命周期，不要求回退 Minimax 核心。前序文档中涉及固定总数、rolling split、null skill、Math.imul、单tank假设和首次发布/forward顺序的表述必须服从本次修订。当前设计链重新闭合，但实现与平台 gate 仍未通过。
