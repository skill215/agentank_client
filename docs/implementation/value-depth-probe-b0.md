# Value-depth probe B0（Step 3b 诊断）

状态：2026-07-20 完成离线诊断。锚定 R21 dominated/focused 报告（B0 源 `d2f0791d…`）。
运行时工作树已含 EscapeObligation（`sourceDrift=1`）；本探针只读冻结报告，不重跑引擎。

## 结论

`DOMINATED_RESCUE` 中 `VALUE_DEPTH_NON_DISCRIMINATION` **23** 例：

| 项 | 值 |
|---|---:|
| `p0-i1` | **19** |
| `p0-i2` | 2 |
| `p0-i0` | 1 |
| `p1-i0` | 1 |
| physicalDepth = 0 | **22** |
| informationDepth = 0 | 2 |
| rescue 严格更好 robust | 5 |
| selected/rescue robust 相等 | 0 |
| selected/rescue expected 相等 | 0 |

**主信号：Physical 深度几乎全为 0，信息侧多为 depth 1。**  
叶/浅层价值常让 selected 的 robust/expected **不低于**救援动作，但 `escapeSlack` 多为 -1，逃生链未被价值层拉开——与 Step 1 的 `INFORMATION_ONLY`（17/25）同向，**不是** EscapeObligation（无 committed）能单独修好的。

## 复现

```bash
./tools/fast-regression-toolchain.sh probe-value-depth \
  --output-name value-depth-probe-b0
```

| 项 | 值 |
|---|---|
| 报告 fingerprint | `829f4a3c7be7474b3cffe8718c0e97cba168433cb77394e6c6fc0fdc92b47e32` |
| 路径 | `artifacts/fast-regression/reports/value-depth-probe-b0/latest.json` |
| dominated | `43db5cc5…`（R21） |
| focused | `ffcc3b1b…`（R21） |

## 对后续修复的含义

1. **不要**用 EscapeObligation 覆盖这 23 例。  
2. 优先修：叶闭包 / Safety–Risk 对 escapeSlack 的排序、或预算化 Information 递归（复用修正后的 Value 语义）。  
3. `PATH_RISK_INVERSION`（7）等其它 dominated 根因另开，勿与 value-depth 混修。

## 实现

- `tools/agentank/fast-regression/value-depth-probe.js`
- CLI：`probe-value-depth`
