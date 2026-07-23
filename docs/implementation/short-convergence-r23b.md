# 短收敛 R23b（收紧 enemyNear / contactPrep）

状态：2026-07-20。在 R23 CONTINUATION 清零之后，压掉 vs R22c 的
`SURVIVE→DIE`，同时保住 CONTINUATION 8/8。

## 结论

| 维度 | 结果 |
|---|---|
| CONTINUATION 8 固定续写 | **8 / 8**（`survivalStillDies`=0） |
| `npm run test:4` | **205/205 PASS** |
| 主池 vs R22c | 75→**87**（+12，`SURVIVE→DIE`=**0**） |
| 控制 vs R22c | 68→**68**（`SURVIVE→DIE`=0） |
| 主池 vs R21 | 50→**87**（+37，`SURVIVE→DIE`=0） |
| 主池 vs R23 | 86→**87**（+1；有帧级换手） |
| 评估 vs R22c / R21 | **`NET_IMPROVEMENT_NO_REGRESSION`** |

## 归因（R23 误伤）

R23 的 7 例主池 `SURVIVE→DIE`（+1 控制）几乎都是 **GO/NONE→TURN_***：

| 触发 | CONTINUATION 需要 | S2D 误伤 |
|---|---|---|
| `manhattan≤2` enemyNear | 弱依赖 | 07a / 574bb 等 |
| contactPrep = 贴敌即降级 GO | 11ef 需要贴敌+committed | NONE 存活帧 |
| softScene 在「只剩一侧 TURN」时无条件降级 GO | 826c / 3528 | f594 / 29bda / 07a / 7dbb |
| 清出 GO 一律让位 TURN | 64c3 / 7b16 | 574bb（清出 GO 才活） |

## 收紧规则（`escape-obligation.js`）

1. **去掉** stay 上 `manhattan≤2` enemyNear。
2. **contactPrep** = 贴敌 **且** `committed > 0`（敌方炸弹/弹丸实体）。
3. **softEscape** = softScene 且可动逃 **且非** 贴敌（避免 own-bullet 场景强行逃）。
4. **去掉** softScene「只剩一侧 TURN → 降级 GO」；仅保留 facesToward 背敌转向。
5. **清出 GO 降级**仅保留几何条件：`contactPrep` / `axisClearing`（同轴敌+爆圈）/
   `corridorClearing`（两侧 TURN 中仅一侧 forward GO 开）。
6. **Contact step（facing 分流）**：
   - GO 落点贴敌且仍有 blast 压力 → 降级 GO（单测 + 非清出接触）。
   - 清出 GO 落入**未被敌朝向**的贴敌格 → 降级 GO（保 `826c` TURN）。
   - 清出 GO 落入**敌朝向**的贴敌格 → 降级仍处爆圈的 TURN（保 `574bb` GO）。

## 探针 / 对照（短收敛时）

短收敛当帧的 focused 报告名为 `native-poison-death-short-convergence-r23b`。

## 全量回归验证（正式）

```bash
npm run test:4
./tools/fast-regression-toolchain.sh verify --cohort initial-full --lane capsule-all
./tools/fast-regression-toolchain.sh diagnose-focused \
  --cohort native-poison-death \
  --report-name native-poison-death-full-regression-r23b
./tools/fast-regression-toolchain.sh probe-death-categories \
  --allow-source-drift \
  --prior-report artifacts/fast-regression/reports/death-category-probe-b0/latest.json \
  --category-filter CONTINUATION_ESCAPE_GAP \
  --output-name death-category-continuation-full-r23b
./tools/fast-regression-toolchain.sh compare-focused \
  --before-name native-poison-death-post-migration-full-r21 \
  --after-name native-poison-death-full-regression-r23b \
  --output-name full-regression-r23b-vs-r21
./tools/fast-regression-toolchain.sh compare-focused \
  --before-name native-poison-death-step6-r22c \
  --after-name native-poison-death-full-regression-r23b \
  --output-name full-regression-r23b-vs-r22c
./tools/fast-regression-toolchain.sh compare-focused \
  --before-name native-poison-death-continuation-cleared-r23 \
  --after-name native-poison-death-full-regression-r23b \
  --output-name full-regression-r23b-vs-r23
```

| 项 | 结果 |
|---|---|
| `npm run test:4` | **205/205 PASS** |
| Capsule-all | **ACCEPTED**，19,136/19,136，不变量全部 **0** |
| Capsule fingerprint | `98043570462d9e5a046fad3b65c41b5f67ea30df5b8a2fb5dffdc9e301ba2a49` |
| 墙钟 | `totalRuntimeMicros ≈ 45.3s` |
| CONTINUATION | **8/8**（`survivalStillDies`=0） |
| Focused report | `native-poison-death-full-regression-r23b` / `063cbce6…` |

| 不变量 | 计数 |
|---|---:|
| avoidable Hard reject | 0 |
| risk-dominated selection | 0 |
| strict Proof false positive | 0 |
| root restore failure | 0 |
| Capsule failure | 0 |

### Focused 对照

| 对照 | 主池 | S2D | 控制 | 评估 |
|---|---|---:|---|---|
| vs R21 | 50→**87**（+37） | **0** | 68→68 | `NET_IMPROVEMENT_NO_REGRESSION` |
| vs R22c | 75→**87**（+12） | **0** | 68→68 | `NET_IMPROVEMENT_NO_REGRESSION` |
| vs R23 | 86→**87**（+1） | 7（D2S=8） | 67→68 | `NET_IMPROVEMENT_WITH_REGRESSIONS` |

| 报告 | fingerprint |
|---|---|
| CONTINUATION full | `23e6576738a5abb937678e2bf2498180c5c57c50d47d0f1fe2ef93e598a74b5d` |
| vs R21 | `f77fc75bee379f45f777a35e2e5268a1c84b95fece5753b875ce4cf55becda19` |
| vs R22c | `1e5d2e3a923876fa0c58fbf8f8e0584def4bf6bd9bcd22840f65f4435327ec0c` |
| vs R23 | `060840eac3251f2cd16af5901368ac97a6300b5f63fc80f07448bed3613016bc` |

工作源：`6c6387e5c21a6146aa6f186d396c7e838b8b9fa4a8891d0058240b4d4a2d0993`

## 边界

- facing 分流是几何规则，不是 fingerprint 硬编码。后续已进入
  [Escape Quality Phase0–4](escape-quality-phases.md)：Membership/Quality 拆分；
  「清出+朝向降 TURN」已由 Quality `stillExposed` 退役；unfaced contact / corridor 仍为
  TemporaryMembershipPatch（见 [escape-quality-metrics.md](escape-quality-metrics.md)）。
- vs R23 仍有帧级换手（7 S2D / 8 D2S），但主池与控制净值均为正，且相对 R22c/R21 无 `SURVIVE→DIE`。
- Production 瘦身仍独立。
