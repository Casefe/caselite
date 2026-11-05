# CaseLite｜编码助手工作约定

> 适用于本仓库。依据：DEV-1562、CaseLite 精简版 v3.0 现行01—06；工程规则从现行06固定ID的实时正文、修订和用户授权核对，不把旧R4文字当当前版本。本文件不代替实际检查与人工验收。

## 当前执行方式｜2026-11-05 用户授权

产品原型尚未完成期间，采用[WORKFLOW原型直接开发模式](docs/WORKFLOW.md#原型直接开发模式2026-11-05)。先核对当前HEAD的适用安全证据，通过后直接写现有开发目录；修改后补受影响的功能和安全检查。现有证据仅在代码/规则/依赖/环境未使其失效时复用，不为每次普通编辑重跑全套检查。

每卡完成后回读Linear和真实依赖，自动推进下一张最小获准任务，不再逐卡请求开工。以实际文件、可回退提交、适用测试和运行证据报告进展；设计卡与产品功能分别验收。未来是否重写不作为跳过测试、丢弃数据或削弱凭据/原件保护的依据。产品完成或用户调整流程时重新评估GitHub协作门禁。

本段覆盖旧文中“必须专用分支/PR/合并后推进、每卡重新批准”的流程要求；不授予远端推送/强推、发布、费用、材料外发、不可逆数据删除或新增业务含义。必要的存储/恢复/权限独立复核继续按实际风险执行，不要求用户审阅Git历史。

## 当前任务与真实来源

- 本项目以独立Task开始，可选归组项目，复用统一Document/Yjs正文；当前已接入受控单Agent原型，完整选材、候选、来源/OCR及交付由各自消费者验收。工程基线/Spike与正式产品能力分别验收，不以规划、目录或依赖存在宣称功能完成。
- **一次只实施一个明确获准的 Linear Issue**，一个结果、一个主要 Owner；当前原型阶段直接在现有 CaseLite 开发目录串行实现，以本地小提交作为回退点；不要求每卡新分支、worktree、PR或GitHub合并。Linear记录任务/验收，本地Git记录代码与差异，按需使用GitHub。
- 产品与工程要求以 Linear **v3.0 现行01—06**为准；实际路径、命令、版本、迁移以当前仓库和可执行证据核验。旧 v2.x 与历史规划仅作研究；代码与批准合同冲突时停止、报告，由 Owner 决定。入口见 [SOURCES](docs/SOURCES.md)。

## 修改前

1. 读取当前 Issue 全文、适用合同段落、根及目标目录生效的 `AGENTS.md` 和必要代码/测试；核对 `pwd`、分支/HEAD、main 基线、工作区及依赖实际产物。不覆盖其他未提交修改，不预设机器绝对路径；沿用当前开发目录和checkout，不自动切换/重置分支。风险明确需要隔离的破坏性演练仍用独立测试数据目录。
2. 复述**唯一用户结果、Owner、允许文件、非目标、风险、验证和回退**；记录合同修订、批准范围与 baseline SHA。说明为何选这些模块、是否跨稳定边界/需要 ADR。
3. 未获授权的业务含义、法律判断、外发、费用、权限、删除/不可逆数据变更、发布/部署及关键架构决定，停止并取得人工确认。已明确授权的独立分支推送/Draft PR 按批准范围执行；不等于允许直推 main、合并或发布。普通低风险实现无需反复确认。

## 不可突破的边界

- Renderer 不可直接访问 Node、SQLite、任意文件路径或秘密；只通过类型化、运行时校验的 Preload/IPC → Application → Domain/Port。
- 内部 Agent、MCP 和连接器也只能通过受控 Application 入口操作领域对象；不得绕过权限、审计或人工法律确认。
- 每类对象只有一个数据 Owner：SQLite 管结构化对象；Yjs 二进制管可编辑正文，HTML/JSON/FTS 仅是可重建投影；AssetVersion/SourceVersion、Anchor 和交付快照保持固定版本。Anchor 定位不等于法律核验，原件/旧快照不得覆盖。不建第二真源，不把所有对象做成 CRDT。
- 同一 SQLite 连接内的元数据、正文、幂等及必要 ActivityEvent 优先同事务；实际跨介质写入采用可恢复提交，落盘后才确认对应修订已保存。本期不提前建云 Outbox；未来同步须按唯一选型入口准入。
- 不新增第二套打包器、ORM、正文内核或 Runtime；同步、OCR、MCP 等按获准 Issue 准入，不预建空包。共享 Schema/迁移/IPC/Yjs 格式/锁文件/Main/Preload/规则与 CI 单写入者串行变更；长寿命协议/存储/安全决定先记录 ADR 与必要 Spike。
- 本仓库为 **Public**：绝不提交真实案件、客户数据、密钥、`.env`、可识别的日志/截图或无许可代码。详见 `docs/SECURITY.md`。

## 执行、验证与交付

- 最小修改，避免顺手重构；不能为测试通过而删除/弱化测试、权限检查或 CI。
- 先读 `docs/DEVELOPMENT.md` 确认**真实存在**的脚本；没有 `package.json`/测试工具时明确报告“未配置”，不可虚称通过。
- 真实入口：`pnpm check:quick`、`pnpm review:changes`；按影响运行 `pnpm test:integration`、`pnpm run ci` 或 `pnpm test:full`。类型、lint、单元/合同、桌面/恢复/构建检查按范围选取，未运行逐项说明；Linux CI 不替代真实 Electron 测试。
- 涉及桌面边界、公开资料、日志或依赖的改动，至少执行 `pnpm security:baseline`；它检查公开仓库、Electron/Fuses/CSP/权限、直接日志与秘密扫描。未完成的联网漏洞审计必须如实记录。
- 交付列出文件、合同/批准、SHA、真实命令/退出码、失败路径、风险、未测项与回退；结果用 `PASS_REAL/MOCK_ONLY/NOT_RUN/BLOCKED/FAIL` 区分。CI、PR 或合并不等于业务验收，不自动将 Issue 标记“已完成”；自动评论/有限状态推进须有本次明确授权且执行器实测通过。

## 按需参考（链接不代表已加载）

- 合同 ID/修订、专项工作流与历史归属 → [docs/SOURCES.md](docs/SOURCES.md)
- 安装/运行 → [README.md](README.md)；环境/命令 → [DEVELOPMENT](docs/DEVELOPMENT.md)
- 开工/批准/返工/恢复 → [WORKFLOW](docs/WORKFLOW.md)；Diff/独立审查 → [CODE_REVIEW](docs/CODE_REVIEW.md)
- 架构/测试/安全 → [ARCHITECTURE](docs/ARCHITECTURE.md)、[TESTING](docs/TESTING.md)、[SECURITY](docs/SECURITY.md)，按当前任务加载；旧范围表述按 SOURCES 回读现行合同，不叠加执行
- ADR → [索引](docs/adr/README.md)；独立预演 → [REVIEW_HANDOFF_EXERCISE](docs/REVIEW_HANDOFF_EXERCISE.md)；PR 证据 → [.github/PULL_REQUEST_TEMPLATE.md](.github/PULL_REQUEST_TEMPLATE.md)

其他 Markdown 按任务和阶段读取，不全文重读历史。规则加载须核对当前 Codex 入口及目录覆盖关系，更新后用新会话实测；提示词不能保证遵守。任务/批准留 Linear，代码与检查证据先留本地Git及artifacts，GitHub按需同步；不新建 TASKS/PROGRESS/NEXT/DEVELOPMENT_LOG 平行账本。

## 修改位置速查（按 Issue 创建，目录存在不等于功能已实现）

| 需求                               | 首选位置                                                                                              |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 领域规则                           | `packages/domain/`                                                                                    |
| 用户动作与事务编排                 | `packages/application/`                                                                               |
| SQLite、迁移、本地 Activity 持久化 | `packages/local-db/`                                                                                  |
| Electron 接线                      | `apps/desktop/src/main/adapters/`                                                                     |
| React 界面                         | `apps/desktop/src/renderer/features/`                                                                 |
| PDF 阅读与锚点                     | `packages/pdf/`                                                                                       |
| 文件身份、版本与传输               | `packages/files/`                                                                                     |
| 模型／OCR 接入                     | `packages/integrations/`                                                                              |
| Agent 运行过程                     | `packages/work-runtime/`                                                                              |
| MCP 协议与连接器                   | `packages/integrations/mcp/`、`packages/integrations/connectors/`、`apps/desktop/src/main/hosts/mcp/` |
| 同步客户端                         | `packages/sync-client/`                                                                               |

这些是职责定位，不表示目录已创建；公共正文/Document 的 Owner 按现行02/03及实际仓库定位，不另建正文系统。遇到 MCP 直达 Repository、Skill 直达 SQLite、renderer 直达本地存储或重复 Runtime，停止并报告。目标目录未创建时，先核对当前 Issue、现行02和实际架构；名称或层级冲突须报告，不可为对齐表格预建空包。

## 开源参考准入

- 涉及开源采用时按 `docs/SOURCES.md` 读取采用矩阵相关段、ADR 和当前 Issue；不能以参考项目热度或做法作为唯一依据。
- 不复制许可证未知、AGPL 或商业目录的实现。拟复用任何源码时先停止，提交来源仓库、文件、Commit、许可证、NOTICE 和影响供人工确认；遵守 `docs/adr/ADR-005-third-party-code-license-and-clean-room.md`。
- 把参考架构转成 CaseLite 自己的接口、命名、失败行为和测试，不兼容参考项目的私有实现。改变进程边界、持久化格式、同步协议、权威状态或核心依赖时，先更新 ADR 并执行相应 R2 Spike；未经 Issue 授权不新增数据库、同步框架、状态管理框架、微服务或平台目录。
- 研究必须落到决定、测试或自动门禁。交接列出参考来源、许可证处理、实际运行、未运行及回退点；资料堆积和 AI 自评不是完成证据。

## 可维护性与独立审查（DEV-1562）

- **按需加载并留证**：开发或文档变更按 [代码审查规范](docs/CODE_REVIEW.md)核对准确 Diff、适用检查、失败路径及未验证项；只报告实际读取的路径与约束。
- **先找旧实现，再做最小改动**：清晰命名和类型优先于注释；优先复用已经存在的 Application/Port/合同，不重复造轮子、不引入非必要抽象。
- **中文关键注释**：AI 新写的、需要解释设计意图的注释使用中文，说明为什么、不可破坏的条件和失败恢复；特别关注 IPC/权限/密钥、SQLite 事务、原文 Anchor、Yjs/同步权威状态。简单代码不强制注释；第三方与生成代码不为语言规范重写；API 名、类型、协议字段及 `@param` 保留原样。
- **变更留证**：每个 PR 关联明确的 Linear Issue，按 `.github/PULL_REQUEST_TEMPLATE.md` 填写输入输出、实际变更、失败路径、验证命令及结果、未测项、回退方法；必要时维护 ADR。不得以叙述取代真实日志。
- **独立复核**：高风险代码须让不同上下文的审查者依据实际 diff、相关合同和测试证据审查。AI 意见不是通过证明，分支门禁与人工业务确认不可省略。
- **规则文件也是保护资产**：修改 AGENTS、审查规范、安全、ADR、测试或 CI 只能在对应 Issue 授权内进行，必须审阅精准 diff，禁止以降低门禁换取通过。
