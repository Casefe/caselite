# CaseLite｜Architecture Decision Records（ADR）

这里记录会长期影响数据、权限、进程边界、协议、依赖或退出成本的工程决定。它不是产品需求清单，也不以“已有一个文件”证明功能已经实现。

## 使用规则

1. 先从 [`ADR_TEMPLATE.md`](./ADR_TEMPLATE.md) 创建记录；初始状态只能是“提议”。
2. 只有具有真实代码、测试、Spike 或人工确认的结论才可标为“已决定”或“已验证”；两者不得混用。
3. 每份 ADR 必须写明问题、不变量、候选、采用与放弃方案、官方/Spike 证据、后果、回退与重新评估条件。
4. 涉及真实法律数据、外发、费用、发布、数据删除或长期协议变更时，必须在对应 Linear Issue 中取得人工确认；本仓库不保存客户资料或密钥作为证据。
5. 临时小改动不创建 ADR；改变 Electron 权限、数据库/迁移、Yjs 权威、同步、附件版本、云服务或代码许可证时必须创建或修订 ADR。

## 当前索引

| ADR | 状态 | 主题 | 后续验证 |
| --- | --- | --- | --- |
| [ADR-001](./ADR-001-electron-process-and-ipc-boundary.md) | 已决定（IPC 用例待验证） | Electron main / preload / renderer 边界 | DEV-1561、DEV-1578 |
| [ADR-002](./ADR-002-local-sqlite-drizzle-and-transaction-boundary.md) | 提议 | SQLite、Drizzle、Repository 与事务 | DEV-1567、DEV-1566 |
| [ADR-003](./ADR-003-structured-delta-and-yjs-document-state.md) | 架构方向已确认 | 结构化 Delta 与 Yjs 文档状态 | DEV-1570、P3 Issues |
| [ADR-004](./ADR-004-pdf-worker-and-immutable-file-boundary.md) | 提议 | PDF Worker、附件与不可变版本 | DEV-1560、DEV-1568、DEV-1579 |
| [ADR-005](./ADR-005-third-party-code-license-and-clean-room.md) | 已决定 | 第三方代码、许可证与 Clean-room | DEV-1559、DEV-1569 |

当前 ADR 的来源是 DEV-1558 与现行 v2.2 Linear Resources；实际版本、代码位置和测试结果必须以仓库、锁文件和 CI 为准。
