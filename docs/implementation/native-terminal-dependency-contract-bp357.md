# BP357：局部终局命题的依赖合同

## 本轮交付

新增Shadow依赖检查器，不是新的Proof引擎，也没有生成真实规则证书。它明确区分有限响应结果、压力测试、独立模拟器差分和规则级不变性依据，防止把BP353–356的大量通过记录误用为生产放行资格。

复用冻结证据审计7个根，没有新对战或重建。4个根在FastKernel已枚举分支中全部终局胜；3个还有冷却未完成或同星悲观结果。7个均INCOMPLETE，ignoredGapMask均0，未覆盖任何动作。

## 检查项

`TerminalDependencyContract`维护少量标量，evaluate不分配按动作数组、不改输入数据。它检查：

- 身份：具体frame、双状态hash、FIRE行动及规则源码SHA-256必须一致；缺失、非法或过期身份拒绝。
- Hard允许，完整响应域已成立，expected/seen/结果分母一致，全部分支终局WIN。
- 可考虑局部豁免的缺失仅8192；其他gap始终拒绝。
- 三项明确绑定同一身份的规则依据：终局相位适用范围、额外敌弹不取消敌方死亡、分支终局星差严格为正。
- 压力测试和模拟器差分不能充当这些规则依据。

全部满足时输出`SHADOW_DEPENDENCIES_SATISFIED`，不是PROVEN，也不调用FinalActionGate或改变Safety/Risk。全局informationComplete保持原样。

证书字段只是可检查的接口合同：当前检查器验证身份、类型和引用，不验证引用中数学论证的真伪；它不是防伪系统。生产化必须由受控规则证明器产生这些信息，不能把用户或任意调用者传入的VERIFIED字符串当作真实证书。

## 现有证据的缺口

| 检查项 | 已有情况 | 是否可放行 |
| --- | --- | --- |
| 对应根Hard允许FIRE | 7/7 | 单项通过 |
| 枚举格全部WIN | 4/7 | 不等于完整响应域 |
| 完整平台命令域证明 | 未建立；当前为stun primitive实验域 | 否 |
| 未知敌弹不变性规则依据 | 有单弹、多弹有限压力证据，无通用依据 | 否 |
| 终局相位适用范围 | 有源码检查和相位反例，未闭合跨实现范围 | 否 |
| 所有相关世界终局星差下界 | 有具体分支星数，未建立未知量作用下的下界 | 否 |

审计中`domainComplete=false`及三项证书为空是对现有证据状态的诚实记录，不是新发现七个物理失败；不会通过将这些字段硬写true“恢复胜率”。

## 下一步实施顺序

不再增加压力枚举分母。下一步应开发窄规则依据的生产者：

1. 固定当前可支持的单帧stun primitive规则范围，明确冷却失败请求的等价归约；不能忽略FastKernel UNSUPPORTED。
2. 从真实输入检查行动前危险、射击可执行性、对方shield/effect、射线与后继位置。只给满足前提的根提供规则范围证据。
3. 针对“已发射我方子弹仍会执行，额外敌弹不能阻止敌方当帧死亡”的命题做相位论证；不支持的地图破坏、盾、炸弹或多动作情况拒绝。
4. 计算分支后星差下界；根领先不能直接代替结算领先。
5. 用这7个根检查覆盖率，另用反例检查拒绝正确性；先Shadow，未完成不进入ACTIVE。

本轮没有修复对战胜率。它完成的是防止错误证据获得动作所有权的合同，以及下一步规则实现的具体输入/输出边界。

## 测试与文件

- Minimax UT 399/399通过，新增5项：状态/规则/动作身份、禁止压力测试冒充规则依据、逐项必要条件、过期依据、非法身份/结果分母。
- 测试中的VERIFIED依据均为合成对象，用来测试合同，不是这些真实局面的证明。
- 工具：`tools/agentank/diagnostics/terminal-dependency-contract.js`、`terminal-dependency-audit.js`。
- 测试：`test/minimax-core/terminal-dependency-contract.test.js`。
- 初版证据：`artifacts/native-causal-audit/bp357-terminal-dependency-contract/`。
- 增补非法输入检查后的最终证据：`artifacts/native-causal-audit/bp357b-terminal-dependency-contract-validated/`，旧证据未覆盖。
- 生产tree保持`285f9863227d6af3638bed74e008f0260fd25440034d95eec5e3f8cac44d9120`。无production修改、提交、推送或平台操作。
