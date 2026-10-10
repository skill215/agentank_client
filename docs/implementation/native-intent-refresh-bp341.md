# BP341：只恢复目标更新，不增加动作所有权

## 结论

BP340发现的source→intent.prepare生命周期耦合真实存在，但目标字段为空并不是本批退化的充分解释。只恢复目标更新后，9个已知失败案例仍然9负，双方动作流、参数、事件和结果全部未变。

因此不能把“独立刷新意图”包装成胜率修复。缺少的是目标参与动作选择的通路，或者可靠的原导航承接，而不只是目标数据。生产默认仍未修改。

## 最小改动合同

新增诊断辅助函数`refreshOnMissingSource(owner, engine, count, source)`：

- 有source时原样返回，不重复prepare，原有后置意图更新保持原顺序。
- 无source时调用intent.prepare，随后仍返回原来的空source。
- 不产生ActionOwner提案，不调用commitSelection，不修改Hard/Risk/搜索结果或原incumbent。
- 每次缺失source刷新后检查lastIntent和lastIntentEpoch未被提交；source返回对象身份不变。

仅在原owner已经进入source边界的根上验证，不覆盖hidden/非接触/strict proof等更早返回路径。不宣称完成了全局每帧目标生命周期改造，也不直接迁入production。

## 18条轨迹验证

继续使用BP340的9个已知退化案例，禁止据此估计一般胜率。

| 路径 | source调用 | 无source时刷新 | 胜/负/平 | 相对各自冻结轨迹的动作/事件/结果变化 |
| --- | ---: | ---: | --- | --- |
| 原入口＋刷新包装 | 707 | 0 | 7/0/2 | 0/0/0 |
| 受限入口＋仅刷新 | 851 | 83 | 0/9/0 | 0/0/0 |

第二行的对照是原CURRENT_GEOMETRIC，而不是第一行。83次均为原几何入口跳过；没有其他source失败情形混入。原入口707次全部有source，本批只能证明包装在这些成功路径上等价，不能推断所有unsupported/incomplete情形。

首分歧9/9均恢复非空星目标及映射动作，最终提案仍为null。8/9映射动作不同于incumbent，但因没有新的动作所有权而未执行。8d1a案例的意图映射LEFT与incumbent相同，原搜索却选择GO——再次说明直接执行意图不是搜索的等价替代。

两条结论必须分开：

1. 生命周期拆分可让目标数据恢复，这是合同修复方向。
2. 它没有改变这些局的行为，因此不能解释或修复整局输赢。真正的行为差异仍在搜索＋意图共同仲裁与原导航之间。

## 下一步

不要给目标映射自动增加最终选择权，也不要重启距离阈值扫描。先追踪无搜索时原incumbent的产生过程，重点覆盖BP340窗口中的重复转向：候选生成、静态路线、Hard/Risk成员资格、目标评分、方向tie-break、重复pose约束分别输出了什么。

用共同根检查“真正朝目标推进的GO/转向”是没有生成、被排除，还是生成后分数不够；与原搜索提案比较。若定位为原导航的确定性缺陷，应独立修复导航合同并用正反UT约束，而不是把Minimax意图加分强行接成另一个总分所有者。

几何入口仍不推广。仅分层128的性能资格独立保留，不与本次仅刷新结果混用。

## 检查与文件

- Minimax UT370/370通过，新增缺失source刷新但不创造提案/替换source的测试。
- 18条轨迹timeout/error/root restore均0；源码tree保持`285f9863227d6af3638bed74e008f0260fd25440034d95eec5e3f8cac44d9120`。
- 工具：`tools/agentank/diagnostics/intent-source-decoupling.js`及`intent-refresh-validation.js`。
- 产物：`artifacts/native-causal-audit/bp341-intent-refresh-only/`，manifest、overview、压缩逐局摘要合计23611字节；没有完整replay。
- 没有生产修改、提交、推送、simulate、publish或challenge。
