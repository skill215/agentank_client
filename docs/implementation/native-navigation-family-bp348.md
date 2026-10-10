# BP348：导航动作内部路线比较ACTIVE

## 结论

候选在64场景128局取得65胜55负8平，综合53.90625%，较CURRENT增加3.90625个百分点；单方击毁34→40，被击毁44→36，星差-5→+18。比BP346通用分数方案的点估计更好，但场景配对p=0.496952，没有显著优势，验收仍为NOT_QUALIFIED，生产默认不变。

已确认结构边界：导航进度不再参与技能/攻击的跨类别加分。仍不能仅凭此开发集宣布总体改进。

## 选择合同

新增诊断`selectNavigationFamily`，放在原selectIncumbent之后，原Minimax与最终安全门之前：

- 必须处于STRATEGIC_NAVIGATION，原incumbent为GO/LEFT/RIGHT。
- 严格Proof、strict rescue、verified direct kill不处理；具备攻击purpose的导航动作也不处理。
- 原incumbent及替代行都必须Hard ALLOW、Risk接受且未被支配。
- 替代行动的immediate/horizon/unknown/committed质量不能比原incumbent高，escapeSlack不能更低。
- 只在已知路线进度严格更大时替换；同进度保留原动作。
- 不修改任何候选分数、Hard、Risk、策略purpose或原策略提交；只是现有导航选择中的质量细化。原search可以继续覆盖，FinalActionGate照常执行。
- 延用BP345静态路线适用限制，未知/不可达/技能效果不适用时回退原选择。

本候选没有提高GO分，没有把目标推进冒充拿星，也没有恢复几何搜索入口限制。

## 对照结果

复用BP338 CURRENT128局，只新增候选128局；同64场景、两座位、双方stun，原搜索深度/预算不变。固定过的开发数据，不是新Holdout。

| 指标 | CURRENT | BP346通用路线加分 | BP348导航内部比较 |
| --- | ---: | ---: | ---: |
| 胜/负/平 | 54/54/20 | 62/60/6 | 65/55/8 |
| 综合得分 | 50% | 50.78125% | 53.90625% |
| 单方击毁胜 | 34 | 40 | 40 |
| 单方被击毁负 | 44 | 39 | 36 |
| 128帧星数胜 | 19 | 22 | 25 |
| 128帧星数负 | 10 | 21 | 19 |
| FIRE | 795 | 802 | 813 |
| 转向 | 6195 | 5921 | 5907 |
| GO | 4338 | 4466 | 4469 |
| 星差 | -5 | -9 | +18 |

候选还有7个同星帧限平、1个同星同归于尽平；CURRENT还有1个同归于尽星数胜。

相对CURRENT：21负→胜、16胜→负、7平→胜、8平→负、2负→平、1胜→平；净增加5得分。仍有16个旧胜局变负，不能称零退化。

相对BP346净增加4得分（3.125个百分点），配对p=0.540760，也没有显著性。

座位0为29/30/5，得分49.21875%，与CURRENT该座位相同；座位1为36/25/3，58.59375%，较CURRENT50.78125%改善。总提升集中于座位1，必须在更大数据集上检验，不调整朝向或座位特例。

## 所有权和缓存

11820根中替换208次原导航incumbent：LEFT→RIGHT148、GO→LEFT7、GO→RIGHT27、LEFT→GO14、RIGHT→GO5、RIGHT→LEFT7。此为导航提议替换次数，后续搜索/最终门仍可能覆盖，不等于208次最终动作改变。

1822次原incumbent为技能、FIRE/BOMB等非导航动作，替换数0。同根所有权保持，不表示整局技能使用次数不变：路线改变使后续轨迹不同，STUN总数仍543→497。

距离场146次重建、1056次命中。未比较异轨迹本地总耗时作为性能资格。

## 验收与下一步

380项Minimax UT通过，新测试覆盖导航内严格比较、同分保持、技能/攻击/Proof/救援保留所有权、各风险维度不变差及拒绝动作不得恢复。128局timeout/error/root restore均0。

达到预注册+3pp及击毁/死亡门，但未达到p<0.05，因此不推广。冻结本候选，下一轮用不属于这64场景的更多历史场景做配对验证，不在原集合继续调权重或加入座位分流。历史池已用于旧实验，必须诚实标注“本轮开发集外”，不能声称全新盲测。

## 文件

- 选择器：`tools/agentank/diagnostics/navigation-family-selector.js`。
- ACTIVE：`tools/agentank/diagnostics/navigation-family-active.js`。
- UT：`test/minimax-core/navigation-family-selector.test.js`。
- 证据：`artifacts/native-causal-audit/bp348-navigation-family-active/`，43845字节，无完整replay。
- 生产tree保持`285f9863227d6af3638bed74e008f0260fd25440034d95eec5e3f8cac44d9120`。
- 未修改生产默认、提交、推送或调用官方平台。
