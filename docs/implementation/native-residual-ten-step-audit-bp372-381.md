# BP372–BP381：早期死亡十步审计

> BP382–BP383后续纠正：下述预测/模拟差异已定位到外部模拟器已知的炸弹phase偏差。既有DD1平台回放校准支持FastKernel的行动后爆炸顺序，因此不能按本报告的初步怀疑修改生产规则。详见 `native-global-realignment-bp382-383.md`。本报告其余样本计数不变。

## 总结

连续完成十项审计，不修改production，不新增胜率实验。固定13个历史失败局，各提取死亡前4帧，共52根。三次诊断重建共39局，分别用于初始抓取、修正报告归属及补充失败原因、复用既有冷却STUN规范化；不是39个独立样本。三次均逐项复现BP370双方动作、参数、星数/击毁等计数及终局。

**首要问题已从“是否应增加射击/搜索”转为一个可定位的模型与实际终局不一致。** 尚未定位到具体生产函数，不声称已证实Hard false positive或修复了胜率。

## 十步与验收

| 步骤 | 工作 | 结果 |
|---|---|---|
| BP372 | 冻结双负场景内前64帧单方死亡样本 | 13局；输入、源码、场景指纹绑定manifest |
| BP373 | 以BP370确定性V1时钟重建 | 13/13双方完整动作流、参数、终局和事件计数一致 |
| BP374 | 只采集死亡前4帧 | 52根；不保存完整replay |
| BP375 | 动作所有权对账 | incumbent 35根、base proposal 16根、无selected row 1根 |
| BP376 | Hard审计 | 51个选中行均Hard允许；1根全候选Hard拒绝后NONE |
| BP377 | Risk审计 | 6个选中行acceptable=0，均为全可接受集为空；选中dominated=0 |
| BP378 | EO审计 | NONE 34根、COMPLETE 17根、TRAPPED 1根 |
| BP379 | 搜索入口/预算审计 | 23根搜索、22根敌不可见、6根非接触、1根资源动作所有权 |
| BP380 | 条件化一帧全候选×敌动作×chance | 逐分支undo验证；不完整显式保留；不向Hard/Proof写入 |
| BP381 | 跨层归因、UT与下一修复排序 | 439/439 UT；发现1个完整观测下预测与实际死亡不一致的优先核查样本 |

以上“完成”表示审计步骤完成，不表示被审计算法正确或通过生产资格。

## 重要证据

### A. 完整观测下的终局不一致，优先级最高

场景 `mat_HT5bQROODWk50q4Fp`，V2 seat0，死亡于第32个执行帧（根frame31）：

- frame30：informationComplete=1、gap=0；EO TRAPPED，所有实际候选Hard拒绝，最终NONE。
- frame31：informationComplete=1、gap=0；EO COMPLETE，committed实体2个，选中GO且Hard允许。
- 诊断FastKernel对GO枚举10个敌动作/chance分支：1 WIN、9 LIVE、0 LOSS、0 ownCrash、0 incomplete。
- 同一局真实模拟执行流在该帧GO后单方死亡，且与冻结BP370动作/结果精确一致。

这是**预测/事实不一致的核查入口**，不是“GO选择错”的充分证据。可能涉及观察重建、实体时刻、过期/行动顺序、状态桥、诊断kernel或官方模拟规则；需从原始模拟状态对齐后分辨。也不能拿frame30一帧暂未死亡反驳多帧Hard死亡链。

建议下一修复直接围绕此样本建立模拟器/适配器/FastKernel逐phase差分和独立UT；在定位之前不改变Risk、EO排序或提高深度。

### B. 不可见敌人是主要覆盖边界

52根中22根为ENEMY_NOT_VISIBLE；13个最终死亡根中8个属于该类。条件模型缺少隐藏世界支持，预测未死不能证明现实安全。应该先确认实际伤害来自已观察弹丸、隐藏来源、炸弹还是碰撞，再决定修复事实追踪或Information覆盖。

### C. 搜索确实运行，但没有完整支持

23个搜索根总计3800节点、1060个budget leaves；每根currentDepth=3、lastOwnershipSupportComplete=0。此处使用真正的policySearch根指标，不是逐局摘要里恒零的通用searchRoots。1060是截断叶计数，不是1060次实际失败。

该结果支持后续做匹配根预算消融，但不证明增加预算能修复这些死亡；先解决A类规则/状态一致性，否则更深只会放大错误模型。

### D. 没有证实需要继续放宽Risk或增加FIRE奖励

FIRE在36根候选中出现，30根Hard允许、20根Risk允许、4根实际选中。未选中并不等于错失击毁。6个风险外选择全部是空集fallback，当前证据没有“有可接受安全动作却绕过门禁”的例子。

归一化后的条件矩阵中4根选中动作存在一帧LOSS响应；未找到另一动作在全部枚举响应中完整且零LOSS。这个0仅是有限观察模型的诊断结果：**不是没有逃生路径，也不是算法正确证明**。

## 诊断完整性限制

- 初始45根至少存在一个不完整响应；复用已验证的cooldown STUN→NONE终局物理等价规则后为28根。
- 剩余不完整分支：171次COOLDOWN_NON_POISON_SKILL（信息缺口下不能擅自视冷却已知）、14次JOINT_TANK_RELOCATION。
- 敌响应固定NONE/GO/左右转/FIRE/BOMB/STUN，并覆盖chance；不声称覆盖所有隐藏世界。
- 单帧LIVE不代表4帧或整局存活；分支数量也不是敌动作概率，不能用简单比例作为真实胜率。
- 未执行替代动作的整局因果对战，没有新增恢复胜局可报告。
- 诊断捕获/矩阵有临时对象和克隆，仅离线使用；不能据此宣称生产零分配或性能提升。

## 可复用入口和证据

```sh
node tools/agentank/diagnostics/residual-ten-step-audit.js <新的输出目录>
node --test --test-isolation=none test/minimax-core/*.test.js
```

正式分析取 `artifacts/native-causal-audit/bp372-381-residual-ten-step-audit-normalized/`。前两次目录保留为诊断工具演进证据，不混入最终分母。

新增UT约束：selected=-1不能归为proposal owner；不完整替代不得计作完整零LOSS；条件替代分类不产生Proof。复用全套冷却规范化、状态恢复和minimax既有UT，共439项通过。

production tree始终为 `285f9863227d6af3638bed74e008f0260fd25440034d95eec5e3f8cac44d9120`。无发布、simulate、challenge，无策略/预算修改。
