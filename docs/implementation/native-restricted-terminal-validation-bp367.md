# BP367 — 扩大验证被 OFF 基线漂移阻断

## 状态：BLOCKED，不评价证书收益

预注册 64 个场景，与 BP365/366 的16场景及7个定点场景不重叠；OFF/ACTIVE 双座位各128局，共计划256局。来自已使用的历史开发池，并非全项目未看过的盲测。证书、早拒绝及依赖源码与 BP366 指纹一致；仅扩展实验调度器。

OFF 前121局与 BP349 历史动作完全一致，第122局触发动作漂移断言并停止。ACTIVE 执行0局，不存在可用于比较的新胜率。

## 复现证据

场景 `mat_BKlrQXUkLppJf1TaD`，V2 seat 1，scenario fingerprint 一致，production tree 一致。

- 历史结果：DRAW。
- 两次独立重跑：均 V2_WIN，双方动作序列重复一致。
- V1 首次偏离历史：frame 45。
- V2 首次偏离历史：frame 48。
- 无错误、超时。

证书在 OFF 模式完全未调用，故不能把这个差异归因于证书优化。对手首先偏离，但这并不单独证明 V1 算法有 bug；旧输入、模拟器、宿主环境或时钟行为仍需区分。

又进行两次只读计时观测，frame45 时 V1 累计 runtime 为280ms和254ms，`AT_MC_DISABLED_BY_RUNTIME=false`，progress=45。当前复现并没有触发1000ms回退。冻结 V1 确实使用 Date.now 的累计时间门以及固定进度门，但旧 BP349 未保存该根的对应计时状态，不能断言或排除历史运行当时触发了时间门。

## 保留内容与工具限制

- `artifacts/native-causal-audit/bp367-restricted-terminal-validation/manifest.json`：运行前冻结的64场景、候选指纹与协议。
- 同目录 `acceptance.json`：阻断状态和真实执行分母。
- `artifacts/native-causal-audit/bp367-baseline-repro/`：失败日志与两次重跑紧凑结果。
- `artifacts/native-causal-audit/bp367-baseline-timing/`：两次带V1计时观测的紧凑结果。

本轮也暴露了工具缺陷：主 runner 仅在全部完成后写 matches，异常时前121局内存记录没有落盘。不能根据进度日志冒充已保存的完整逐局证据。下一轮必须增加失败时紧凑结果落盘，避免重复浪费实验数据；禁止伪造或补写不存在的逐帧记录。

复现入口：

```sh
node tools/agentank/diagnostics/certificate-baseline-repro.js <新目录> <本次失败日志路径>
```

## 下一步

先修正实验可重复性与失败留存，而非继续参数优化：

1. 给 V1 宿主计时模式、V1精确源码、模拟器、输入/星序列、种子和调度依赖建立完整指纹；不要只绑定 V2 tree。
2. 用单个漂移场景做受控时钟对照，判断历史差异是否来自时间回退。冻结 V1 源码不动；时钟注入必须标为诊断条件变化。
3. 若旧条件无法恢复，建立明确标识的新当前基线，再做同条件 OFF/ACTIVE，不能把它冒充旧 BP349 的无差异重放。
4. 失败时保存已完成紧凑结果和失败案例，再重启扩大验证。

本轮未放宽历史一致性断言、未跳过失败样本、未改阈值、未进入 ACTIVE、未改 production、未执行官方 simulate/publish/challenge。UT 431/431（扩展调度器后运行）。
