# 基本操作

## 1. 进入工作区

所有开发、测试和构建都在 WSL 内执行：

```bash
cd /home/skill/workspace/git/agentank_client
```

确认位置和版本：

```bash
pwd
node --version
npm --version
git status --short
```

要求 Node `24.16.x`，Terser 固定为 `5.43.1`。首次安装或依赖变化时使用：

```bash
npm ci
```

仓库脚本优先通过 `tools/wsl-node.sh` 和 `tools/wsl-npm.sh` 调用固定 WSL 运行时，不要从
PowerShell 转调 Windows Node。

## 2. 常用测试

GR0 结构门（语法 + 不读取历史战斗的 122 个纯 UT）：

```bash
npm run test:gr0
```

Minimax 核心：

```bash
npm run test:minimax-core
```

当前 SR0–SR4、Minimax 和快速回归总门：

```bash
npm run test:4
```

完整 IMP0–IMP9 门：

```bash
npm run test:gate
```

GR0 冻结期间，修改 Minimax、Safety、Risk、Deadline/EO 或生产控制器后必须先执行
`test:gr0`。`test:4` 包含已清理的历史回归依赖，不能再作为 GR0 前置门。修改平台、
Candidate 或发布工具后仍必须执行 `test:gate`。

## 3. 构建与代码大小

Production 构建/IMP6 验证入口：

```bash
npm run imp6:verify
```

主要输出：

```text
artifacts/build/imp6/production-source.js
artifacts/build/imp6/production-minified.js
artifacts/build/imp6/build-manifest.json
```

上传测量必须使用 minified 文件的 UTF-8 字节数：

```bash
wc -c artifacts/build/imp6/production-minified.js
```

平台硬限制为 204,800 字节，本项目预警线为 190,000 字节。体积优化不得手工编辑生成文件；
必须修改 Production 模块选择、构建或压缩流程，并重新验证：

- source/minified 动作指纹一致；
- 两次独立构建 SHA-256 一致；
- Hard/Proof/root restore 不变量仍为零；
- 完整测试通过。

## 4. GR0 证据保留与全量对战

旧回归 inventory/compact/verify/prune：

```bash
npm run artifacts:retention -- inventory
npm run artifacts:retention -- compact
npm run artifacts:retention -- verify
```

`prune` 只能使用 verify 生成的精确 manifest，禁止手工通配符删除：

```bash
./tools/artifact-retention-toolchain.sh prune --manifest \
  artifacts/retention/gr0/verified-prune-manifest.json
```

GR0 全量对战：

```bash
./tools/v1-v2-working-arena.sh \
  --repetitions 2 \
  --trace compact \
  --progress-every 32 \
  --output artifacts/diagnostics/v1-v2-working/<content-addressed-directory>
```

本轮禁止运行旧历史 replay、Capsule、focused 或小范围 arena。全量运行只保留 compact
逐局结果和最多 64 个确定性诊断样本。真实 `battle-records/` 不得清理。

## 5. 平台工具

先检查本地配置和 TankProfile：

```bash
npm run platform:doctor
npm run platform:profiles
npm run platform:scan-secrets
```

密钥只保存在 `.env.agentank.local` 等 Git 忽略文件中。正式 simulate 前必须绑定精确 Candidate
字节并通过本地 preflight。publish/challenge 会改变外部状态，没有新的显式授权不得执行。

平台完整流程和错误处理以 [平台运行合同](design/platform-operations-contract.md) 为准。

## 6. Git 操作

提交前至少检查：

```bash
git status --short
git diff --check
git check-ignore -v battle-records artifacts battle-baselines .env.agentank.local
```

应提交源码、测试、配置和文档。以下内容只在本机保存：

- `battle-records/` 中除控制目录说明外的全部历史数据；
- `battle-baselines/`；
- `artifacts/`；
- `node_modules/`；
- `.env` 和 `.env.*`。

不要用 `git add -f` 绕过这些忽略规则。
