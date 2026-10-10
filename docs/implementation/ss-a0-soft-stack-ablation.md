# SS-A0 Soft Safety / Information 风险栈因果消融

状态：`DISCOVERY_REJECTED / HOLDOUT_NOT_RUN`。

## 1. 目的与边界

SS-A0 只回答 SR4 之后的 Soft Safety、Information 风险包络及其交互是否造成固定 266
场景从约 58% 跌到约 25%。实验冻结 production 语义在 `9de24c9`，不修改
`engine-v2/src/`，不运行 6,608 局，不修改 Hard、Projectile、Information depth 2、GR0
Risk 顺序、性能参数或发布代码。

production 身份经固定构建器重新生成并核对：

| 项 | 值 |
|---|---|
| engine source identity | `6682643a47fdb7f48dc7d3d7d81dae9f39c6c615a602b1ab07a5c1e679942701` |
| production source SHA-256 | `798a2a2c7f89013652d0f0dcf6de5424495ec436f4585c8f9c5166fb36224eaa` |
| production minified SHA-256 | `a7ccf63151b4ff013739364af1ae27a20a2a5d26a5a6d5aad27980d77647c412` |
| source / minified bytes | 442,931 / 427,475 |

临时诊断包装只安装在本地 `ProductionDiagnosticBot` 的 engine 实例上。`CURRENT` 不替换任何
方法；`COMMITTED_ONLY_RISK` 使用预分配的 Safety slab 副本，原 `SafetyOutcome`、Hard 和
Proof 均不修改。

## 2. 工具与验证

固定入口：

```bash
./tools/soft-stack-ablation-toolchain.sh discover
./tools/soft-stack-ablation-toolchain.sh validate --output <discovery-output>
./tools/soft-stack-ablation-toolchain.sh verify --output <output>
```

本轮在 Discovery 前通过 `./tools/gr0-unit-gate.sh`：**131/131 PASS**，其中新增 8 个 SS-A0
UT，覆盖 CURRENT 零行为差异、committed 质量保留、soft 维度移除、Hard/Proof/Safety
零污染、组合模式、266 场景切分、选择性场景加载及报告对账。Discovery 只按 ID 加载 96 个
场景 payload；overview 明确记录 `holdoutScenarioPayloadsLoaded=0`。

固定 266 场景按 `SHA-256(scenarioFingerprint + 固定盐)` 切为 96 Discovery 和 170
Holdout；两者不重叠。Discovery 使用 4 variants、1 repetition，共 384 局/模式、1,920
局。Holdout 只在某模式通过预注册门后才能运行。

## 3. Discovery 结果

CURRENT 为 87 胜、260 负、37 平，分析得分 27.47%，星差 -278，单方击毁负 79。

| 模式 | V2/V1/平 | 得分 | 相对 CURRENT | 星差变化 | 单方击毁负变化 | 结论 |
|---|---:|---:|---:|---:|---:|---|
| `NO_OBSERVATION_FRONTIER` | 75/272/37 | 24.34% | -3.13pp | -11 | +4 | FAIL |
| `COMMITTED_ONLY_RISK` | 171/196/17 | 46.74% | +19.27pp | +578 | +87 | FAIL |
| `NO_INFORMATION_ENVELOPES` | 88/258/38 | 27.86% | +0.39pp | -2 | +2 | FAIL |
| `SOFT_ALL_OFF` | 137/233/14 | 37.50% | +10.03pp | +579 | +125 | FAIL |

所有模式的 avoidable Hard reject、risk-dominated selection、root restore、V2 timeout 和
V2 error 均为 0。

`COMMITTED_ONLY_RISK` 和 `SOFT_ALL_OFF` 虽然显著提升得分与星差，但都严重增加单方击毁负场；
Discovery 只允许最多增加 3 场。它们说明 Soft 风险栈强烈改变行为与目标选择，却不能证明整体
关闭 Soft 是安全修复。`NO_OBSERVATION_FRONTIER` 在全部四个 variants 上退化；
`NO_INFORMATION_ENVELOPES` 的整体效果接近零且星差略降。

因此没有模式具备 Holdout 资格。实验按预注册停止条件结束，未读取、未运行 170 场景
Holdout，也未生成第一动作分歧样本。

## 4. Evidence

本地、Git 忽略的内容寻址目录：

```text
artifacts/diagnostics/soft-stack-ablation/ss-a0-0f8d66b2a85de16d/
```

只包含：

```text
manifest.json
overview.json
matches.ndjson.gz
diagnostic-samples.ndjson.gz
```

`verify` 结果：1,920 matches、0 samples、355,794 bytes；manifest fingerprint：
`565c2d2d103e0363a955502136e0d444d6af48b61fac2598fea39ca14aad391e`。

选择性 loader 完成前的一次试运行不作为证据。与最终隔离运行对比时，1,920 条中有 3 条动作
流变化，其中 3 条都包含 V1 动作变化，1 条产生胜负变化。这符合 V1 本地墙钟回退的已知
非确定性边界，也说明本地长 arena 不应宣称逐字节可重放；最终门只使用隔离版预注册运行。

## 5. 停止结论

SS-A0 不支持把 Soft Safety 整体削弱或关闭，也不支持把任何消融模式接入 production 默认。
下一轮应按预注册规则转向 Information value、目标/抢星动作生成和搜索选择；若以后再拆分
future FIRE、possible projectile、MultiFrame 或 Observation Frontier，必须提出新的独立假设
和死亡护栏，不能用本轮得分提升绕过单方击毁退化。

本轮没有运行完整 266 双模式资格、6,608 局、官方 simulate、publish 或 challenge。

## 6. 后续决策

SS-A0 的原始门与 `DISCOVERY_REJECTED` 结论保持不变。后续 SS-A1 经用户明确调整目标：单方击毁
负场 `+3` 降为软诊断指标，`COMMITTED_ONLY_RISK` 升级为新的开发基线；Hard、Proof、
dominated selection、root restore 和 runtime error 仍保持硬门。

SS-A1 不直接把 committed-only 接入 production，而是依次恢复 possible projectile、future
FIRE、unknown/escape slack 与 MultiFrame continuation，寻找可保留胜率收益的最小 Soft 子集。
最终资格目标仍为分析得分严格超过 60%。
