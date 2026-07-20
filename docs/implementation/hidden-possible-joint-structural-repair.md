# HiddenWorld + PossibleProjectile 联合状态结构修复

状态：实现与本地验收完成，2026-07-20。本文记录 27 个历史联合状态的固定分母、结构修复、反事实语义和性能证据；不代表 SR5 Candidate 已冻结或已获得平台发布资格。

## 结论

R11 固定的 27 个 `PATH_SUPPORT_POSSIBLE_PROJECTILE_AND_HIDDEN_WORLD` 根现在全部完成联合 Risk envelope：

- 27/27 `hiddenRiskSupportComplete=1`；
- 27/27 `MultiFrameRiskBounds=APPLIED`，无预算中断；
- possible projectile、隐藏位置和未来 FIRE 均只进入 Safety/Risk，不写 Hard 或 strict Proof；
- root restore failure 为 0；
- 14 个重点反例中，InformationState 风险支配缺陷由修复前的 10 个降为 0。

最终策略一致报告为 [policy-continuation R16](../../artifacts/fast-regression/reports/policy-continuation-r16/90bc1283efb67128fb71fc44e455fce6b791bab556fe9fa00ff6e784bc6d321b.json)。其固定分母为：14 个目标根、11 个当前策略直接存活、2 个 actual-world counterexample、0 个 InformationState dominating defect、2 个 epistemic ambiguity、1 个没有策略救援的对照根。

## 修复的结构缺陷

### 隐藏期间发射的弹丸集合

旧实现只从最后可见位置/朝向推断一颗弹丸，无法覆盖隐藏敌方的 `move -> turn -> FIRE`。`HiddenProjectileRiskField` 现在使用构造期分配的整数 TypedArray 同时传播：

- 隐藏坦克的 `(cell,direction)` 可达集合；
- 各历史动作时点可能产生的独立弹道；
- 到当前 callback 仍存活的弹丸集合；
- 未来四帧各 cell 的最大致命质量。

它是 InformationState 的 set-valued 风险字段，不创建物理 ProjectileTrack，不因 observation 缺失升级 Hard，也不在热路径分配对象。

### FIRE 后弹丸继续传播

旧四帧模型只在 FIRE 完成帧计算危险，下一帧就遗忘新弹丸。现在 release deadline 与 projectile travel 分离：弹丸从 release 起按每帧 projectile steps 传播，直到 terrain/boundary 失效；因此远距离开火可以在第二至第四帧命中，也能触发共享的反向闪避策略。

### 策略时间一致性

四帧倒推产生的下一帧 evasion 现在作为 Risk continuation obligation 保存。下一 callback 只有在动作仍合法、仍可接受且没有新证据给出严格更安全动作时才提交；新物理证据可以取消 obligation，普通一层 value 不得无条件把闪避继续推迟一帧。

### Safety 进入鲁棒回传

完整联合路径发布后，Safety 的三个来源按规范量词进入整数二元 fatal backup：

1. committed/chance fatal mass 使用 ChanceOutcome lambda；
2. possible projectile fatal mass 使用 HiddenWorld lambda；
3. future FIRE fatal mass 使用 EnemyAction lambda。

每次使用 `VALUE_MIN` 作为 fatal child，并复用 0..100 RiskProfile 的 ε-contamination 表。只有 `possibleProjectileStrategyApplied` / `futureFireStrategyApplied` 已闭合的路径可以改写 `robustLower`；未完成、预算中断或容量中断的粗风险仍参与多维 gate，但不得伪装成 strategy-consistent robust value。该限制修复了 `753a…:110` 的完整历史生存回归。

### 空隐藏字段不能污染普通弹丸

生产 root 总会传入一个 HiddenProjectileRiskField。旧条件把“对象存在但 count=0、complete=0”误当成隐藏弹丸支持不完整，从而阻断一个完全有效的 ordinary possible projectile path。现在只有 `count()>0 && !complete` 才使联合发布 incomplete，并有独立 UT 固化。

## 反事实判定边界

固定历史 continuation 只能回答“如果根动作改变、后续仍照历史动作执行，真实世界会怎样”，不能证明当前策略有缺陷。正式诊断改为：

- 当前根和后续 callback 都运行当前 V2 policy；
- 备选分支只强制第一步，之后同样运行当前 V2 policy；
- 对手暂用历史 action continuation；
- 只有存活备选在决策时 InformationState 的五个风险维度上严格支配已选动作，才计为结构缺陷。

剩余两个 actual-world counterexample 是：

- `10cba…:81`：事后真实弹道下 GO 存活，但当时 GO 的 horizon fatal mass 为 3969，高于已选转向的 3569；
- `7b459…:14`：事后真实弹道下 GO 存活，但当时 GO 的 immediate/horizon mass 为 1805/5265，高于已选转向的 1250/3258。

两者都依赖不可观测的真实弹道，不存在 InformationState 风险支配救援，因此记录为 epistemic ambiguity。为它们硬选 GO 会把真实世界 hindsight 注入 policy，破坏 Minimax 对完整隐藏支持的定义。

## 验收证据

- `test:4`：177/177，通过 SR0–SR4、Minimax core、Proof、StageMatrix、fast regression；
- `hidden-possible-joint-regression`：27/27 联合 envelope，Risk 不升级 Proof；
- `policy-continuation R16`：InformationState dominating defect = 0，root restore failure = 0；
- multi-frame benchmark：combined P95 1188µs/1000 roots，门限 3108；
- active threat P95 7595µs/1000 roots；
- possible projectile P95 7424µs/1000 roots；
- 64-world joint hidden P95 121791µs/1000 roots，门限 150000；
- hot allocation = 0；
- IMP6 deterministic source/minified semantic fingerprint一致；
- deterministic production source 412201B，minified 397799B，四项本地容量门全部通过。

性能报告为 [multi-frame-risk benchmark](../../artifacts/fast-regression/reports/multi-frame-risk-benchmark/ad7a221f913e31af4dd38b0df1b9a060393081d87ff53af760d4fbad9fdcee52.json)。构建器对 production-source 先执行固定 Terser 版本的无压缩、无改名规范化，只移除注释和冗余空白；源模块本身保持可读，source/minified 仍独立执行并比较完整语义指纹。

## 后续边界

本阶段没有运行新的 V1/V2 全量 arena，没有调 baseRisk、搜索深度、fallback 参数或领先保护，也没有冻结新 Candidate。下一步应回到快速回归主线：先对现存历史 corpus 运行 source-bound 行为差分和击毁/总胜门的预检查，再决定是否进入全量 arena 与 SR5 性能参数选择。
