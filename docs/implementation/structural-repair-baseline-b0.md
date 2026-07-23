# Structural-repair baseline B0

状态：2026-07-20T18:46+08:00 冻结。本基线只记录语义修复开始前的可复现身份；
**不**修改算法、**不**重建 Candidate、**不**调用官方 simulate/publish。

Production 体积压缩保持独立流水线：本基线的语义指纹与 minify 瘦身验收指纹不得混用。

## 1. 工作源码身份

| 项 | 值 |
|---|---|
| `workingSourceSha256` | `d2f0791de39267d6742a9c8e83dd70b441b25e7a631c98d51be3f265dbc9d892` |
| 计算方式 | `sourceIdentity()`：`engine-v2/src/**/*.js` 相对路径 + 每文件 SHA-256，再对拼接文本 SHA-256 |
| 文件数 | 79 |
| 与 R20/R21 | **相同**（R21 / dominated-rescue 报告中的 `workingSourceSha256`） |
| Git HEAD | `643ae1e967d8c2cc00344900f894d4f54f2f9b78`（`draft`） |
| 脏工作区（文档） | `M docs/implementation/README.md`；`?? docs/implementation/full-regression-r21.md` |
| Node | `v24.16.0` |
| `package-lock.json` SHA-256 | `b7f2c2cfc5cc2154d1e90a1bd18a4dc80e51b1ca69faf117bd595b8c60d27bb0` |
| `imp6-runtime-build-profile.json` | `198e0760fb9977be810e304d41261000dadf2ed8497b836fb7b1e7e3caa2b62d` |
| `platform-code-size-policy.json` | `93bdf03129a864cfc2a6bd4f018b27ee1cc43f815568fc44916b48970985fb5b` |

复现：

```bash
node -e "const {sourceIdentity}=require('./tools/agentank/diagnostics/v1-v2-working-arena'); const {defaultWorkspaceRoot}=require('./tools/agentank/core/paths'); console.log(sourceIdentity(defaultWorkspaceRoot()).sha256)"
```

## 2. 测试门（本轮重跑）

| 命令 | 结果 | 耗时 |
|---|---|---:|
| `npm run test:4` | **183 / 183 PASS**（fail 0） | 5659.75 ms |

范围：`test/sr0`–`sr4`、`test/minimax-core`、`test/fast-regression`。

## 3. R21 回归桶（已有不可变证据，本轮未重跑全量 Capsule）

| 桶 / 不变量 | 数量 |
|---|---:|
| Capsule completed | 19,136 / 19,136 |
| avoidable Hard reject | 0 |
| risk-dominated selection | 0 |
| strict Proof false positive | 0 |
| root restore failure | 0 |
| Capsule failure | 0 |
| 历史死亡窗口存活 | 50 / 256 |
| 存活控制 | 68 / 96 |
| `CURRENT_SURVIVOR` | 50 |
| `NO_ACCEPTABLE_RESCUE` | 55 |
| `DOMINATED_RESCUE` | 39 |
| `RESCUE_AT_OR_ABOVE_FLOOR` | 12 |
| `LOWER_ROBUST_RESCUE` | 9 |

`DOMINATED_RESCUE` 根因：

| 根因 | 数量 |
|---|---:|
| `VALUE_DEPTH_NON_DISCRIMINATION` | 23 |
| `PATH_RISK_INVERSION` | 7 |
| `PATH_FRONTIER_NOT_ACTIVATED` | 4 |
| `PATH_SUPPORT_OTHER_INCOMPLETE` | 4 |
| `PATH_SUPPORT_POSSIBLE_PROJECTILE` | 1 |

证据文件：

- Capsule-all：`artifacts/fast-regression/reports/capsule-all/a701aff1f9faa087553b278c58f6af2c775d1ab0c5f1b80174098759642ebfa5.json`
- Dominated-rescue：`artifacts/fast-regression/reports/dominated-rescue-post-migration-r21/43db5cc52afc3118e03a547431dc716a050dfbce1e6c67a83f3d09c4702eac68.json`（fingerprint `43db5cc5…`）
- R21 vs R17：`artifacts/fast-regression/reports/full-regression-r21-vs-r17/027adfa802863c3d04643da6841d6a55d48af0c6db06ef1014f89e78e37f5d3d.json`
- 概述：[full-regression-r21.md](full-regression-r21.md)

## 4. Production 体积（独立测量；不与语义修复混验收）

| 产物 | UTF-8 字节 | 备注 |
|---|---:|---|
| `artifacts/build/imp6/production-source.js` | 412,201 | 现有产物 |
| `artifacts/build/imp6/production-minified.js` | 397,799 | 平台硬限 204,800；预警 190,000 |
| BuildManifest fingerprint | `1cea9e28f7cf9d4329635d4943452cb68fcc211218b7fe78e27af9b7af73ae9f` | |
| minifiedHash | `2475a51029162c34d2a2612358fbbeb9a3bd8f40fb812bcc33b8ce3f4985c3d9` | |
| sourceHash | `22a70eac688dbdd47bfb9efa7f4dc983022dd5985e5c61e488bc9acd9d716f9b` | |
| platform headroom | -192,999 | `PLATFORM_LIMIT_EXCEEDED` |

### 构建漂移警告

将 BuildManifest 的 `moduleFingerprints` 与当前工作树比对：**50 个生产模块中 1 个不一致**：

| 模块 | Manifest | 当前工作树 |
|---|---|---|
| `engine-v2/src/search/risk-acceptance-controller.js` | `bcbb01c4…` | `5cea9117…` |

因此：**当前 minified 字节不能当作 `d2f0791d…` 工作源的上传候选测量**；它是略旧的 IMP6 产物。语义修复以 `workingSourceSha256` 为准。需要体积门时，应在语义冻结点单独 `imp6:verify` 重建后再测字节。实验性 mangle 约 289,849 字节的历史观测仍仅作参考，不写入本语义基线验收。

## 5. 参考 benchmark 身份（未本轮重跑）

| 项 | Fingerprint |
|---|---|
| search-frontier | `6a22ce006327e17acbc778cf58baee125089b42056dcacc7e245dd610d31ceae` |
| multi-frame-risk（latest） | `ab97c3ed5f956035bfab0d0b768329b881730c12686c9f3fdf77b8bd66a45746` |

## 6. 基线用途与下一步

后续结构修复（死亡四类分桶 → 事实层烟雾 → EscapeObligation 等）必须以本文件的
`workingSourceSha256 = d2f0791d…` 为变更前锚点：

1. 任何 `engine-v2/src` 修改都会改变该指纹；
2. 回归比较应相对 R21 桶与本轮 `test:4`；
3. Production minify / mangle / specialization 另开构建流水线，不得与搜索语义改动共用同一次验收指纹。

下一步：Step 1 — 死亡四类分桶探针（约 20–30 根）。
