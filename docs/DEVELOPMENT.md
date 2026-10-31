# CaseLite｜开发环境与可复现操作

- **性质**：P0 开发工作手册。开发机基础工具链已于 2026-10-29 完成实际验证；工程基线、G0 本地质量门槛、Linux CI 与 P0 安全基线分别由 DEV-1557、DEV-1559、DEV-1561 建立。每次是否通过，以命令的当次输出和 CI 记录为准。
- **来源**：[P0 开发环境与依赖清单](https://linear.app/logixy-ai/document/caselite-p0开发环境必装工具与依赖准入清单-v1待验证-8203d1bf3ff4)、[DEV-1557](https://linear.app/logixy-ai/issue/DEV-1557)、[DEV-1565](https://linear.app/logixy-ai/issue/DEV-1565)
- **整理日期**：2026-10-29

## 1. 已验证的开发环境

- 开发设备：macOS 26.6.2（Build 25G83），Apple Silicon `arm64`。
- 外置开发盘：APFS 卷 `CASDEV`，项目路径 `/Volumes/CASDEV/projects/caselite`。
- 代码远端：公开仓库 `https://github.com/Casefe/caselite`。
- GitHub HTTPS 认证、分支 Push、Pull Request 和合并流程均已实际验证。
- Node.js 由项目级 `mise.toml` 固定为 `24.22.2`。
- pnpm 当前实际版本为 `11.0.9`；后续应在 `package.json` 中固定 `packageManager`。
- 系统开发工具安装在内置盘；仓库、项目依赖、合成测试资料及可重建产物放在外置开发盘。
- CI 和项目代码不得依赖 `/Volumes/CASDEV` 这一台机器的绝对路径。

## 2. 开发机验证记录

| 项目 | 实际验证结果 | 当前状态 / 下一步 |
| --- | --- | --- |
| macOS | 26.6.2，Build 25G83 | 已验证 |
| CPU | arm64 | 已验证 |
| Xcode Command Line Tools | `/Library/Developer/CommandLineTools` | 已验证 |
| Apple clang | 15.0.0，目标 `arm64-apple-darwin25.6.0` | 已验证；原生 Electron 模块仍需后续实际编译验证 |
| Git | 2.55.0 | 已验证 |
| Node.js | 24.22.2 | 已由 `mise.toml` 固定 |
| pnpm | 11.0.9 | 已验证；待 `package.json` 固定版本 |
| mise | `node 24.22.2` | 已验证 |
| GitHub CLI | 已登录 `Lawyer-tan`，HTTPS Git 操作可用 | 已验证 |
| GitHub Remote | `https://github.com/Casefe/caselite.git` | fetch / push 已验证 |
| Git 工作流 | branch → commit → push → PR → merge | 已实际完成一次 |
| CASDEV | APFS 外置卷，约 931 GiB，基本读写通过 | 已验证；每次写入前仍应检查挂载 |

以上结果来自 2026-10-29 的实际终端验证。本文不记录 Token、密钥或其他凭据。


## 2.1 Git 回退演练

2026-10-30 已在 `/Volumes/CASDEV/scratch` 的隔离临时 Git 仓库完成回退演练：

1. 创建独立 Git 仓库并建立基线提交；
2. 人为制造未提交的错误修改；
3. 使用 `git diff` 正确识别修改；
4. 使用 `git restore` 恢复工作树；
5. 恢复后 `git diff` 与 `git status --short` 均为空。

结论：未提交的 LLM／人工错误修改可以通过 Git 安全恢复；演练未修改 CaseLite 正式仓库，也未使用真实案件资料或凭据。

## 3. 从已有仓库开始

如果目标目录不存在，先克隆，而不是先建无 `.git` 的项目目录：

```bash
# 先确认 CASDEV 确实挂载，并检查目录
mount | grep -F ' on /Volumes/CASDEV ('
ls -la /Volumes/CASDEV/projects

# 仅当目标 caselite 目录不存在时：
git clone https://github.com/Casefe/caselite.git /Volumes/CASDEV/projects/caselite
```

若已存在项目，先运行 `git -C /Volumes/CASDEV/projects/caselite status` 与 `git -C ... remote -v` 核查，不克隆覆盖、不随意 `git init`。`gh auth status` 可检查这台 Mac 的 GitHub CLI 认证；**ChatGPT 的 GitHub 连接不代表 Mac 已配置 Git 推送**。

## 4. 开工前只读检查

```bash
pwd
git status --short --branch
git remote -v
node -v
pnpm -v
ls -la
```

如果某个命令失败，先报告真实原因，不安装另一套重复工具链作为快捷替代。不展示 Token、`~/.ssh` 私钥、Keychain 秘密或完整 `.env` 内容。

## 5. 项目脚本与质量门槛

下列命令已在根目录 `package.json` 中配置。只有命令当次退出成功并生成相应证据，才能称该次检查通过。

| 脚本 | 语义 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 从锁文件做干净、可复现安装 |
| `pnpm env:check` | 核对本机 Node、pnpm、Git、项目配置及 macOS 编译工具是否符合本仓库的固定版本 |
| `pnpm clean` | 只删除可重建的构建、缓存、覆盖率和本地证据；不删除源码、锁文件、`node_modules` 或任何用户资料 |
| `pnpm dev` | 运行 Electron 桌面开发环境 |
| `pnpm security:baseline` | 公开仓库、Electron/Fuses/CSP/权限、无直接敏感日志及 Secretlint 假令牌自检；不要求联网 |
| `pnpm check:quick` | 格式、静态检查、架构边界、完整性、安全基线、类型、单元与合同测试；不要求联网 |
| `pnpm ci` | Linux CI 使用的完整 G0 门槛；另含生产依赖漏洞审计与许可证报告 |
| `pnpm coverage` | 输出单元与合同测试覆盖率到本机 `coverage/` |
| `pnpm test:full` / `pnpm verify` | 本机完整 G0 门槛，另执行 macOS Apple Silicon 打包 |
| `pnpm package` | macOS Apple Silicon 打包验证 |
| `pnpm test:packaged-db` | 在 `pnpm package` 后检查包内原生文件与迁移，再启动打包版执行合成 SQLite 读写探针 |
| `pnpm test:integration` | 执行 DEV-1567 的合成 SQLite/Drizzle 迁移、事务、重开与失败恢复测试；文件集成测试仍待后续 Issue |
| `pnpm test:e2e` | 当前明确报告“未运行”：为保持 Electron 安全 Fuse，尚未开启 Playwright Electron 所需的 inspect 参数 |

`pnpm ci` 的证据写入 `artifacts/evidence/`，许可证报告根据已安装生产依赖的 `package.json` 写入 `artifacts/licenses/`；二者均被 `.gitignore` 排除。GitHub Actions 在 Pull Request 和 `main` 更新时使用 Node 24.22.2、pnpm 11.0.9 和锁文件重装，上传这些证据及覆盖率，但不在 Linux 上冒充 macOS 桌面打包。

macOS 打包首次仍须从 Electron 官方发布源取得锁定版本的 ZIP；下载成功后，Forge 使用 Electron 包内记录的 SHA-256 校验本机缓存，不会为了再次下载 `SHASUMS256.txt` 而让已有缓存失效。缓存不是仓库内容，也不提交二进制。升级 Electron 时必须同时更新 `apps/desktop/forge.config.mjs` 的校验值，并重新执行打包验证。

若漏洞审计因 npm 服务不可用而失败，应如实记录为“未完成”，待网络恢复后重跑；不得删除该检查或把失败改为通过。

## 6. 依赖准入

- 基础：Electron、React、TypeScript、单一 Forge 构建主链；SQLite/Drizzle 用原生驱动时测试 Electron ABI、打包、迁移和重启。
- PDF/Worker：待合成 PDF 与离线打包 Spike 验证后纳入正式功能。
- Tiptap/Yjs：首个富文本用户路径启动时验证 Y.Doc 本地持久化；不提前建设协作服务器。
- AI SDK、PostgreSQL/Hocuspocus、Redis、MCP SDK：按各能力 Issue/ADR 分批引入，不为“以后会用”提前安装；Redis 不是 P3 持久化的前提。
- 不允许另建第二个 ORM、桌面框架、测试运行器或 Agent Runtime，除非有具体 Issue、替代分析、退出策略。

## 7. 交付证据模板

每一项开发任务交付：Issue ID；分支/提交；实际变更；使用的版本；运行命令和日志摘要；通过/失败/未运行的检查；最小演示；回退方式；待人工确认项。

真实代码、锁文件、构建和测试始终优先于此处的操作示意。发布和数据破坏性变更须另经授权。
