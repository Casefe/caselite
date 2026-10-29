# CaseLite｜Linear 来源索引与 Markdown 归属

> **索引快照：2026-10-29。** 本文件是定位入口，不自动同步 Linear 状态。现行 Linear 文档的完整正文未在本次制作中逐份全部取回；此处 Markdown 是**结构化公开摘要**，不是原件的逐字镜像。正式决策前应阅读最新 Linear Resource/Issue，避免把尚待验证的设计认作完成。

## 1. 事实来源与冲突规则

1. **Linear Resources**：产品要求、现行设计原则、待验证合同与业务决定；务必区分现行与历史链接。
2. **Linear Issues**：当前要做什么、依赖、责任、验收、状态；不要把全部 Issue 复制成第二套本地任务清单。
3. **仓库源码/迁移/锁文件/测试**：实际实现、版本和可执行验证的证据；文档不能声称不存在的功能或命令已通过。
4. **本仓库文档**：提炼长期有效的规则与经确认的技术决定。冲突时记录差异并由责任人决定如何修复，不静默覆盖。

本项目曾有 v2.0 / v2.1 链接指向同一文档实体；**当前优先读取 v2.2**。历史 7 个 Project、45 个 Issue 不属于当前执行队列，不能未经批准恢复。

## 2. 十三份独立 Resources 与本地文档映射

| 项目 | Linear Resource（当前名称/状态） | 本地目标与处理方式 |
| --- | --- | --- |
| 共用 | [产品定义 v2.2](https://linear.app/logixy-ai/document/caselite产品定义-v22现行-1adb0efed051) | `PRODUCT.md`：公开安全摘要；遇冲突回读原文 |
| 共用 | [架构与开发约定 v2.2](https://linear.app/logixy-ai/document/caselite架构与开发约定-v22现行-d22d41990c7d) | `ARCHITECTURE.md`：长期方向/不变量 |
| 共用 | [场景与验收样例 v2.2](https://linear.app/logixy-ai/document/caselite场景与验收样例-v22现行-65005791136a) | `TESTING.md`：测试基线，样本尚待验证 |
| P0 | [开发环境、必装工具与准入清单 v1](https://linear.app/logixy-ai/document/caselite-p0开发环境必装工具与依赖准入清单-v1待验证-8203d1bf3ff4) | `DEVELOPMENT.md`：目标命令/真实版本分开 |
| P0 | [Application Command/Query/Event 与 IPC 合同 v1](https://linear.app/logixy-ai/document/caseliteapplication-commandqueryevent-与-ipc-合同-v1待验证-8893cd0ee0da) | DEV-1578 确认后建 `contracts/application.md` |
| P0 | [开源架构参考与采用矩阵 v1.1](https://linear.app/logixy-ai/document/研究参考caselite开源架构参考与采用矩阵-v11-c4cdac98fa55) | 保留 Linear；经验证的重要选择才进入 ADR |
| P1 | [领域 Schema、状态机与迁移合同 v1](https://linear.app/logixy-ai/document/caselite-p1领域-schema状态机与迁移合同-v1待验证-999c029bbe84) | DEV-1577 确认后建 `contracts/domain.md`；最终 schema 以代码/迁移为准 |
| P1 | [五栏目 UI 与交互合同 v1](https://linear.app/logixy-ai/document/caselite-p1五栏目-ui页面状态与交互合同-v1待验证-1e13f18159bf) | DEV-1576 确认后建 `product/matter-ui.md` |
| P1 | [SourceVersion、文件、PDF 与 Anchor 合同 v1](https://linear.app/logixy-ai/document/caselite-p1sourceversion文件pdf-与-anchor-合同-v1待验证-68d7d52f2e0a) | DEV-1579 确认后建 `contracts/source-anchor.md` |
| P2 | [WorkRun、Context、Provider 与 Skill 合同 v1](https://linear.app/logixy-ai/document/caselite-p2workruncontextprovider-与-skill-合同-v1待验证-2e77f89332b1) | DEV-1580 确认后建 `contracts/workrun.md` |
| P3 | [同步协议、持久化与恢复合同 v1](https://linear.app/logixy-ai/document/caselite-p3同步协议持久化与恢复合同-v1待验证-0e3b701342ca) | DEV-1555 确认后建 `contracts/sync.md` |
| P3 | [容量、成本与运维基线 v1（估算）](https://linear.app/logixy-ai/document/caselite-p3容量成本与运维基线-v1估算-0613d79c89ea) | 留在 Linear；真实测量后再建运维文档 |
| P4 | [MCP 与外部连接器合同 v1](https://linear.app/logixy-ai/document/caselite-p4mcp-与外部连接器合同-v1待验证-2e4196f80d30) | DEV-1581 确认后建 `contracts/mcp.md` |

`docs/` 中 `PRODUCT`、`ARCHITECTURE` 等为**面向 LLM 开发的维护摘要**；不复制上表全部正文，避免版本分叉。后续合同文件只有在实际设计确认或实现阶段再生成。

## 3. 当前 29 项 Issues 索引（按 Project）

**P0｜工程准备（15项）**

- [DEV-1557](https://linear.app/logixy-ai/issue/DEV-1557) 仓库与桌面骨架 → README、DEVELOPMENT
- [DEV-1558](https://linear.app/logixy-ai/issue/DEV-1558) 模块边界与 ADR → ARCHITECTURE、ADR
- [DEV-1559](https://linear.app/logixy-ai/issue/DEV-1559) G0/CI → TESTING
- [DEV-1560](https://linear.app/logixy-ai/issue/DEV-1560) 合成样本/金标准 → `tests/fixtures/`（完成后）
- [DEV-1561](https://linear.app/logixy-ai/issue/DEV-1561) Electron 与法律数据安全 → SECURITY
- [DEV-1562](https://linear.app/logixy-ai/issue/DEV-1562) AGENTS/非程序员手册 → AGENTS、WORKFLOW
- [DEV-1563](https://linear.app/logixy-ai/issue/DEV-1563) 首片实施合同 → `docs/plans/first-slice.md`（确认后）
- [DEV-1564](https://linear.app/logixy-ai/issue/DEV-1564) 新 LLM 端到端预演 → 真实证据，非预制成功记录
- [DEV-1565](https://linear.app/logixy-ai/issue/DEV-1565) 开发机安装自检 → DEVELOPMENT
- [DEV-1566](https://linear.app/logixy-ai/issue/DEV-1566) SQLite 与 PDF 离线集成回归 → TESTING 与实际构建证据
- [DEV-1567](https://linear.app/logixy-ai/issue/DEV-1567) SQLite/Drizzle 验证 → DEVELOPMENT、技术 ADR
- [DEV-1568](https://linear.app/logixy-ai/issue/DEV-1568) PDF/打包器验证 → DEVELOPMENT、TESTING
- [DEV-1569](https://linear.app/logixy-ai/issue/DEV-1569) 后续框架依赖准入 → ARCHITECTURE
- [DEV-1570](https://linear.app/logixy-ai/issue/DEV-1570) Tiptap/Yjs 持久化与延迟准入 → ARCHITECTURE、后续 ADR
- [DEV-1578](https://linear.app/logixy-ai/issue/DEV-1578) Application/IPC 合同 → 后续 `contracts/application.md`

**P1｜本地工作（4项）**：
[DEV-1553](https://linear.app/logixy-ai/issue/DEV-1553) 本地法律工作设计；
[DEV-1576](https://linear.app/logixy-ai/issue/DEV-1576) Matter UI；
[DEV-1577](https://linear.app/logixy-ai/issue/DEV-1577) 领域 schema；
[DEV-1579](https://linear.app/logixy-ai/issue/DEV-1579) PDF/SourceVersion/Anchor。

**P2｜智能执行（2项）**：
[DEV-1554](https://linear.app/logixy-ai/issue/DEV-1554) 用户 Key 与 AI 交互设计；
[DEV-1580](https://linear.app/logixy-ai/issue/DEV-1580) WorkRun/Context/Provider/Skill 合同。

**P3｜协作（6项）**：
[DEV-1555](https://linear.app/logixy-ai/issue/DEV-1555) 协作设计；
[DEV-1571](https://linear.app/logixy-ai/issue/DEV-1571) Delta/Snapshot；
[DEV-1572](https://linear.app/logixy-ai/issue/DEV-1572) 附件；
[DEV-1573](https://linear.app/logixy-ai/issue/DEV-1573) 统一鉴权；
[DEV-1574](https://linear.app/logixy-ai/issue/DEV-1574) Yjs 持久化；
[DEV-1575](https://linear.app/logixy-ai/issue/DEV-1575) 同步状态与恢复。

**P4｜MCP（2项）**：
[DEV-1556](https://linear.app/logixy-ai/issue/DEV-1556) 外部能力连接设计；
[DEV-1581](https://linear.app/logixy-ai/issue/DEV-1581) MCP/连接器合同。

以上只是发现索引，**不代表这些任务均已批准开工或完成**。请到 Linear 查看最新状态、里程碑和依赖。

## 4. 生成与维护规则

- 初始只生成根 README、AGENTS、稳定方向与开发规范；**不批量创建空合同或假测试样本**。
- 重要长期决定经 ADR 验证后进入仓库；候选协议先放对应 Linear Resource。
- 修改后只更新与本 Issue 有关的 Markdown；必要时记录来源版本/确认人/测试证据。
- 非公开的商业成本、客户、密钥、敏感安全设计与完整合同不直接进入 Public 仓库。
- 不用仓库 Markdown 保存 Linear 的动态任务状态；历史资料不得自动恢复成执行队列。
