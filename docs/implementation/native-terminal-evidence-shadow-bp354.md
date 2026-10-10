# BP354：单帧终局证据Shadow及完整性阻塞

## 结论

实现了只读诊断终局折叠器与FIRE单帧枚举器，未接入生产动作所有权。7个根全部返回INCOMPLETE，正确拒绝产生可执行证书。

关键阻塞已具体定位：**7/7根的informationGapMask都是8192，即POSSIBLE_ENEMY_PROJECTILE**。不是敌人不可见，也不是搜索预算不够；生产输入无法排除未观察到的敌弹。上一轮独立模拟器拥有完整世界状态，生产观察没有，因此其终局结论不能直接搬过来。

此外，扩大到冷却技能请求后，3格在FastKernel返回未完成：非poison技能冷却请求当前被标UNSUPPORTED_RULE。模拟器将其视为空操作，两者支持边界不同。这不是本轮新发现的对战物理错误，而是终局证据域要处理的明确规则缺口。

## 实现合同

`single-frame-terminal-evidence.js`仅位于diagnostics：

- 只检查FIRE，敌方枚举NONE/GO/LEFT/RIGHT/FIRE/BOMB/STUN及双方支持chance。
- 使用复制的FastState及生产搜索同型kernel，不污染活跃状态。
- 输出源hash、帧、行动、预期/实际格数、胜/平/负/未决、完整性条件。
- 每个响应index只能提交一次；重复或越界立即报错。
- 只有输入完整、Hard允许、响应全部覆盖且全部终局WIN，才输出条件性的ALL_TERMINAL_WIN。
- 未终局、规则未完成、预算截断、输入不完整一律INCOMPLETE；有终局平/负则不能作为全胜证据。
- 使用真实terminal code，保留同星runtime悲观语义；不把离线DRAW覆盖生产值。
- 无Risk写入、无action override，始终strictProof=false。尚未完成正式Proof接线及全域规则认证。

本版使用克隆、普通对象、BigInt覆盖mask，属于诊断实现；未声称零热分配或可直接上传。生产化需要复用现有状态回滚及固定整数位图，不引入另一套长期世界状态。

## 七个根结果

| 场景 | 胜格 | runtime负格 | 未完成格 | 总格 | 状态 |
| --- | ---: | ---: | ---: | ---: | --- |
| mat_4EIuA7AsxHTEjI60e | 7 | 0 | 0 | 7 | INCOMPLETE |
| mat_JuEUnL6J23K6wEiV3 | 9 | 0 | 1 | 10 | INCOMPLETE |
| mat_IQk3EW1Ww3x2cUqPJ | 8 | 1 | 1 | 10 | INCOMPLETE |
| mat_2jj27iM4EJ42l06t2 | 6 | 0 | 1 | 7 | INCOMPLETE |
| mat_AEteC4LDVUJBo90Sa | 7 | 0 | 0 | 7 | INCOMPLETE |
| mat_L2PhNahYZ5DA7jscD | 7 | 0 | 0 | 7 | INCOMPLETE |
| mat_LmbOK9Kf1DT4pile2 | 7 | 0 | 0 | 7 | INCOMPLETE |

全体enemyVisible=true、双方stun、FIRE已生成且Hard允许，唯一观察gap都是8192。即使4根矩阵全胜且无未完成格，也不能越过观察完整性门。

零预算检查7/7返回INCOMPLETE且seen=0。未将输出放宽到“多数分支赢”或“算完当前观察就完整”。

## 8192的来源

`production-observation.js`在非初始新callback中，若enemy.bullet为空且追踪器没有敌方活跃弹丸，就保留“无弹/存在未观察敌弹”两种可能，标记POSSIBLE_ENEMY_PROJECTILE。可见敌坦克不自动意味着所有敌弹可见。

因此这里存在两条独立事实：

1. 完整真实状态下FIRE在本地单帧响应域中获胜（BP353）。
2. 生产InformationState还含未覆盖的弹丸世界，因此没有严格胜利证书（BP354）。

两者不矛盾。不能通过清零8192、把visible等同complete、或给这7个场景白名单来修复。

## 下一步

优先做**命题所需的完整性**，而不是继续扩大普通搜索深度：

1. 检查这7根“未观察敌弹”的支持来源、数量界、位置/到达deadline约束；明确哪些世界可能在我方开火生效前改变结果。
2. 若能完整覆盖相关弹丸世界，则在它们之上枚举单帧终局；若能证明某类未知量对该命题无影响，记录独立不变性证据。无法证明时继续UNKNOWN。
3. 冷却技能应先核对规范失败动作语义及现有fixture，再选择完整规则实现或有证据的等效NONE归约，不在诊断器里默默跳过。
4. 仅在支持合同成立后接入现有Proof/所有权路径；终局效用与死亡风险分离的方向仍有效，但不能以有限真实世界见证冒充完整生产支持。

## 测试、证据与限制

- Minimax UT 391/391通过；新增2项检查完整覆盖、重复响应、缺失输入、Hard拒绝、平/负、未决及预算截断。护盾/逃生在这些新增UT中只是未终局输入类别，尚非完整物理反例fixture。
- 两次各7局冻结轨迹重建：首次验证状态，第二次仅补gap及failureReason日志。没有调参、接管动作或胜率筛选。
- 原动作/参数/事件计数保持一致；error、timeout、restore均0。
- 第一份证据保留在`artifacts/native-causal-audit/bp354-terminal-evidence-shadow/`；补充原因的证据为`bp354b-terminal-evidence-support/`，没有覆盖旧artifact。
- runner：`tools/agentank/diagnostics/terminal-evidence-shadow-run.js`。
- 生产tree仍为`285f9863227d6af3638bed74e008f0260fd25440034d95eec5e3f8cac44d9120`。
- 无production修改、提交、推送、官方simulate/publish/challenge。
