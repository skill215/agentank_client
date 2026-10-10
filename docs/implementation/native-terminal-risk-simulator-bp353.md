# BP353：终局风险的独立模拟器差分

## 结论

BP352的122个生产物理响应格，与固定版本独立模拟器的单帧结果逐格一致。补充8个原生成域省略的冷却中STUN请求后，共130格；新增项均为不能实际施放的请求，其效果按模拟器规则退为空操作。

FIRE共55格：54胜、1平、0负。原选择转向共75格：9负、66未终局。6个领先局的FIRE在枚举域内均获胜，同星局为9胜1平。

因此这批样本的主要问题不是“FIRE收益分太小”，也不是“必须冒更大风险才会打赢”。在这些有限、完整状态的本地单帧分支中，死亡惩罚正在遮蔽终局获胜收益。接下来应补通终局证据的消费路径，而非提高全局开火权重。

## 独立性和实验方法

物理参考实现为仓库固定vendor模拟器；记录其`engine.js` SHA-256，不修改vendor或production。

重建7局原轨迹，在目标帧的模拟器step之前克隆真实状态。克隆包括双方效果、资源、弹丸、炸弹、地形和星。对每个克隆使用模拟器自身step执行联合动作，而不是V2 FastKernel。

枚举我方原选择与FIRE，敌方NONE/GO/LEFT/RIGHT/FIRE/BOMB/STUN七种单指令；技能均为stun。直接根据模拟器真实debuff期限推导GO/转向的正常与反向分支，按座位顺序提供显式随机值，并核对随机调用数量。不可用请求也保留，形成单指令的保守超集，而不是只依赖V2生成域。

对原122格比较自身/敌方crash、双方星数及忽略runtime的结果，差异0；原chance支持无遗漏。各分支运行后检查自然模拟器状态未变。七局自然轨迹的双方动作/参数、事件计数及结果仍与BP349完全一致。

克隆只执行一帧，禁用下一颗星生成以免共享历史星提供器游标；现有星拾取照常执行。所有FIRE分支当帧终局，因此无需后续星序列。原转向未终局分支只标为未解，不推导后续价值。

## 结果

| 场景 | FIRE胜 | FIRE平 | FIRE负 |
| --- | ---: | ---: | ---: |
| mat_4EIuA7AsxHTEjI60e | 7 | 0 | 0 |
| mat_JuEUnL6J23K6wEiV3 | 10 | 0 | 0 |
| mat_IQk3EW1Ww3x2cUqPJ | 9 | 1 | 0 |
| mat_2jj27iM4EJ42l06t2 | 7 | 0 | 0 |
| mat_AEteC4LDVUJBo90Sa | 7 | 0 | 0 |
| mat_L2PhNahYZ5DA7jscD | 7 | 0 | 0 |
| mat_LmbOK9Kf1DT4pile2 | 7 | 0 | 0 |

格数不是概率；不按54/55估计胜率。某些根的敌方stun影响移动，响应格数因此多于七。

## 不能越过的证据边界

- 证据级别是PINNED_LOCAL_SIMULATOR，不是官方simulate或平台规则的全量认证。
- 使用模拟器完整状态验证了真实世界的一组分支，不等于证明生产InformationState所有隐藏支持世界。
- 覆盖当前stun单指令及其随机分支，不覆盖其他技能、boost组合或所有平台脚本多动作语义。
- 同星互毁继续按离线分析合同计平；没有修改生产对runtime同星的悲观假设。
- 不把非终局转向分支宣称为必负；只能确认FIRE在这组域内具有完整终局结果。
- `strictProof=false`，不允许凭场景ID/帧号白名单覆盖生产动作。

## 下一步：窄终局证据路径，先Shadow

优先复用现有严格证据/动作所有权接口，限定单联合帧、可见且支持完整、所有合法敌方响应及chance均覆盖的终局行动。输出终局结果下界、支持完整度和源状态身份；不以普通search completedDepth或tactical=10000冒充证书。

只有经验证的终局分支可以替代该分支的死亡效用惩罚；保留原死亡统计，不全局清零风险。未完成、隐藏支持不足、非终局分支保持原路径。Hard仍在最终门上，possible威胁不升级成Hard。

先Shadow确认这6个领先互毁例可被完整证据识别，并加入落后互毁、同星runtime、敌方护盾、可闪避、冷却和预算中断反例。再决定是否做ACTIVE因果实验；不直接将这次分析的9胜1平视作可部署收益。

## 测试与文件

- Minimax UT 389/389通过。新增独立模拟器近距离对枪fixture覆盖领先/同星/落后三种结果，并测试stun过期与指令映射。
- 原122格差异0，额外8格全部为冷却技能请求，无原响应遗漏；自然动作漂移、事件计数漂移、root mutation、error、timeout、restore均0。
- 证据3709字节；无完整replay，无额外整局胜率筛选。
- runner：`tools/agentank/diagnostics/terminal-risk-simulator-oracle.js`。
- UT：`test/minimax-core/terminal-risk-simulator-oracle.test.js`。
- artifacts：`artifacts/native-causal-audit/bp353-terminal-risk-simulator-oracle/`。
- 生产tree保持`285f9863227d6af3638bed74e008f0260fd25440034d95eec5e3f8cac44d9120`。
- 未修改production或vendor，未提交、推送及调用官方平台。
