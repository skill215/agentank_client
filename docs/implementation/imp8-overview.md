# IMP8 校准、冻结与本地 Candidate Overview

状态：`ACCEPTED / CANDIDATE_FROZEN / G10A_PASS / IMP9_ELIGIBLE`，2026-07-17。

## 结论

IMP8 已完成本地参数选择、字节级构建冻结和 Frozen 回归。最终 Gate 为 `PASS`，fingerprint `5171665c46fbeda15d14347b9f9cad90968a0140417855430451e2cbc7bb2eeb`；Acceptance 为 `ACCEPTED`，fingerprint `32bcaa77113083c907ad2ba51c1ef24f724a75825ae3d15724dc5c682d572dd1`。全量 259/259 测试通过，内部 blocker 为 0。

最终 Candidate 是 `imp8-v2-a5ce6f8ef59abb61`，绑定 v2 / tank 7214 / poison / main。Candidate fingerprint 为 `48c2e5c49fb4beb9d2e0726a250b5694db999337551351f5cfe9f30a8383f67a`，精确 publish minified SHA-256 为 `45a96d1c4c7a2b5ae7957a2c7813fa1cc2840a9d1937f164e5df3fb982d2eea4`，大小 231,012 bytes。CandidateManifest 位于 [candidate-manifest.json](../../artifacts/imp8/frozen/candidate-manifest.json)。

## Calibration 选择

V5 在 56 张 Calibration 地图、两次重复、四种座位/技能变体上完整执行，但最佳原生胜率仅 19.64%，按预注册门返回 `NO_SELECTION`，没有冻结。

V6 在同一完整分母上比较无路径基线、路径基线以及 balanced D2/D3。选择规则在执行前固定：严格错误为 0、fallback 不超过 40%、原生胜率至少 35%、且相对无路径基线至少提升 5 个百分点。最终结果：

| Candidate | 原生胜率 | 相对基线 | fallback | 结论 |
|---|---:|---:|---:|---|
| NO_PATH_BASELINE_D2 | 19.19% | 0 | 0.42% | 不合格 |
| PATH_BASELINE_D2 | 31.25% | +12.06pp | 1.12% | 未达绝对门 |
| PATH_BALANCED_D2 | 39.73% | +20.54pp | 4.22% | 合格 |
| PATH_BALANCED_D3 | 41.07% | +21.88pp | 10.62% | 选中 |

四个候选的 native critical error、avoidable Hard reject、root restore failure 和 hot allocation 均为 0。完整报告 fingerprint 为 `99b77c71a5e28c495bbae86bce9cdfa6e0a6f636afb4c5833ecfee976f19edcf`，见 [candidate-comparison-report.json](../../artifacts/imp8/calibration/candidate-comparison-v6/candidate-comparison-report.json)。

## 冻结与失败闭环

冻结脚本把候选整数参数直接嵌入 bundle，不修改共享 generated 配置；每次冻结进行两次 source/minified/BuildManifest 重建。Candidate id 同时包含参数选择和 production source hash，代码变化不会复用旧身份。

第一个冻结 Candidate `imp8-v2-9a925e9399608e8a` 在全量门中暴露 PathDistanceField 诊断计数器残留，违反 production strip。它被不可变标记为 `REJECTED`，disposition fingerprint `5c2ebb6abd56c411a017a5b384027349ab44d4d41436b0301a04ad3a960cfdda`；旧 manifest 和旧构建均未覆盖。移除计数器及热路径无用写操作后，新的 source identity 生成当前 Candidate，再次完整运行 Frozen。

## G10A 与 40 场技能回归

最终 G10A 从 DD9 assignment 动态重建 63 张 Frozen 地图，每张执行四种座位/技能变体，共 252 场。avoidable Hard reject、runtime failure、root restore failure、hot allocation 全部为 0；28 次 Hard reject 都是所有动作已证明失败的 unavoidable 状态。G10A fingerprint 为 `6d167b056fa655a1dc36445e3f78f843f1e5e3dfcf690712e56bae5505bb8a47`，见 [g10a-report.json](../../artifacts/imp8/frozen/g10a-report.json)。

新下载的 boost、shield、cloak、teleport 各 10 场，共 40 场，已固定为 Discovery-only 技能回归集。回归会验证 40 个成员、120 个 summary/events/raw 文件及 12 条确认规则，fingerprint 为 `fa3e0c50d1b8a929d6011a61023b8329856fabaff969ed2d8d53df5f988ed29f`。它只验证物理/技能事实，不进入 Calibration 或 Frozen 分母，也不能反向调参。

## 可重复入口

```text
./tools/skill-evidence-toolchain.sh regress
./tools/imp8-toolchain.sh compare-candidates --plan config/engine-v2/imp8-candidate-comparison-v6.json
./tools/imp8-toolchain.sh freeze-candidate --plan config/engine-v2/imp8-candidate-comparison-v6.json \
  --comparison artifacts/imp8/calibration/candidate-comparison-v6/candidate-comparison-report.json
./tools/imp8-toolchain.sh g10a
./tools/imp8-toolchain.sh verify
./tools/implementation-toolchain.sh accept --stage IMP8
```

平台引擎、平台脚本字节上限和真实 3 秒 runtime 仍属于外部证据，不由 IMP8 本地 PASS 冒充已知；这些条件转交 IMP9 官方 simulation。
