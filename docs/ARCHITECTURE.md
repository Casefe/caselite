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
