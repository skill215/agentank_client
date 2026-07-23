# Information recursion（Step 5）

状态：2026-07-20 完成。建立在 [value-depth-step4](value-depth-step4.md) 的 Value 语义之上。

## 目标

将生产 `ProductionInformationSearch` 从固定 `completedDepth = 1` 扩为**预算化** depth≤2：
根仍是 Information 矩阵（HiddenWorld × EnemyAction × Chance）；depth-2 叶用
Physical `continuationValue` 代替普通 heuristic（复用 Step 4 的浅层叶修正仅在
depth-1 回退路径）。

## 验收约束

| 约束 | 实现 |
|---|---|
| depth 1 与改前一致 | `decisionDepth≤1` 或 continuation 池不足时走原矩阵+`adjustShallowLeaf` |
| 预算中断 | 池耗尽后叶回退 heuristic；`approximate=1` |
| root restore | 搜索结束校验 hash/mark；失败则 `completedDepth=0` |
| 不冒充完整 Info 递归 | depth 2 时 `supportComplete=0`（Physical continuation 非 observation-split 策略） |
| 量词顺序 | 根仍为 Chance ⊂ Hidden ⊂ Enemy（与 depth 1 相同） |

## 机制

1. `ProductionDepthSearch.continuationValue`：在已 apply 的物理态上跑短 Physical
   minimax（宽≤4），**不** `commit` `completedDepth`。
2. `ProductionInformationSearch.search(..., decisionDepth)`：
   - 矩阵成本算完后，若 `decisionDepth≥2` 且 `leftover≥32`，开启 depth 2；
   - 共享 `continuationPoolRemaining`；每叶最多 `continuationLeafBudget`（8–48）；
   - 预算紧时优先削减 hidden worlds / 第二朝向，给 continuation 让路。
3. `production-root` 传入 `searchOptions.decisionDepth`。

## 现场（R21 value-depth 23）

| 项 | Step 4 后 | Step 5 初版 | 3b 复访后 |
|---|---:|---:|---:|
| Info `completedDepth=2` | 0 | 9 | **21** |
| 固定续局存活翻转 | 4 | 5 | **12** |
| 平均搜索节点 | — | ~119 | **~54** |

残差诊断与性能细节见 [value-depth-residual-post-s5](value-depth-residual-post-s5.md)。

## 门禁

- `test/sr5/information-recursion.test.js`（depth-1 分数不变；depth-2 启用；continuation 还原）
- `npm run test:4` → **197/197 PASS**（已纳入 `test/sr5`）
- 工作源 `workingSourceSha256`：`5c5168728b5f31e9c7f9f330138eef638ec7aef1e46e40fbe6f2813a1db846a6`

## 非目标

- 完整 InformationState observation-split 策略递归（depth 3–4 Oracle）
- ForcedWin 推广到 HiddenWorld
- minify 体积
