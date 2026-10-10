# BP368 — V1计时回退对照与失败留存

## 结果

仅运行 BP367 漂移场景 `mat_BKlrQXUkLppJf1TaD`、V2 seat1。每种条件2次，共6局。证书未启用；V1冻结源码未改，只在诊断VM注入时钟。

| 时钟条件 | V1首次不同于历史 | V2首次不同于历史 | 结果（两次一致） |
|---|---:|---:|---|
| 原生 Date.now | 45 | 48 | V2_WIN |
| 恒定时钟，累计耗时0 | 45 | 48 | V2_WIN |
| frame44结束累计达到1000ms | 95 | 106 | DRAW |

第三种条件通过时钟让原V1代码自然触发 `AT_MC_DISABLE_AFTER_MS=1000`，没有直接改其策略变量、搜索深度或动作。原生时钟在frame45累计312/315ms，MC未关闭；受控条件累计1000ms、MC已关闭。

**结论：计时回退足以改变该场景结果，并消除第45帧的首次漂移。** 受控条件下V1前95个动作（frame0–94）与旧记录一致。但frame95后仍不同，故不能声称完整恢复BP349，更不能反推旧平台实际耗时正好1000ms。历史没有保存该局时钟轨迹，后段差异尚未归因。

## 实验条件

`certificate-baseline-repro.js --clock-study` 在现有原生对照之外增加：

- ZERO：Date.now保持常数，原代码的帧数/决策次数回退仍生效。
- MC_BEFORE45：仅frame44的开始/结束计时间隔为1000ms，其他帧为0，确保frame45进入MC时间回退。

这是诊断注入，不代表官方平台时间，不作为新的默认对手。记录V1源码hash、宿主源码hash、历史输入hash和各次计时轨迹；没有启用证书、发布或重启64场景全量。

证据：`artifacts/native-causal-audit/bp368-clock-study/`。

```sh
node tools/agentank/diagnostics/certificate-baseline-repro.js <新目录> artifacts/native-causal-audit/bp367-baseline-repro/failure-log.txt --clock-study
```

## 失败数据留存修复

新增 `failure-artifact.js` 并接入cohort runner的对战/断言异常路径：

- `partial-matches.ndjson.gz` 保留所有已通过检查的紧凑逐局结果；
- `failure.json` 保留失败场景、模式、座位、已完成分母、失败局结果（若已返回）和错误堆栈；
- 使用 `wx`，已有证据不能被同一路径重写；
- 保存后重新抛出异常，原恢复 finally 仍执行；不把失败变成通过。

新增UT验证完成结果可读取、失败局保留、重复写入被拒绝。Minimax core 432/432。本修复不能找回BP367进程退出前未保存的121局数据，不伪造旧记录。异常前尚未返回的单局仍只有定位信息，不宣称拥有其完整轨迹。

## 下一步

扩大验证目前继续BLOCKED。应将**战术效果比较**与**真实时间性能比较**分开：

1. 为战术对照建立明确的确定性V1时钟/计算预算协议，让OFF和ACTIVE使用相同条件；保留V1原有固定进度回退。
2. 将该协议标为新基线，不再要求它冒充旧Date.now运行结果；先重复验证输入、双方动作和结果可重现。
3. 性能测量另用真实单调时钟，不用合成时间评价性能，也不替代官方3秒证据。
4. 若要研究时间回退鲁棒性，应预注册多个对手预算profile分别报告，不选择对V2最有利的一个。

本轮没有改变production/V1字节、没有放宽历史重放断言，也没有删除漂移场景。
