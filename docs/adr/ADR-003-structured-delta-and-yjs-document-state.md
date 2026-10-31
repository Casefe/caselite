# ADR-003｜结构化 Delta 与 Yjs 文档状态双通道

- 状态：架构方向已确认；本地/云端实现均待后续 Issue 验证
- 日期：2026-10-30
- Linear Issue：[DEV-1558](https://linear.app/logixy-ai/issue/DEV-1558)、[DEV-1570](https://linear.app/logixy-ai/issue/DEV-1570)
- 影响模块：未来 `application`、`local-db`、`editor`、`crdt`、`sync-client`、`apps/server`
- 代码位置与提交：尚未实现；本仓库未安装 Yjs 或同步服务

## 背景与问题

案件、任务、权限和附件元数据需要事务、版本与审计；富文本正文需要可合并的文档状态。两类数据不能被一个“万能同步层”混为同一种权威来源。

## 必须满足的不变量

- 结构化对象未来使用 SQLite Outbox、`mutation_id`、Delta/Snapshot；P3 共享后由 PostgreSQL 接纳。
- 富文本的权威是 Yjs 二进制 Update/Snapshot，不由 HTML/JSON 重建。
- Yjs 不替代法律审核、业务对象事务或权限判断；Redis 不成为业务/Yjs 持久化数据源。

## 候选方案

| 方案 | 结论 | 原因/证据 |
| --- | --- | --- |
| 结构化 Delta 与 Yjs 文档状态分开 | 采用为架构方向 | 与现行 v2.2 Resource 一致；[Yjs 文档](https://docs.yjs.dev/)说明其 CRDT 与网络层分离。 |
| 所有业务对象都使用 CRDT | 放弃 | 不利于事务、权限、审计与确定性状态机。 |
| 将 Yjs Update 只放入 Redis 或只保存 HTML | 放弃 | 不满足持久化与可恢复性要求。 |

## 验证与交付

- DEV-1570 的 [准入结论](../architecture/DEV-1570-editor-admission.md)：首个 Matter＋PDF 锚点切片没有富文本编辑，延后安装 Tiptap/Yjs；首个真实富文本切片必须验证本地 Y.Doc 二进制持久化、重启恢复和迁移。
- P3 再验证持久化 ACK、update 幂等、Snapshot、Redis 丢失与权限撤销。
- 回退：保留原 Update 与 Snapshot；压缩或迁移失败不得删除最后可恢复状态。

## 后果与重新评估条件

增加新的同步平面、改变业务/文档权威、引入协作服务或调整 Delta 协议版本时，必须先有 ADR、Spike、迁移与恢复演练。
