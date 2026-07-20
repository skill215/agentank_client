# 当前状态

更新时间：2026-07-20（Asia/Shanghai）。

## 工作区

- 当前唯一工作区：`/home/skill/workspace/git/agentank_client`。
- Git 分支：`main`。
- Remote：`git@github.com:skill215/agentank_client.git`。
- 项目已从 Windows 挂载路径迁移到 WSL 原生文件系统。
- 迁移量：7,031,485,059 字节、25,650 个文件。
- 迁移后 `test:4` 为 183/183 通过。
- 当前文件仍是首次导入状态，尚未由本轮操作 commit 或 push。

历史对战、baseline 和约 6.5 GB 的生成 artifact 已物理保留在新工作区，但由 `.gitignore`
排除。源码、测试、工具、配置和文档仍可进入 Git。

## 算法状态

V2 当前包括：

- PhysicalState 与 InformationState 分离；
- committed/possible projectile 的独立生命周期；
- 四帧选择性 Information Safety closure；
- Hard gate、AND/OR ForcedWin Proof 和 ReverseViability；
- 整数化多维风险门与递归 epsilon-contamination backup；
- StageMatrix/Minimax 生产路径；
- CombatPressure、ShotPlan、技能策略和持续 Plan；
- Replay Capsule、Minimax 独立 oracle、mutant corpus 和历史快速回归。

最近完成的 `NO_ACCEPTABLE_RESCUE` 结构修复：

- fixed-continuation 存活根由 49 增至 50；
- `NO_ACCEPTABLE_RESCUE` 从 56 降至 55；
- 策略一致存活由 23 增至 25；
- 新增存活控制退化为 0；
- 19,136 个历史根完成验证；
- avoidable Hard reject、risk-dominated selection、strict Proof false positive、root restore failure
  和 Capsule failure 均为 0。

详细证据见 [NO_ACCEPTABLE_RESCUE 结构修复](implementation/no-acceptable-rescue-structural-repair.md)。

## 当前阻塞：Production 代码大小

当前 IMP6 生成物：

| 文件 | UTF-8 字节 | 状态 |
|---|---:|---|
| normalized production source | 412,201 | 不可上传 |
| production minified | 397,799 | 不可上传 |
| 实验性普通变量 mangle | 289,849 | 仍不可上传 |

平台操作硬限制为 204,800 字节，本地安全目标为不超过 190,000 字节。当前 working source、旧
IMP8 Candidate 和现有 minified bundle 都没有官方 simulate/publish 资格。

旧 IMP8 frozen Candidate 是历史 artifact，不能覆盖、不能冒充当前 working source，也不能因为
迁移进入新 Git 仓库就恢复发布资格。

## 当前验证状态

- `npm run test:4`：183/183 PASS。
- multi-frame risk benchmark：PASS，热路径分配为 0。
- search-frontier benchmark：PASS，root restore failure 为 0。
- 本轮迁移没有运行新 V1/V2 arena，也没有改变算法参数。
- 本轮迁移没有调用官方 simulate、publish 或 challenge。

## 下一步

下一阶段只处理 Production 代码压缩，不改变算法语义：

1. 盘点 Production 依赖图和不可达/重复模块；
2. 将 Reference、diagnostic、日志、平台和报告代码排除在 bundle 外；
3. 对生产专用常量、配置和模块做构建期 specialization；
4. 调整固定 Terser 5.43.1 配置并保持可重现构建；
5. 每个压缩步骤执行 source/minified differential、183 项测试和代码大小测量；
6. 达到 190,000 字节以内后，才进入新的 Candidate 资格与官方 simulate。

压缩阶段不得降低搜索深度、修改风险参数、删除 Hard/Safety/Proof 语义或用历史样本补丁换体积。
