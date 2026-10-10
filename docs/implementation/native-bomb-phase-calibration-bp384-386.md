# BP384–BP386：炸弹 phase 校准与冻结全量对照

日期：2026-10-03（Asia/Shanghai）。

只改变本地模拟环境的炸弹处理 phase，NativeBasePolicyEngine、V1、策略和预算保持 BP383 原样。未调用官方 simulate/publish/challenge，未提交或推送。

## 规则证据与覆盖

复用 BP384 已保存的 20 场近期公开 summary/events 和 BP385 的 13 个 raw 切片，没有重复下载。12 个近期死亡窗口加 1 个历史控制，共 50 帧；请求帧全部齐全。近期窗口没有炸弹爆炸，不能据此推断整场没有炸弹，也不能声称此次取得了新的近期炸弹校准证据。

历史控制 `mat_3lj0fhcHSdaLyCpCL` frame46 明确显示 tank turns → bullet go → map destroyed → bullet crashed → bomb exploded → tank crashed（reason=bomb）。结合 DD4 §2.4 已有的 38 个 paired bomb 样本，沿用行动/projectile 后爆炸、动作后位置、10 帧 fuse 的规则。compact events 会省略 bomb 或误标死亡事件，不用其作为炸弹时序权威。

## 适配器与验证

`tools/agentank/simulation/bomb-phase-adapter.js` 校验 vendor engine SHA，严格匹配唯一替换位置，经 data URL 加载独立类；vendor 文件和默认加载器保持原状。仅把 explodeDueBombs 移到 moveBullets 后；子弹造成 terminal 时仍处理本帧 due bombs 并重算终局。clone 继续使用适配类。

8 项适配器测试覆盖唯一 patch 点拒绝漂移、vendor 不变、移出/移入爆区、等待/同帧 shield、子弹击毁后的炸弹同毁、10 帧 fuse/clone、无炸弹轨迹、子弹先破土后计算 blast。另有 2 项报告测试覆盖分母、场景身份、runtime 排除和差异检测。完整 minimax-core：453/453。

4 局原 vendor 基线复现（含无炸弹场景，双方换位）与 BP383 的持久化语义逐项一致；序列化规范省略 undefined 字段，runtime 数值和 runtime-only raw winner 不进入分析比较。基线 source-freeze 的 220 个文件全部逐字节一致。

## 冻结协议

固定读取 BP383 manifest 的 1243 个场景 ID，逐项核对 fingerprint，再保存独立 scenarios.json.gz。双方 stun、128 帧、确定性 V1 时钟及回合 fallback 保持原样。四个本地计算 worker 隔离运行，各场景双方换位共 2486 局；每 32 局写压缩 checkpoint。没有动态扩充场景，没有启用 NAVIGATION_FAMILY 或诊断终局证书。

生产树 SHA-256：`285f9863227d6af3638bed74e008f0260fd25440034d95eec5e3f8cac44d9120`。前后均与 BP383 一致；V1、对战主机、适配器身份也通过结束核验。

## 全量结果

| 环境 | 胜 | 负 | 平 | 综合得分 |
|---|---:|---:|---:|---:|
| BP383 vendor | 1195 | 1063 | 228 | 52.6549% |
| BP386 炸弹 phase 校准 | 1162 | 1093 | 231 | 51.3878% |

综合得分变化 -1.2671 个百分点；45 局分析胜负变化。这衡量模拟环境修正的影响，不是策略改进收益或官方平台胜率。

### 旧/新结果转移

| 旧结果 | 新结果 | 局数 |
|---|---|---:|
| DRAW | DRAW | 225 |
| DRAW | V2_WIN | 3 |
| V1_WIN | V1_WIN | 1060 |
| V1_WIN | V2_WIN | 3 |
| V2_WIN | DRAW | 6 |
| V2_WIN | V1_WIN | 33 |
| V2_WIN | V2_WIN | 1156 |

### 终局分类

| 终局 | 旧胜/负/平 | 新胜/负/平 |
|---|---:|---:|
| FRAME_LIMIT_EQUAL_STARS | 0/0/224 | 0/0/227 |
| FRAME_LIMIT_STARS | 381/311/0 | 390/327/0 |
| MUTUAL_CRASH_EQUAL_STARS | 0/0/4 | 0/0/4 |
| MUTUAL_CRASH_STARS | 6/15/0 | 8/14/0 |
| SINGLE_CRASH | 808/737/0 | 764/752/0 |

### 换位双局

| 分组 | 旧场景数 | 新场景数 |
|---|---:|---:|
| DOUBLE_DRAW | 20 | 20 |
| SPLIT | 500 | 501 |
| V1_SWEEP | 231 | 245 |
| V1_WIN_DRAW | 101 | 102 |
| V2_SWEEP | 304 | 286 |
| V2_WIN_DRAW | 87 | 89 |

### 已知 BP382 见证

`mat_HT5bQROODWk50q4Fp` seat0 在旧环境 record31 炸弹提前引爆，32 帧结束；校准后运行到 128 帧，但分析结果仍为 V1_WIN。这说明消除已知时序错误不自动等于恢复一场胜利。

## 控制、完整性与边界

双方都未放炸弹的旧/新共同控制共有 810 局，语义差异 0。其余 1676 局至少一侧环境曾放炸弹；详细转移与逐局变化在 overview.json。原 BOMB 标签仅表示 V2 死亡帧有爆炸，不等于严格死因。带此标签的败局从53降至50；尽管该计数略降，总败局增加30，因此不能据炸弹标签下降宣称总体改善。45个结果转移全部发生在放过炸弹的分组。

分母完整 2486/2486，双方 error/timeout 与 V2 root restore 均为 0。记录保留压缩动作、计数和审计信息，没有生成全量 replay。

这仍是 BOMB_PHASE_ONLY：行动阶段提前碰撞终局、poison cadence/cooldown、stun 概率、teleport 概率/揭示边界、callback 队列及 runtime 模型尚未全部校准；多颗 due bomb 的共享状态处理仍属于 DD4 未决边界。此次没有修改这些规则。

本次使用经批准的沙箱外执行入口，确认 WSL2 Linux dev、Node v24.16.0 可运行。默认受限 exec 曾在创建进程前失败；本次恢复的是可用执行路径，不声称已修复应用沙箱故障。

## 产物与复现

结果目录：`artifacts/native-causal-audit/bp386-bomb-phase-calibrated/`。manifest 绑定输入、脚本、适配器和 frozen scenarios；overview 含转换、终局、swap、控制与 changed 明细；raw-evidence-review、baseline-source-comparison、minimax-core-tests 和 validation 保存完整性证据。

```sh
node --test --test-isolation=none --test-reporter=spec test/minimax-core/*.test.js
node tools/agentank/diagnostics/global-bomb-phase-calibration.js <新的输出目录> 4
```

下一步可用此次校准环境分层分析剩余失败；本轮不据结果自动调策略。
