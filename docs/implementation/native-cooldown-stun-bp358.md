# BP358：诊断终局域的冷却STUN归约

## 结果

关闭了一个具体规则支持缺口：3个此前UNSUPPORTED/INCOMPLETE的敌方冷却STUN响应，在诊断终局枚举中归约为NONE后，均与固定独立模拟器的物理结果一致。其余52格结果/crash零变化，未完成格3→0，枚举全胜根4→6。

7个根仍全部INCOMPLETE：未知敌弹gap=8192未被消除。同星根保留production悲观runtime负值，未改为离线DRAW。没有生产动作接管或胜率提升结论。

## 归约依据与范围

固定模拟器`applySkill`在技能类型匹配且`skillCooldownUntil > frame`时只追加skill failed/cooldown事件，然后返回，不修改物理状态。FastKernel对非poison冷却技能当前返回UNSUPPORTED。

新增`normalizeCooldownStun`仅在以下条件同时满足时返回NONE：

- 请求是CAST_STUN，角色技能确为STUN；
- 当前frame和readyFrame为有效整数，readyFrame不是未知哨兵且严格晚于当前帧；
- 冷却信息已知。当前诊断调用进一步要求没有8192之外的信息gap；
- 归约仅用于单帧物理终局计算，不改变实际发出的动作和观察事件。

其他技能、未知期限、恰好就绪和已经就绪均不归约。规则只得到固定本地实现和fixture支持，尚未推广为全平台/全部技能通用规则。

**物理等价不等于事件等价**：失败技能会产生一条失败事件，NONE没有；对手模型、日志和实际动作流不能据此合并。这里仅计算当前帧终局，保留原请求enemyAction及实际模拟的normalizedEnemyAction用于审计。

## 检查

- 独立模拟器双座位×冷却剩余1/2/32帧，共6组：STUN/NONE的players、地图、弹丸、炸弹和结果一致，失败事件不同。
- 就绪STUN反例：会改变角色状态，不能归约。
- 未知期限、其他技能、不匹配技能、ready==frame边界均保持原动作。
- 冻结7局Shadow重建，动作/参数/事件计数与原轨迹一致；3个新完成格与BP353独立响应逐格对账。
- 6个领先根55格中的全部相关响应获胜；总体为54个WIN、1个按production runtime计LOSS的同星互毁格。
- 零预算仍返回INCOMPLETE。
- Minimax UT 402/402通过。

本轮修改仅在diagnostics，默认归约关闭，通过`--normalize-cooldown`显式启用。FastKernel、Risk、Proof、V1和production bundle未修改。

## 复用命令

在仓库内运行（输出目录必须不存在）：

```sh
node tools/agentank/diagnostics/terminal-evidence-shadow-run.js \
  artifacts/native-causal-audit/<new-shadow-dir> --normalize-cooldown
```

本轮固定证据对账脚本：

```sh
node tools/agentank/diagnostics/verify-cooldown-stun-shadow.js \
  artifacts/native-causal-audit/<new-verification-dir>
```

后者固定读取本轮三个来源并记录SHA-256，不重新模拟。

## 下一步

冷却缺口已不再阻挡这6个领先根的有限终局矩阵。接下来只处理剩余核心问题：建立受限定相位和规则条件约束的“额外敌弹不取消敌方当帧死亡”证据生产者，并计算结算星差下界；先Shadow，不把8192全局清零。无需继续扩大压力测试或提高搜索深度。

## 文件与证据

- `tools/agentank/diagnostics/cooldown-stun-normalization.js`
- `test/minimax-core/cooldown-stun-normalization.test.js`
- `artifacts/native-causal-audit/bp358-cooldown-stun-shadow/`
- `artifacts/native-causal-audit/bp358-cooldown-verification/`
- 生产tree仍为`285f9863227d6af3638bed74e008f0260fd25440034d95eec5e3f8cac44d9120`。
- 无提交、推送、simulate、publish或challenge。
