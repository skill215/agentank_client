# 回归基线刷新（742 V1 场景）

状态：2026-07-21。用同步后的真实 V1 对战地图重跑 V1/V2 模拟，并**替换**本地
fast-regression 证据；不保留多份历史报告 / 旧 run / 旧 snapshot。

## 结论

| 项 | 值 |
|---|---|
| History | **742** 场景 / **735** 地图（相对旧 598：**+144**） |
| Working-arena | 5936 场（×2 reps），V2 胜 **1085** / 负 4851 |
| Capture run | `run-068b60d6c20007e45df07d14863decb9fc50f5264050f7e6c1af769f69cf7b1a` |
| Capture 分母 | 2968 场 / **23744** Capsule（旧 19136） |
| Capsule-all | **ACCEPTED** `965111e7863987e2…`，失败 0 |
| Focused | `native-poison-death`：主池 58/64 有固定续局逃生；控制 75/96 窗内存活 |
| 玩法门（analyze-run） | **REJECTED**（单崩/总分率未过；可靠性 PASS） |

## 命令摘要

```sh
./tools/fast-regression-toolchain.sh sync-history
./tools/v1-v2-working-arena.sh --repetitions 2 --progress-every 64
./tools/fast-regression-toolchain.sh capture --repetitions 1
# materialize OOM 后：修 spool 常驻内存后续跑
NODE_OPTIONS=--max-old-space-size=8192 \
  ./tools/fast-regression-toolchain.sh materialize-spool \
  --spool artifacts/fast-regression/.work/capsule-spool-… \
  --run-id run-068b60d6…
./tools/fast-regression-toolchain.sh analyze-run --run-id run-068b60d6…
./tools/fast-regression-toolchain.sh build-cohort --maximum 64 --name initial-full
./tools/fast-regression-toolchain.sh build-focused --run-id run-068b60d6… \
  --source-cohort initial-full --maximum-losses 64 --control-count 16 \
  --name native-poison-death
./tools/fast-regression-toolchain.sh diagnose-focused --cohort native-poison-death \
  --report-name native-poison-death
./tools/fast-regression-toolchain.sh compile-replay --cohort initial-full
./tools/fast-regression-toolchain.sh verify --cohort initial-full --lane capsule-all
```

## 工具链修补

`materializeCapsuleSpool` 不再把全部 Capsule 对象堆在堆上（20k+ 草稿会 OOM）；
只写盘计数。见 `tools/agentank/fast-regression/capture.js`。

## 磁盘策略

替换时删除旧 `reports/*` 多版本、旧 `v1-v2-working` token、旧 capsules/runs、
旧 history snapshot/delta/run-manifest；报告目录只保留 `latest.json`。
`battle-records/` 保留（平台语料，不是回归副本）。
