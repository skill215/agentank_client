# Fact-layer scan B0（Step 2）

状态：2026-07-20 完成。锚定 [structural-repair-baseline-b0](structural-repair-baseline-b0.md)
（`workingSourceSha256 = d2f0791d…`）。未改算法、未 publish。

## 结论

对 R21 focused 全帧做观察 ↔ PhysicalState/tracker 错配扫描：

| 项 | 数量 |
|---|---:|
| 总帧 | 352 |
| 错配帧 | **0** |
| 可避免死亡帧 | 115 |
| 可避免且错配 | **0** |
| 现场复核 | 0（无错配可复核） |

**事实层不阻塞 EscapeObligation。** 可避免死亡池中未见「观察有弹/雷、PhysicalState 无对应实体」类 Hard 前缺陷。

## 复现

```bash
./tools/fast-regression-toolchain.sh scan-fact-layer \
  --output-name fact-layer-scan-b0
```

| 项 | 值 |
|---|---|
| 报告 fingerprint | `caa6e4c61892e5553c129f8a6f6443e7db54bb1819fc70fa62c4915a304974a3` |
| 路径 | `artifacts/fast-regression/reports/fact-layer-scan-b0/latest.json` |
| 源 focused | R21 `ffcc3b1b…` |

## 错配规则（烟雾级）

- 观察有 bomb、committed bomb = 0  
- 观察有 bullet、committed/possible projectile 皆无  
- committed bomb 远超观察  
- information incomplete 且观察危险未跟踪  

## 实现

- `tools/agentank/fast-regression/fact-layer-scan.js`
- CLI：`scan-fact-layer`
