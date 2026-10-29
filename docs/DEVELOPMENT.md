# CaseLite｜开发环境与可复现操作

- **性质**：P0 开发工作手册草案，不是“所有工具已验证”的环境报告。
- **来源**：[P0 开发环境与依赖清单](https://linear.app/logixy-ai/document/caselite-p0开发环境必装工具与依赖准入清单-v1待验证-8203d1bf3ff4)、[DEV-1557](https://linear.app/logixy-ai/issue/DEV-1557)、[DEV-1565](https://linear.app/logixy-ai/issue/DEV-1565)
- **整理日期**：2026-10-29

## 1. 目标环境（不是全部发行平台承诺）

- 开发设备：macOS Apple Silicon（用户当前 Mac mini M4）。
- 外置开发盘：APFS 卷 `CASDEV`，示例路径 `/Volumes/CASDEV/projects/caselite`。
- 代码远端：公开仓库 `https://github.com/Casefe/caselite`；本机 `git push` 认证仍需在这台 Mac 上实际验证。
- 工具安装在内置盘，仓库、项目依赖和合成测试资料在外置盘。**CI 必须脱离 `/Volumes/CASDEV` 绝对路径也能工作。**

## 2. 用户提供的本机检查记录

| 项目 | 最近提供的输出（2026-10-29） | 待做事项 |
| --- | --- | --- |
| Git | 2.55.0，Homebrew 安装 | 在实际 CaseLite 仓库检查远端/分支/写入权限 |
| Node.js | v26.0.0 | 与 Electron/原生 SQLite driver/测试工具实测兼容后冻结版本；不凭空降级 |
| pnpm | 11.0.9 | 项目中固定 `packageManager` 与 lockfile；验证 frozen install |
| mise | 2026.5.18；`--version` 曾遇更新站点超时 | 网络问题与本地版本可用性分开诊断 |
| Xcode CLT | 路径 `/Library/Developer/CommandLineTools` | 编译器实际运行/原生模块构建仍待验证 |
| CASDEV | 约 931 GiB，四目录已创建，读写通过 | 本轮未直接重新检查挂载；每次写入前复核 |

上述记录是用户终端回显，并非本文件编写时运行的检查。

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

## 5. 项目脚本——**目标接口，尚待代码验证**

P0 预期在项目 `package.json` 中实现并验证下列语义，但不要在工程骨架尚不存在时声称命令已成功：

| 目标脚本 | 语义 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 从锁文件做干净、可复现安装 |
| `pnpm dev` | 运行 Electron 桌面开发环境 |
| `pnpm typecheck` / `pnpm lint` | 类型与静态检查 |
| `pnpm test` / `pnpm test:e2e` | 测试与桌面冒烟 |
| `pnpm make` 或约定的 `pnpm package` | 打包/发布能力验证 |
| `pnpm verify` | 全部强制检查的一键入口 |

真实脚本、版本、运行方式以 DEV-1557、1559 产物及 CI 为准，禁止在文档中捏造。

## 6. 依赖准入

- 基础：Electron、React、TypeScript、单一 Forge 构建主链；SQLite/Drizzle 用原生驱动时测试 Electron ABI、打包、迁移和重启。
- PDF/Worker：待合成 PDF 与离线打包 Spike 验证后纳入正式功能。
- Tiptap/Yjs：首个富文本用户路径启动时验证 Y.Doc 本地持久化；不提前建设协作服务器。
- AI SDK、PostgreSQL/Hocuspocus、Redis、MCP SDK：按各能力 Issue/ADR 分批引入，不为“以后会用”提前安装；Redis 不是 P3 持久化的前提。
- 不允许另建第二个 ORM、桌面框架、测试运行器或 Agent Runtime，除非有具体 Issue、替代分析、退出策略。

## 7. 交付证据模板

每一项开发任务交付：Issue ID；分支/提交；实际变更；使用的版本；运行命令和日志摘要；通过/失败/未运行的检查；最小演示；回退方式；待人工确认项。

真实代码、锁文件、构建和测试始终优先于此处的操作示意。发布和数据破坏性变更须另经授权。
