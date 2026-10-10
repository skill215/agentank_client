# BP382–BP383：物理差异确认与全局纠偏基线

## BP382 已确认的差异

`mat_HT5bQROODWk50q4Fp` seat0，frame31：模拟器中炸弹createdAt=21、explodesAt=31，位置[6,9]。原始决策为GO，但本帧事件先出现stun expired，再bomb exploded，随后本方tank crashed；GO没有机会执行。

固定模拟器的 `step` 顺序为expireEffects → explodeDueBombs → 玩家动作 → 弹丸；当前FastKernel.applyFrame为expireEffects → 玩家动作 → 弹丸 → resolveBombs。这能解释此前“模型GO可活，实际GO死亡”的差异。V1EntryCollisionKernel仅覆写advanceProjectiles，未修正炸弹时序。

**规则权威复核纠正：这不是生产FastKernel的已证缺陷。** `docs/design/rule-calibration-report.md` §7及`design-authority.md` §5.3已根据DD1平台replay校准，将外部模拟器行动前爆炸标记REJECT；平台合同为行动/projectile后爆炸。前期将模拟器当作正确期望的判断已撤回。

最小UT现分别约束两种语义：外部模拟器GO前死亡；遵循已校准平台合同的FastKernel可先移出爆区。原先的TODO被更正为平台合同测试，原因是证据权威纠正，而非迁就算法或证明所有炸弹逻辑正确。最终全套443项通过。

重现入口：

```sh
node tools/agentank/diagnostics/bomb-phase-consistency-audit.js <新目录>
node --test test/minimax-core/bomb-start-phase-contract.test.js
```

历史原始观察、模型炸弹deadline及模拟器事件保存在 `artifacts/native-causal-audit/bp382-bomb-phase-consistency/evidence.json`。

## BP383 预注册范围

- 主测：未加NAVIGATION_FAMILY和证书覆盖的当前NativeBasePolicyEngine源码路径。
- 对手：冻结V1，确定性V1时钟，同时保留其回合进度fallback。
- 本地最新可加载历史池1243个场景，双方换位，共2486局；不声称包含尚未下载/索引的远端比赛。
- 双方stun，128帧；同星终局/同毁忽略runtime记平局。
- 使用原地图、初始位置和历史星序列；一次重复，不把确定性重复视为独立证据。
- 不修生产算法、不调整预算、不启用诊断证书、不调用平台。
- 已知外部模拟器炸弹时序偏差保留，目的是取得现有模拟环境基线，不作平台资格验收。

入口：

```sh
node tools/agentank/diagnostics/global-current-baseline.js <新目录>
```

结果目录：`artifacts/native-causal-audit/bp383-global-current-baseline/`。manifest绑定源码树、Node、V1、历史索引、场景指纹及运行脚本。完整源码/config压缩快照为source-freeze.tar.gz，SHA-256 `bcbbfe905b65ea4537d9a2081e3bb498ba8f26e4057a8def1deaf17f12d67467`。

生产源码树：`285f9863227d6af3638bed74e008f0260fd25440034d95eec5e3f8cac44d9120`。

## 比较边界

BP370 OFF使用NAVIGATION_FAMILY，本次没有该覆盖。因此共同64场景的转移是**两种配置对比**，不是同一策略随时间改进的证据。BP370之外的场景单列，但不称为全部“新收集场景”。本地累计耗时不替代官方3秒限制；本轮不是精确minified上传资格测试。

## 全量结果

完整2486局：1195胜、1063负、228平。纯胜率48.07%，综合得分（胜+0.5平）52.65%。双方stun和确定性时钟的实验条件不能泛化为所有技能/官方平台胜率。

| 终局 | V2胜 | V2负 | 平 |
|---|---:|---:|---:|
| 单方击毁 | 808 | 737 | 0 |
| 128帧星数不同 | 381 | 311 | 0 |
| 128帧同星 | 0 | 0 | 224 |
| 同毁星数不同 | 6 | 15 | 0 |
| 同毁同星 | 0 | 0 | 4 |

1243组换位：V2双胜304、V1双胜231、各胜一局500、V2一胜一平87、V1一胜一平101、双平20。seat0得分659/1243=53.02%，seat1得分650/1243=52.29%，没有明显单一座位塌陷。

737局单方死亡占1063负的69.33%，仍是最大失败类别。139局单方死亡的最终根敌不可见，约占单方死亡18.86%，不能由精选失败样本推论隐藏问题占整体多数。失败事件启发式分类为53局BOMB、699局PROJECTILE_OR_COLLISION、311局NONE（输星）；BOMB表示死亡帧有爆炸，不等同于已经证明每局均由炸弹导致，更不等同于53局均由phase偏差造成。

FIRE总数V2 14032、V1 13883，单方击毁净胜+71、星数终局净胜+70、同毁星数净负9。当前不是全局明显不射击，也不是只靠抢星获胜。

171949根进入搜索，占记录的223266根77.02%；总节点31201778、预算叶10439813。预算叶数量不是预算失误次数，不能直接转换为可恢复胜局。未测量avoidable Hard reject和strict Proof false positive，不以运行无异常代替它们的零值证据。

## 与此前共同64场景

当前原生版本59/53/16，得分52.34375%；BP370导航实验OFF为59/54/15，51.953125%，差+0.390625pp。19次WIN→LOSS，18次LOSS→WIN；共58/128局结果变化，净收益仅半局。这个对照支持“局部恢复伴随广泛再分配”的警示，不支持直接采用导航覆盖，也不能把BP370证书ACTIVE的55.08%当成本次current水平。

BP370以外1179场景2358局：1136/1010/212，得分52.67176%，与共同集接近。这是“此前64场景之外”，不是全都新收集或全都盲测。

## 完整性与存储

error/本地timeout/root restore均0；源码树前后一致。全套UT443/443。结果目录约1.5MiB，包含源码压缩快照、manifest、overview、压缩逐局动作和计数、global-analysis及规则权威更正。未生成全量逐帧replay。

manifest和overview在规则权威复核前写入的`knownDefect`/`KNOWN_PHYSICS_DEFECT`标签保留为原始记录；必须同时读取`authority-correction.json`：它们指模拟环境与平台不一致，不能据此判定生产物理规则错误。后续不得脱离更正文件引用。

## 下一步

先校准测试平台：依据既有平台回放证据，建立不修改vendor原件的版本化模拟器适配层，修正已确认的bomb phase，并用原始平台replay/规则fixture约束，不能反过来改V2适应错误模拟器。随后同冻结2486局对比旧/校准模拟环境，量化环境偏差；不同时修改V2策略。

环境一致后，从737个单方死亡和231个双负场景中作分层归因，再评估攻击时机、隐藏覆盖和搜索预算。当前结果表明V2在此外部环境略高于V1，不是10%整体崩溃；但没有达到60%目标，也不能证明官方平台优势。

后续已完成：[BP384–BP386 炸弹 phase 校准与冻结全量对照](native-bomb-phase-calibration-bp384-386.md)。同生产源码下得分由52.65%变为51.39%，810局无炸弹控制零差异；详见接续报告的证据与适用边界。
