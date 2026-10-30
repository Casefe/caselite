# CaseLite｜架构原则与模块边界

- **性质**：现行 v2.2 架构方向的公开安全摘要；**不是已实现的架构审计报告**。
- **来源**：[架构与开发约定 v2.2](https://linear.app/logixy-ai/document/caselite架构与开发约定-v22现行-d22d41990c7d)、[P3 同步/恢复合同（待验证）](https://linear.app/logixy-ai/document/caselite-p3同步协议持久化与恢复合同-v1待验证-0e3b701342ca)
- **核对日期**：2026-10-29

## 1. 总体原则

采用**单仓库、模块化单体、桌面本地优先**，而非为 P1—P4 建四套服务。`Electron + React + TypeScript + SQLite/Drizzle + react-pdf/PDF.js + Tiptap/Yjs` 是既定技术方向；是否已在真实仓库安装及可用，必须通过锁文件、代码、打包和测试核查。

逻辑依赖方向：

```text
Renderer / UI
  ↓ typed Preload + versioned IPC
Application（Command / Query / Event / 授权、事务与审计）
  ↓
Domain（Matter、SourceVersion、Anchor、Finding、Decision…）
  ↓ Ports
Local DB（SQLite/Drizzle）· Files（不可变版本）· Editor/CRDT · Integrations

P2 WorkRun / P3 Sync / P4 MCP 均通过受控 Application 入口进入
```

此图是**模块职责示意**，不是实际目录树。目录及 import 约束由 DEV-1558、DEV-1578 按代码冻结。Renderer、MCP 和内部 Skill 不能直接调用 Repository/任意 SQL/文件路径。

## 1.1 DEV-1558 冻结的目录职责与创建时机

截至 `fbfece3`，实际已存在的程序代码只有 `apps/desktop/`：它包含 Electron `main`、`preload` 和 React `renderer` 的工程骨架。下列目录是**职责合同**，不是要求一次性创建空目录；只有有当前用户结果、公共入口和至少一项验证时才可创建。

| 位置 | 职责 | 创建时机 | 不能做什么 |
| --- | --- | --- | --- |
| `apps/desktop/src/main/` | Electron 生命周期、composition root、受控 IPC 注册和平台适配 | 已存在；首个用例时再分出 `composition/`、`adapters/`、`ipc/` | 不放 React 页面、领域规则或任意 SQL |
| `apps/desktop/src/preload/` | 仅向 renderer 暴露逐项、类型化的业务 API | 已存在；首个 IPC 时扩展 | 不暴露通用 `ipcRenderer`、shell、任意路径或 Node API |
| `apps/desktop/src/renderer/` | 页面、用户交互、显示状态 | 已存在 | 不导入 Electron、Node、SQLite、文件系统、Repository 或 Provider SDK |
| `packages/contracts/` | 跨进程/跨服务的版本化 TypeScript + Zod 合同 | DEV-1578 首个 IPC Spike | 不包含业务实现或数据库驱动 |
| `packages/application/` | Command、Query、use case、Port、领域事件、权限/事务顺序 | DEV-1578 首个受控业务入口 | 不依赖 Electron、React、Drizzle 或网络 SDK |
| `packages/domain/` | Matter、SourceVersion、Anchor 等纯业务规则 | P1 schema 合同确认后 | 不依赖框架、数据库、文件或网络 |
| `packages/local-db/` | SQLite schema、迁移、Repository、事务与本地 Outbox | DEV-1567 | 不被 renderer、MCP 或 Skill 直接导入 |
| `packages/files/` | 文件元数据、不可变版本、本地存储适配 | P1 文件需求确认后 | 不把案件文件存入仓库或 `desktop/resources` |
| `packages/pdf/` | PDF worker、阅读器、选择与定位适配 | DEV-1568 / P1 PDF 切片 | 不作为业务真相来源或绕过 SourceVersion |
| `packages/editor/`、`packages/crdt/` | 编辑器视图与 Yjs 文档状态 | 首个富文本用例且 DEV-1570 准入后 | 不把 Matter、任务、权限等都变成 CRDT |
| `packages/work-runtime/`、`integrations/llm/`、`integrations/ocr/` | P2 的受控 AI/OCR 适配 | P2 首个 Provider 获批后 | 不直达 SQLite、文件或正式 Decision |
| `apps/server/`、`packages/sync-client/`、`packages/authz/`、`infra/` | P3 单一模块化服务、同步、共享鉴权和运维 | P3 ADR/实施合同获批后 | 不预建空服务或同步 SQLite 文件 |
| `integrations/mcp/`、`integrations/connectors/` | P4 的外部能力适配 | P4 首个真实连接器获批后 | 不绕过 Application、权限或人工确认 |
| `tests/fixtures/` | 公开、合成且版本化的固定样本和负向夹具 | 已创建最小架构夹具；DEV-1560 再加入合同样本 | 不放真实客户资料、密钥或可识别日志 |

`desktop/resources/` 将来只放图标、字体与构建静态资源，绝不放法律资料。P3 首期为一个 `apps/server` 部署单元；不建立 `api-server` 和 `collab-server` 两个空项目。

首批 ADR 的索引与使用规则见 [`docs/adr/README.md`](./adr/README.md)。它们记录已决定的边界和仍待 Spike 的选择；目录或文件存在不代表对应能力已实现。

## 1.2 允许依赖与禁止导入

```text
renderer → preload API → versioned contracts → main IPC → application → domain → ports
                                                               ↓
                                              local-db / files / pdf adapters

P2 Work Runtime / P3 server + sync / P4 MCP host ────────────→ application
```

允许的方向是从外层入口进入 `application`，再由 `application` 调用纯 `domain` 和 Port；具体存储或文件实现反向实现 Port。`contracts` 可被边界两侧读取，但不得携带实现。未来同步客户端只消费变化合同，不拥有领域 Repository。

| 发起方 | 明确禁止直接导入 |
| --- | --- |
| renderer | `electron`、Node 内置模块、`better-sqlite3`、Drizzle Node Driver、`local-db`、`files`、`application` 实现、Provider SDK |
| preload | 通用 `ipcRenderer` 转发、shell、任意文件读写、数据库连接 |
| main / IPC | React 页面、直接接受未校验 renderer 参数、向用户回传 SQL/路径/堆栈 |
| domain | Electron、React、Drizzle、SQLite driver、Yjs、网络 SDK |
| MCP / Skill / Work Runtime | Repository、SQLite、任意本地路径；只能调用 Application Command/Query |
| sync-client | React 页面或领域 Repository；不得直接同步 SQLite 文件 |

当前可执行门禁是 `pnpm architecture:check`：它扫描实际 renderer 源码，并用 `tests/fixtures/architecture-boundaries/renderer-imports-node.ts` 证明“renderer 导入 Node”会被拒绝。它是 DEV-1559 的 CI/lint 测试体系之前的最小 Spike，不替代后续 ESLint、合同测试或安全审计。

## 1.3 示例：第一个“创建 Matter”功能应改哪里

这是边界示例，不表示 Matter 已被设计或实现。待 P1 schema 与 DEV-1578 合同确认后，一个创建 Matter 的最小改动应涉及：renderer 功能页、preload 的单一 `createMatter` 方法、contracts 的请求/响应 Zod Schema、main 的 IPC handler、application Command/use case、domain 规则、local-db 迁移/Repository，以及相应测试。

它**不应**修改 PDF、Yjs、同步、LLM/OCR、MCP、服务器或任何外部连接器；也不应让 React 组件直接连接 SQLite。若需求必须跨过此边界，先新增 ADR，并在对应 Linear Issue 中获批。

## 2. 本地数据与法律原文

- 个人未共享数据以本地 SQLite 和受控文件版本为工作来源；跨进程写入需事务、一致的边界与恢复策略。
- 本地 Source/SourceVersion、Asset/AssetVersion 和 Anchor 必须有稳定身份；文件位置可以变，原件与 OCR 派生文本不可混淆。
- 文件哈希可用于校验内容一致性，不足以证明来源真实性、授权或法律适用性。
- 法律审核状态与存储/同步状态分离；来源升级保留旧版本、旧 Anchor、旧正式交付，只对有依赖的结论提示复核。
- 富文本技术方向为 Tiptap/ProseMirror + Yjs。**首个仅含 PDF 的切片可延后安装**，但首次真实富文本切片应一起验证 Y.Doc 本地权威、持久化、备份与恢复，不能先建一套冲突的 HTML/JSON 权威。

## 3. P2：本地 WorkRun / BYOK

- Context、Tool 和 Skill 通过 Application 使用经过授权的 Matter/Source 数据。
- 单个 WorkRun 记录输入版本、Provider/模型、Skill/工具、预算、用量、候选与失败；未知提交状态需对账，不能盲重试造成重复费用。
- Key 使用系统安全凭据接口；普通 SQLite、日志、Prompt 记录、同步和版本控制不存储 Key 明文。
- Provider 与 Skill 的**详细 schema 仍待 DEV-1580 确认**，不得从本文推测现成 API。

## 4. P3：混合本地优先同步方向

三条数据平面各自确定一致性和恢复方式：

| 数据平面 | 当前设计方向 | 不变量 |
| --- | --- | --- |
| 结构化对象 | SQLite Outbox + `mutation_id` + Delta/Snapshot；共享后 PostgreSQL 云端权威接纳和序列 | 幂等、重放、游标恢复；Pending 不可静默丢弃 |
| 富文本 | Yjs Update/Snapshot，Hocuspocus 候选服务，PostgreSQL 持久化 ACK | 数据库提交前不能称“已持久保存云端”；Yjs 合并不是律师审核 |
| 附件 | 不可变 asset_version + 对象存储 + 哈希/ready | 版本不覆盖、上传失败可恢复，ready 前不可当作可交付 |

WebSocket 是通知/实时传输而非唯一恢复来源；Redis 仅作为未来可丢失的在线状态/广播优化，**首期不强制安装**。共享授权、撤权、不同客户端确认和故障矩阵需按 P3 设计/Spike 验证。上述是已选架构方向，**不等于真实上线**。

## 5. P4：MCP 与外部连接

MCP Client/Server 只包装已定义的 Application 业务入口；先验证一个真实知识源和一个外部客户端。读工具与候选写入分离，要求对象级授权、分页限额、来源版本/位置和人工确认；不暴露 SQL、任意磁盘路径、命令执行或未经审核的正式 Decision。

## 6. 变更门槛与 ADR

改变以下任一长期不变量应先有 ADR＋必要 Spike：进程/权限边界、稳定 ID 与存储格式、SQLite 迁移、Yjs 权威、共享 Delta/Checkpoint、附件不可变状态、云服务/外发与供应商锁定。采用 `docs/adr/TEMPLATE.md`，技术选择完成前只能标为“提议”，不能当已通过。

## 7. 后续事实来源

- 需求与设计：Linear Resources/Issues，见 `docs/SOURCES.md`。
- **实际实现**：代码、TypeScript/Zod 合同、Drizzle 迁移、`package.json`/锁文件、CI 与真实测试。
- 两者矛盾应停止推测并报告；不能为了匹配文档而静默破坏已存用户数据。
