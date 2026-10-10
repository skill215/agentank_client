# PAC1 ProjectileAttackClosure 实施记录

状态：**IMPLEMENTED / STRUCTURAL PASS / BEHAVIOR NEUTRAL SAMPLE**，2026-07-23。

权威设计：
[ProjectileAttackClosure 合同](../design/projectile-attack-closure-contract.md)。

## 分析基线

- `possibleHit` 已提供远距离位置可达 soft FIRE 资格。
- `FastKernel` 已正确执行移动后两次 projectile substep，并在命中时立即终局。
- Physical value search 的 direct-depth-two 调度不能稳定看到七格外约第 4 帧命中。
- ForcedWin 能搜索更深，但只能在全部敌方应对和 chance 完整时证明，不能由
  possible-hit 替代。
- 现有 `DeadlineKernel` 已有 orientation-aware reverse viability，可复用其
  `cell × direction` 固定数组逻辑；PAC 只需提供候选 FIRE 的独立新弹丸 timeline。

## 实施任务

- [x] PAC1.1 新建新弹丸 timeline 与固定输出 slab。
- [x] PAC1.2 实现普通/overload、墙/土/边界规范失效。
- [x] PAC1.3 实现 EnemyAction/Chance successor pose 与 survival-skill fail-closed。
- [x] PAC1.4 复用 Deadline reverse viability，生成逐矩阵单元状态。
- [x] PAC1.5 接入 CombatVector 摘要和 StageMatrix soft cell pressure。
- [x] PAC1.6 增加 exhaustive oracle、物理时序、技能、恢复、缓存和性能测试。
- [x] PAC1.7 运行 GR0/IMP6、256局抽样 A/B并更新结论。

## 实现结果

- 新增 `ProjectileAttackTimeline` 和 `ProjectileAttackClosure`，全部使用固定整数
  TypedArray；普通 FIRE 一 member，overload 两个独立 member。
- `PROVEN_DOOMED / SURVIVES / UNKNOWN` 逐 `FIRE × EnemyAction` 输出；
  ready/active shield、teleport、boost 或不完整动作支持一律 fail closed。
- 逐列 pressure 只在 Risk、EO、Pareto、global safe floor 和 StrategyBand 后由
  StageMatrix 消费；PAC 不写 Hard、Safety、EO 或 strict Proof。
- 修复 PAC cache replay 重复累加 tactical pressure 的缺陷；缓存键包含 soft FIRE
  qualification，根 hash/delta/event 保持不变。
- 新增 `PROJECTILE_ATTACK_OFF` 诊断模式和可重复基准：

```bash
./tools/projectile-attack-closure-benchmark.sh --output /tmp/pac1-benchmark.json
./tools/strategy-priority-sample-toolchain.sh run \
  --modes CURRENT,PROJECTILE_ATTACK_OFF
```

验证：

- PAC 专项 13/13；
- GR0 146/146；
- IMP6 16/16；
- source/minified differential、strip、sandbox 全部 PASS；
- 性能 P95 ratio 99.30%，paired median 101.40%，零热分配；
- 256 局 A/B 的动作与结果完全相同，虽发现 137 个 doomed cell，但 gameplay lift 为0。

构建为 source 483,335 bytes、minified 466,382 bytes，仍超过 204,800-byte 平台门；
没有形成 Candidate，也没有执行官方 simulate/publish/challenge。

## 不在本阶段

- 不提高普通 Minimax decision depth；
- 不修改 Hard、Safety、EO、ForcedWin 量词；
- 不修改领先保护、stun 概率、RiskProfile；
- 不执行完整 arena、官方 simulate、publish 或 challenge。
