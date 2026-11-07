# 生产依赖准入与退出

DEV-1569 的生产消费者规则在 `scripts/lib/dependency-admission.mjs`，由现有 `pnpm architecture:check` 执行。未登记的包、消费者或版本，包括 root、optional、peer 入口，均失败；不创建第二流水线。此表不授予安装候选或调用付费服务的权限。开发工具、传递依赖、安装脚本仍由锁文件、许可证、安全和实际构建检查负责，本检查不冒充全部供应链审计。

| 消费者与责任 | 已锁定生产依赖 | 来源与许可 | 能力证据及退出 |
| --- | --- | --- | --- |
| Desktop / DEV-1557、1568 | React/DOM 19.3.1、react-pdf 11.0.0、pdfjs-dist 6.3.289 | npm 对应官方包，MIT / Apache-2.0 | 桌面与离线PDF探针；同一Forge构建。回退依赖时恢复锁版并重新打包，不更换原件 |
| Desktop / DEV-1592、1732 | Tiptap 四包 3.32.3、Yjs 13.6.33 | Tiptap / Yjs 官方包，MIT | Y.Doc保存重启与真实编辑；不是实时协作证明。退出保留body_revisions，先验证旧快照可读，禁止以HTML覆盖正文 |
| Desktop / DEV-1650、1652、1648 | assistant-ui 0.15.32、Pi Core / AI 1.5.0 | 官方 npm 包，MIT；传递许可见生成的许可证报告及 ADR-008 | SDK及合成Provider打包验证，真实Key另验。只有一个Loop；没有Coding Agent、Shell或Pi session。退出关闭AI，人工Task/正文继续可读，保全原Run |
| Desktop / DEV-1788 | @ai-sdk/react 3.0.327、ai 6.0.324 | 官方 npm，Apache-2.0；json-schema 0.4.0 选 BSD-3-Clause，见 ADR-008 和随包通知 | 文档审阅唯一消费者，自定义 IPC Transport。间接 Gateway 随上游锁定。回退 UI 与锁版，保留 Yjs 修订和原本机 Run |
| Desktop / DEV-1323 | `@tanstack/react-table@8.21.3`、传递 `@tanstack/table-core@8.21.3` | [TanStack Table 官方 npm 包](https://github.com/TanStack/table)，两包均为 MIT，发布包附 LICENSE；React 19 满足 peer 范围 | 仅项目文件页 Renderer 的列、行和展开状态。纯 JS，无原生模块、网络请求或文件访问；回退提交即可恢复原表格和锁版，无数据迁移 |
| Application | contracts workspace | 自有公开入口 | 不导入驱动与Provider；退出由调用链合同验证 |
| Desktop / DEV-1735 | @assistant-ui/react-markdown 0.14.24 | 官方 npm 包 MIT；@ungap/structured-clone 1.4.0 ISC 精确许可见 ADR-008 与随包通知 | 只读 CommonMark；关闭原始 HTML、链接导航和远程图片。回退恢复原展示，Run 原始文本保持可读；不增加正文或 Agent 内核 |
| Contracts / DEV-1578 | Zod 4.6.7 | 官方包，MIT | 运行时输入校验；协议升级独立评估兼容 |
| Local DB / DEV-1567、1590 | better-sqlite3 13.0.3、Drizzle 0.45.4、Yjs 13.6.33 | 官方包，MIT / Apache-2.0 / MIT | 原生ABI、旧库迁移、事务与重启；回退前备份，旧二进制不直接打开不可逆新库 |

工作区包只允许现有已消费的公共入口；`packages/local-db` 与 `packages/application` 的 contracts 引用不得深导入。版本/来源按仓库 manifest 和锁文件复核，具体传递许可按 `pnpm licenses:report` 生成结果，更新时不沿用旧结论。

尚未安装的独立准入：DEV-1703 DOCX转换须核对转换依赖、许可、图片与列表样本及退出；DEV-1649 Swift Vision helper 须锁定源码/版本、平台、签名、离线与恢复，不预装MinerU/PaddleOCR/Python；MCP、同步、向量库与第二Runtime不随当前Pi接入安装。DOCX写出、OCR和固定来源功能不因本表存在视为可用。

升级时先在隔离副本验证开发态和实际打包产物、模块入口、正文与Run旧数据；失败保留证据，恢复已验证锁版后复检。同样的模型或UI供应商名称不保证跨版本兼容。不得复制AGPL/EE源代码来绕过许可审查。

DEV-1802 项目只读关系图在 Renderer 按需加载 `@xyflow/react@12.12.1`。使用 MIT 发布包及本地样式，详见 [ADR-018](../adr/ADR-018-read-only-project-graph.md)。
