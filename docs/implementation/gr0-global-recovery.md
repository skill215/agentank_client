# GR0 全局恢复：证据瘦身、危险所有权与全量对战

状态：结构实现与纯 UT 已完成；6,608 局全量对战已执行并因玩法门失败而 `REJECTED`。

## 1. 目标与非目标

GR0 修复前一轮局部优化造成的全局退化，并把回归资产从数万份逐帧 JSON 改成可校验、可比较的
紧凑逐局证据。

本轮不修改：

- V1；
- Information 深搜深度；
- ForcedWin；
- value-depth；
- 领先保护；
- stun；
- 性能 profile；
- 旧 IMP8 Candidate 字节。

本轮不执行历史 replay、Capsule、focused、小范围 arena、官方 simulate、publish 或 challenge。

## 2. Git 锚点

- 分支：`codex/v2-global-recovery`
- 当前 dirty 状态的 `REJECTED` 检查点：`17f0979`
- GR0 实现提交：由 `git log -1` 读取，不在文档中写自引用 hash

## 3. Artifact retention

工具入口：

```text
artifact-retention-toolchain inventory
artifact-retention-toolchain compact
artifact-retention-toolchain verify
artifact-retention-toolchain prune --manifest <verified-manifest>
```

实现位于：

- `tools/artifact-retention-toolchain.sh`
- `tools/agentank/cli/artifact-retention-ops.js`
- `tools/agentank/retention/artifact-retention.js`

安全性质：

- inventory 只读并记录原路径、大小和 SHA-256；
- compact 流式处理 NDJSON/大 JSON，不把完整对局数组复制进新报告；
- verify 检查逐局分母、W/L/D、compact SHA-256 和 Candidate/V1 依赖；
- prune 只消费 verified manifest 中的精确文件路径；
- 文件大小或 SHA-256 漂移立即停止；
- 不存在通配符清空 `artifacts/` 的路径；
- prune 后重新校验冻结 V1、Candidate source/minified 和 BuildManifest。

清理结果：

- 24,825 个文件；
- 4,592,945,690 bytes；
- `artifacts/` 清理后约 16 MB；
- `battle-records/` 保持约 162 MB，单独计算。

本地权威证据：

```text
artifacts/retention/gr0/inventory.json
artifacts/retention/gr0/verified-prune-manifest.json
artifacts/retention/gr0/prune-receipt.json
artifacts/retention/gr0/baselines/
```

这些目录被 Git 忽略。旧实施文档中被 prune 的 artifact 链接只具有历史说明意义，不再是有效
可加载入口。

## 4. 引擎所有权修复

### 4.1 Risk

Risk 负责：

- immediate/horizon/unknown mass 阈值；
- ε-contamination robust backup；
- Pareto；
- robustLower safe floor；
- 可接受集为空时的最小风险 fallback。

Risk 不再：

- 因 `deathPressure` 强制 GO/TURN；
- 对 Information 行清零 tactical；
- 对 Information 行降低 safe floor；
- 禁止 mixed policy。

所有可接受且未被支配的动作先受最大 `robustLower` 约束；StageMatrix 只接收该 floor 上的完整
`tactical + search cell`。没有矩阵策略时才比较 expected、tactical、稳定行号。

### 4.2 EscapeObligation / Deadline

接口：

```text
evaluateCommitted(
  bundle,
  actions,
  arguments,
  projectedCell,
  projectedDirection,
  hardStatus,
  count
)
```

固定输出：

- `supportStatus = NONE | COMPLETE | INCOMPLETE | TRAPPED`
- `committedEntityCount`
- `rootSlack`
- `member[row]`
- `successorProof[row]`

EO 只做 committed membership，不是第二个 Hard，也不是 Safety 概率生成器。完整支持时，Risk
可接受集与 `member` 相交；若 Risk 误删全部 committed survivor，只恢复同时满足 Hard 允许与
ReverseViability 可活的动作。不完整支持不执行限制。

## 5. 测试方法

入口：

```bash
./tools/gr0-unit-gate.sh
# 或
npm run test:gr0
```

测试不是只给几个人工样本：

1. 对小型离散游戏穷举所有 payoff 向量，与独立 oracle 比较；
2. 对 Proof 的 OR/AND/HiddenWorld/Chance/Observation 量词做穷举；
3. 对每个严格预算前缀断言只能 UNKNOWN，不能产生假 Proof；
4. 对 StageMatrix 使用独立 2×2 有理数解验证上下界；
5. 对生产搜索验证中断提交、cache 语义、状态恢复和重复根幂等；
6. 对 Risk/EO 用正反 fixture 固化所有权边界。

当前门禁：122/122 PASS，且不读取历史对战。

## 6. Compact arena

全量运行由 `--trace compact` 触发。每局只保存：

- 场景、换位、技能、repetition；
- runtime-independent 结果、星数、击毁、帧数；
- 动作/资源/Hard/Proof/Risk/EO/StageMatrix 汇总；
- base64 固定整数动作序列；
- 每帧一字节 V2 root/Hard/Proof/runtime flags；
- 稀疏动作参数。

详细样本按类别确定性抽样，每类最多 8 局，总计最多 64 局。全量目录只能有四个文件，总预算
32 MiB；超限直接 REJECTED，不截断逐局摘要。

## 7. 验收

- 完整 6,608 局；
- `V2胜 + 0.5×平` 严格超过 60%；
- 固定 266 场景/2,128 局中，V2 单方击毁至少 358；
- avoidable Hard reject = 0；
- risk dominated selection = 0；
- root restore failure = 0；
- V2 timeout/error = 0；
- 826 场景、813 地图、6 种出生、601 星序列；
- 新增 84 场景全部进入；
- 新运行 artifact ≤32 MiB；
- IMP8 1,952 与 working 5,936 共同局比较成功；
- 冻结 V1/Candidate/平台证据身份通过。

任一门槛失败即写 `REJECTED` 并停止；不自动补丁或重跑。

## 8. 实际结果

- 完成：6,608 / 6,608；
- V2胜/V1胜/平：1,125/4,630/853；
- 分析得分：23.47%；
- 固定266场景 V2单方击毁胜/负：111/465；
- avoidable Hard、risk dominated、root restore、V2 timeout/error：全部为0。

玩法门失败，故本阶段 `REJECTED`。后续单因素与独立 holdout 审计见
[GR0 未提交变更因果审计与选择性恢复](gr0-change-causality.md)。
