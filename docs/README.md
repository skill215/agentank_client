# AgentTank Minimax V2

本目录是项目文档入口。项目工作区已经迁移到 WSL 原生文件系统：

```text
/home/skill/workspace/git/agentank_client
```

不要再以 `/mnt/c/Users/skill/Documents/agent tank` 作为工作目录。旧路径只保留旧 Git 元数据和
空目录，不再是源码权威位置。

## 项目概览

本项目实现高性能 AgentTank V2：以固定整数和 TypedArray 为基础，组合 PhysicalState、
InformationState、Hard Safety、AND/OR Proof、Minimax/StageMatrix、多维风险门、策略选择、
弹丸生命周期、技能模型和可重放历史回归。

主要目录：

| 路径 | 用途 | Git 属性 |
|---|---|---|
| `engine-v2/src/` | V2 算法唯一源码 | 应纳入 Git |
| `test/` | IMP、SR、Minimax 和回归 UT | 应纳入 Git |
| `tools/` | 构建、平台、benchmark、simulate 和回归工具链 | 应纳入 Git |
| `config/` | 不含密钥的规则与配置 | 应纳入 Git |
| `docs/design/` | 详细设计和合同 | 应纳入 Git |
| `docs/implementation/` | 阶段验收与结构修复记录 | 应纳入 Git |
| `battle-records/` | 下载的真实对战和本地索引 | 本地保留，Git 忽略 |
| `battle-baselines/` | 历史对战基线 | 本地保留，Git 忽略 |
| `artifacts/` | 构建、Capsule、benchmark 和报告 | 可再生，本地保留，Git 忽略 |

Production 入口是 `engine-v2/src/runtime/production-entry.js`。生成的
`artifacts/build/imp6/production-minified.js` 不是源码，也不能手工修改。

## 文档入口

- [基本操作](operations.md)：环境、测试、构建、回归、平台操作和 Git 规则。
- [当前状态](current-status.md)：当前算法、验证证据、代码大小阻塞和下一步。
- [设计索引](design/README.md)：详细设计与规范。
- [实施索引](implementation/README.md)：IMP/SR 和结构修复记录。
- [平台运行合同](design/platform-operations-contract.md)：simulate、publish、限流和错误处理。
- [代码大小约束](implementation/platform-code-size-constraint.md)：UTF-8 上传限制和当前测量。

## 当前原则

1. `engine-v2/src` 是算法权威；历史 Candidate 和生成 bundle 只作为证据。
2. Hard 失败、严格 Proof、root restore 和弹丸生命周期不能为胜率或体积优化让步。
3. Production 压缩必须保持 source/minified 动作与语义一致。
4. 本地耗时只用于同输入相对比较，不能替代平台 3000 ms 证据。
5. simulate、publish 和 challenge 是不同权限；没有显式授权不得 publish/challenge。

