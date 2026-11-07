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
| [ADR-006](./ADR-006-task-body-local-snapshots.md) | 首片实现候选 | 独立Task与本地成果正文 | 以实际测试/回执为准 |
| [ADR-007](./ADR-007-editor-modes-and-task-description.md) | 提议 | 两种编辑器交互与任务说明富文本 | DEV-1732及当前消费者 |
| [ADR-008](./ADR-008-assistant-ui-pi-agent.md) | 已实现增量 | assistant-ui 与 Pi Agent | DEV-1652，合成流演示 |
| [ADR-009](./ADR-009-provider-model-selection.md) | 已决定（真实 API 待验证） | OpenAI/DeepSeek 独立凭据与显式默认模型 | DEV-1648，合成 HTTP 与打包设置回归 |

| [ADR-010](./ADR-010-local-catalog-persistence.md) | 已实现增量 | 五页本地目录与Document/Matter持久化 | 空旧库迁移、原生CRUD与重启 |
| [ADR-011](./ADR-011-local-agent-run-history.md) | 已实现增量（真实API另验） | Run本地登记、历史及中断恢复 | 原子登记、窗口/进程重开、零恢复派发 |
| [ADR-012](./ADR-012-device-appearance-preference.md) | 提议 | 设备外观偏好与受控接口 | UI接收、独立复核及未来迁移 |
| [ADR-013](./ADR-013-personal-daily-document.md) | 提议 | 个人每日 Document 与首页备忘录 | DEV-1689、迁移与恢复 Spike |

| [ADR-014](./ADR-014-local-pdf-materials-and-ocr.md) | 已实现增量（OCR质量未验收） | 本地 PDF 导入、版本化派生与选材快照 | DEV-1733、1609、1649、1651 |

| [ADR-015](./ADR-015-confirmed-local-task-reminders.md) | 提议 | 单Task人工确认时区、本机提醒与保守去重 | DEV-1686、原生通知/重启及人工接收 |

| [ADR-016](./ADR-016-local-project-finance-ledger.md) | 首版实现，待独立复核和业务接收 | 项目收费与回款账本 | DEV-1793、事务、幂等核对和重启 |

| [ADR-017](./ADR-017-task-list-query-cache.md) | 任务读取试点 | TanStack Query 与原业务 IPC | DEV-1800 |

当前 ADR 的来源是 DEV-1558 与现行 v2.2 Linear Resources；实际版本、代码位置和测试结果必须以仓库、锁文件和 CI 为准。

- [ADR-018](./ADR-018-read-only-project-graph.md) 项目关系图只读投影，DEV-1802。
