# CaseLite

**CaseLite — Local-first AI legal workspace**

CaseLite 是面向独立律师和小型法律团队的本地优先法律工作台。以事项（Matter）为工作单位，逐步整合文件阅读、法律来源与原文锚点、任务与交付、用户自有密钥（BYOK）的 AI 辅助以及按需协作和 MCP 扩展。

> **项目状态：规划与工程基线建设中。** 这是一份用于开发沟通的公开项目说明；不声明桌面应用、同步、OCR、AI 或 MCP 已可用。

## 产品原则

- 无需注册即可开展个人本地工作，个人核心能力以免费使用为目标。
- 一个 Matter 的主要栏目为：概况、任务、文件、交付物、动态。
- 法律输出必须区分来源、事实、规则、候选判断与律师正式确认；引用能定位原文不等于证明结论正确。
- 允许离线工作，远程协作应清晰区分本地保存与服务器确认。
- BYOK 下用户能了解向哪一个 Provider 发送了什么、费用与失败状态；默认不由 CaseLite 服务器代理推理。
- 先实现最小完整用户路径，再按证据扩展；不提前建设微服务、多 Agent 或插件市场。

## 工程状态与技术方向

当前已明确的**设计方向**为 Electron、React、TypeScript、SQLite/Drizzle、react-pdf/PDF.js、Tiptap/Yjs；计划按功能阶段接入 AI/OCR、PostgreSQL 共享协作及 MCP。依赖是否真正安装、版本是否兼容，应以仓库中的 `package.json`、`pnpm-lock.yaml`、代码、CI 和测试记录为准，**不能由本页推断已实现**。

## 开发入口

- **人类/LLM 协作规则**：[`AGENTS.md`](./AGENTS.md)
- **产品边界**：[`docs/PRODUCT.md`](./docs/PRODUCT.md)
- **架构边界**：[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)
- **环境与运行**：[`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md)
- **测试与验收**：[`docs/TESTING.md`](./docs/TESTING.md)
- **安全与公开仓库规则**：[`docs/SECURITY.md`](./docs/SECURITY.md)
- **开发交接操作手册**：[`docs/WORKFLOW.md`](./docs/WORKFLOW.md)
- **Linear 来源索引与状态**：[`docs/SOURCES.md`](./docs/SOURCES.md)

当前工程基线已有可执行命令：`pnpm check:quick`（离线的快速质量检查）、`pnpm ci`（Linux CI 门槛）、`pnpm coverage`、`pnpm test:full`（含本机 macOS 打包）和 `pnpm package`。它们是否通过，以当次终端输出、生成的本地证据和 GitHub CI 为准；SQLite/文件/IPC 集成测试与 Playwright Electron 自动化目前会明确报告“未运行”，不会被伪装为通过。

## 任务与验收

- 当前产品/任务基线： [Linear｜CaseLite 产品开发](https://linear.app/logixy-ai/initiative/caselite-产品开发-1ac38d27e4c0)
- 先完成 [P0｜开发准备与工程基线](https://linear.app/logixy-ai/project/caselite-p0开发准备与工程基线-1f1768b9cbd2) 对应的工程证据。
- 单次开发只选择一个获准的 Linear Issue，以最小改动和真实验证记录交付。

## 公开仓库须知

这个仓库是 **Public**。不要上传真实客户/案件材料、个人数据、凭据、Token、完整本地日志、私密商业资料或未经许可的第三方代码。当前未就开源许可作出授权声明；在选择许可证前，不应假定本项目已按 MIT/Apache/GPL 等条款开源。

---

资料生成时间：2026-10-29。本文是对 Linear v2.2 规划的**公开安全摘要**，不代替最新 Linear Resource 或已核验的代码。
