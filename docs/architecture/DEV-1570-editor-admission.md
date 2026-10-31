# DEV-1570｜Tiptap／Yjs 依赖准入结论

- 日期：2026-10-31
- 任务：[DEV-1570](https://linear.app/logixy-ai/issue/DEV-1570)
- 结论：**首个 Matter＋PDF 原文锚点切片延后安装 Tiptap／Yjs**。技术方向仍为 Tiptap／ProseMirror＋Yjs；本决定仅规定安装时机，不改变产品架构。
- 依据：[现行 v2.2 架构](https://linear.app/logixy-ai/document/caselite架构与开发约定-v22现行-d22d41990c7d)、[DEV-1563 首片合同](https://linear.app/logixy-ai/issue/DEV-1563)、[ADR-003](../adr/ADR-003-structured-delta-and-yjs-document-state.md)。

## 当前用户结果与仓库事实

首片路径是：启动桌面程序 → 创建 Matter → 锁定一份合成合同原件 → 阅读 PDF → 选择原文建立 Anchor → 保存 → 关闭重启并回到同一版本和位置。它不要求输入、编辑或协同修改富文本正文。PDF 中选择原文片段也不等于编辑富文本。因此现在安装编辑器和 CRDT 依赖不能帮助验证这个用户结果。

在本次检查的基线提交 `c56494c`，根目录、桌面端与现有三个 workspace 包的 `package.json`，以及 `pnpm-lock.yaml` 均没有 `@tiptap/*`、`yjs`、`y-protocols`、`@hocuspocus/*` 或 `prosemirror-*` 的包记录。`packages/editor/`、`packages/crdt/` 和协作服务器也尚未创建。仓库未提供富文本功能或本地 Y.Doc 恢复能力；不把“未安装”写成“已验证兼容”。

## 首个富文本切片的准入条件

当有经确认的用户结果需要编辑笔记、文书正文、项目说明或共同批注时，先在该开发 Issue 中明确：

1. 谁编辑、编辑哪一个文档、保存后界面显示什么，以及断电、重启、旧版本和损坏投影时应如何恢复。
2. Tiptap Schema、Extension、命令与旧 Schema 的迁移/拒绝策略；核对 Tiptap、ProseMirror、Yjs 的兼容版本并固定锁文件。ProseMirror 由 Tiptap 的 `@tiptap/pm` 依赖提供，不另建一套编辑器状态。
3. 文档稳定 ID 与 Matter 等 SQLite 业务元数据的关系。正文权威为 Y.Doc 的二进制 Update／Snapshot；HTML、JSON 和搜索文本仅为可重建投影，不得反向覆盖 Y.Doc。
4. 本地写入顺序、Pending Update、事务边界、备份与恢复、Schema 升级和重复 Update 处理；先验证输入后立即强制退出、重启恢复等价 Y.Doc、删除或损坏投影后恢复、重复应用同一 Update 不产生重复正文。
5. 记录 Update 数量与字节、恢复时间、实际数据库位置，测试正常路径及至少两条失败路径；保留迁移或压缩失败前最后可恢复的数据。
6. 业务对象、权限、审计与正式法律交付仍走 Application／SQLite 规则。Yjs 只合并文档状态，不自动接受法律意见或覆盖经律师确认的正式版本。

触发方式：在 [DEV-1553](https://linear.app/logixy-ai/issue/DEV-1553) 的本地工作范围内，首个富文本用户结果经律师确认后，新建一项最小 P1 开发 Issue 承接上述本地 Spike；历史 Issue 不自动进入现行开发队列。满足上述条件并完成最小本地 Spike 后，才为实际富文本用户路径创建 `packages/editor/` 与 `packages/crdt/`，引入所需的最小依赖集。候选包为 `@tiptap/react`、`@tiptap/pm`、`@tiptap/starter-kit`、`yjs` 及实际所需的协作扩展；具体包名与版本须在该 Issue 中核对，不能依据本规划直接安装。若 Spike 在隔离目录进行，结束后删除试验依赖或经验收后纳入正式锁文件。

## 云端协作的边界

DEV-1570 的末尾另列了 Hocuspocus、PostgreSQL ACK、双客户端、Snapshot 与 Redis 故障的“Spike B”。它与同一 Issue 开头的 P3 延期范围冲突。现行 v2.2 架构明确规定 P0 不搭建协作服务器；上述服务端验证由 [DEV-1574](https://linear.app/logixy-ai/issue/DEV-1574) 在 P3 准入后执行。本次没有安装 Hocuspocus、PostgreSQL、Redis 或云 Provider，也没有声称服务端合同已通过。首次本地富文本切片须完成上述本地恢复验证；它不能以 P3 任务延期为由改用 HTML／JSON 作为权威正文。

## 验证、风险与回退

- 依赖证据：检查所有 workspace 的 `package.json` 与 `pnpm-lock.yaml`，精确查找候选包；无匹配代表当前锁文件未引入，不代表未来版本兼容。
- 工程回归：运行 `pnpm check:quick` 与 `git diff --check`；本次无运行时代码、依赖、数据库迁移或打包配置改动，故不以现有 PDF／SQLite 测试冒充 Yjs 测试。
- 主要风险：若后续设计把富文本加入首片，此延期结论立即失效；该 Issue 必须先冻结编辑体验、数据权威和恢复测试，再安装依赖。首次 Yjs 持久化格式一旦形成，应另做迁移与备份演练。
- 回退：本次仅修改文档，可撤销本记录及 ADR-003 的准入摘要；没有用户数据或数据库迁移需要回滚。未来本地 Spike 若失败，应保留原 Update／Snapshot，并移除未获准入的试验依赖。

本记录不表示首个 Matter 功能、富文本、协作或法律结果已完成；业务体验仍由律师在对应切片验收。
