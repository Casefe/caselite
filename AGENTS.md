# CaseLite｜编码助手工作约定

> 适用于本仓库。版本：草案 v1（2026-10-29）；由 Linear DEV-1562 的要求整理，**未代替其设计验收**。保持短小，详细规则按需查阅 `docs/`。

## 当前任务与真实来源

- 本项目是本地优先法律工作台；**当前为 P0 工程准备/设计阶段**，没有经验证的产品实现不能称已完成。
- **一次只执行一个明确获准的 Linear Issue**。任务状态、优先级、依赖、验收以 Linear 为准；勿把历史规划自动变成开发队列。
- 产品语义以现行 Linear v2.2 Resources 为准；实际路径、命令、版本、数据库迁移以当前仓库和可执行证据为准；冲突时停止、报告，不自行篡改业务要求。索引见 `docs/SOURCES.md`。

## 修改前

1. 只读检查仓库：`pwd`、`git status`、相关文件、当前任务、适用架构边界。不要预设 `/Volumes/CASDEV` 在其他电脑或 CI 存在。
2. 复述**唯一用户结果、允许范围、非目标、风险、相关模块、验证方案和回退方式**。
3. 对业务含义、法律判断、外发、费用、授权、删除/不可逆数据变更、公开推送/部署或修改关键架构的决定，先取得人工确认；普通低风险实现无需反复确认。

## 不可突破的边界

- Renderer 不可直接访问 Node、SQLite、任意文件路径或秘密；只通过类型化、运行时校验的 Preload/IPC → Application → Domain/Port。
- 内部 Agent、MCP 和连接器也只能通过受控 Application 入口操作领域对象；不得绕过权限、审计或人工法律确认。
- 本地 SQLite、Yjs 文档状态、不可变文件和将来的云端共享分别有自己的权威/恢复规则；不建第二套“事实数据库”，不把所有业务对象做成 CRDT。
- 不为一个小功能新增第二套打包器、ORM、运行时、同步框架或多 Agent 平台。涉及长寿命协议/存储/安全决定先记录 ADR 与 Spike。
- 本仓库为 **Public**：绝不提交真实案件、客户数据、密钥、`.env`、可识别的日志/截图或无许可代码。详见 `docs/SECURITY.md`。

## 执行、验证与交付

- 最小修改，避免顺手重构；不能为测试通过而删除/弱化测试、权限检查或 CI。
- 先读 `docs/DEVELOPMENT.md` 确认**真实存在**的脚本；没有 `package.json`/测试工具时明确报告“未配置”，不可虚称通过。
- 执行适用的类型、lint、单元/合同、集成、E2E、构建、安全检查；无法运行的逐项说明原因。
- 涉及桌面边界、公开资料、日志或依赖的改动，至少执行 `pnpm security:baseline`；它检查公开仓库、Electron/Fuses/CSP/权限、直接日志与秘密扫描。未完成的联网漏洞审计必须如实记录。
- 交付必须列出：修改文件、版本/提交、真实命令和结果、演示证据、失败路径、风险、未验证项、回退方法；最后由人工接受或退回。

## 按需参考（不要每次全文读取）

- 用户体验/范围 → `docs/PRODUCT.md`；流程边界 → `docs/WORKFLOW.md`
- 跨模块设计/同步/状态 → `docs/ARCHITECTURE.md`、相关 ADR
- 本地环境/依赖 → `docs/DEVELOPMENT.md`
- 测试或修复 Bug → `docs/TESTING.md`
- IPC、文件、外发、鉴权 → `docs/SECURITY.md` 与经确认的具体合同
- 单项设计草案的完整来源 → `docs/SOURCES.md` 中对应 Linear Resource/Issue

_机械检查应交给脚本/CI，不应继续把所有规范堆到本文件。_

## 修改位置速查（按 Issue 创建，目录存在不等于功能已实现）

| 需求                      | 首选位置                                                                                              |
| ------------------------- | ----------------------------------------------------------------------------------------------------- |
| 领域规则                  | `packages/domain/`                                                                                    |
| 用户动作与事务编排        | `packages/application/`                                                                               |
| SQLite、迁移、本地 Outbox | `packages/local-db/`                                                                                  |
| Electron 接线             | `apps/desktop/src/main/adapters/`                                                                     |
| React 界面                | `apps/desktop/src/renderer/features/`                                                                 |
| PDF 阅读与锚点            | `packages/pdf/`                                                                                       |
| 文件身份、版本与传输      | `packages/files/`                                                                                     |
| 模型／OCR 接入            | `packages/integrations/`                                                                              |
| Agent 运行过程            | `packages/work-runtime/`                                                                              |
| MCP 协议与连接器          | `packages/integrations/mcp/`、`packages/integrations/connectors/`、`apps/desktop/src/main/hosts/mcp/` |
| 同步客户端                | `packages/sync-client/`                                                                               |

修改前说明为何选这些位置、为何不改其他包、是否跨越稳定边界及是否需要 ADR。遇到 MCP 直达 Repository、Skill 直达 SQLite、renderer 直达本地存储或重复 Runtime，停止并报告。目标目录未创建时，先核对当前 Issue 和 `docs/ARCHITECTURE.md`；名称或层级冲突须报告，不可为对齐表格预建空包。

## 开源参考准入

- 开工先读 `docs/SOURCES.md` 所列的开源采用矩阵、相关 ADR 和当前 Issue；不能以参考项目的热度或做法作为唯一依据。
- 不复制许可证未知、AGPL 或商业目录的实现。拟复用任何源码时先停止，提交来源仓库、文件、Commit、许可证、NOTICE 和影响供人工确认；遵守 `docs/adr/ADR-005-third-party-code-license-and-clean-room.md`。
- 把参考架构转成 CaseLite 自己的接口、命名、失败行为和测试，不兼容参考项目的私有实现。改变进程边界、持久化格式、同步协议、权威状态或核心依赖时，先更新 ADR 并执行相应 R2 Spike；未经 Issue 授权不新增数据库、同步框架、状态管理框架、微服务或平台目录。
- 研究必须落到决定、测试或自动门禁。交接列出参考来源、许可证处理、实际运行、未运行及回退点；资料堆积和 AI 自评不是完成证据。

## 可维护性与独立审查（DEV-1562）

- **开工必读**：读取本文件、当前 Linear Issue 以及 [代码审查规范](docs/CODE_REVIEW.md)；按实际影响读取 ARCHITECTURE、TESTING、SECURITY、相关 ADR。开工报告列出实际读取的路径、允许/禁止改动范围、风险、验证命令；未读取不得声称已读取。
- **先找旧实现，再做最小改动**：清晰命名和类型优先于注释；优先复用已经存在的 Application/Port/合同，不重复造轮子、不引入非必要抽象。
- **中文关键注释**：AI 新写的、需要解释设计意图的注释使用中文，说明为什么、不可破坏的条件和失败恢复；特别关注 IPC/权限/密钥、SQLite 事务、原文 Anchor、Yjs/同步权威状态。简单代码不强制注释；第三方与生成代码不为语言规范重写；API 名、类型、协议字段及 `@param` 保留原样。
- **变更留证**：每个 PR 关联明确的 Linear Issue，按 `.github/PULL_REQUEST_TEMPLATE.md` 填写输入输出、实际变更、失败路径、验证命令及结果、未测项、回退方法；必要时维护 ADR。不得以叙述取代真实日志。
- **独立复核**：高风险代码须让不同上下文的审查者依据实际 diff、相关合同和测试证据审查。AI 意见不是通过证明，分支门禁与人工业务确认不可省略。
- **规则文件也是保护资产**：修改 AGENTS、审查规范、安全、ADR、测试或 CI 只能在对应 Issue 授权内进行，必须审阅精准 diff，禁止以降低门禁换取通过。
