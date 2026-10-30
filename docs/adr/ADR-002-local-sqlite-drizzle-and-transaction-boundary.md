# ADR-002｜本地 SQLite、Drizzle、Repository 与事务边界

- 状态：提议；等待 DEV-1567 的原生模块、迁移与打包验证
- 日期：2026-10-30
- Linear Issue：[DEV-1558](https://linear.app/logixy-ai/issue/DEV-1558)、[DEV-1567](https://linear.app/logixy-ai/issue/DEV-1567)
- 影响模块：未来 `packages/application`、`packages/domain`、`packages/local-db`
- 代码位置与提交：尚未实现；当前锁文件未安装 Drizzle 或 SQLite driver

## 背景与问题

CaseLite 需要离线优先的本地工作来源，但 renderer 不能持有数据库连接，也不能把数据库 API 变成业务 API。Drizzle 官方支持 `better-sqlite3` 等 SQLite driver，但 Electron ABI、迁移、关闭重启和打包产物都必须实际验证。

## 必须满足的不变量

- Application 定义 Port；`local-db` 实现 Repository、迁移、事务与未来本地 Outbox。
- 业务写入与必要 Outbox 在同一 SQLite 事务中；不由 renderer 或同步客户端写库。
- 数据库路径、SQL 和原生模块错误不跨 IPC 返回。

## 候选方案

| 方案 | 结论 | 原因/证据 |
| --- | --- | --- |
| SQLite + Drizzle + `better-sqlite3`，仅在 main/受控 utility 侧访问 | 提议 | 现行架构方向；[Drizzle SQLite 文档](https://orm.drizzle.team/docs/sqlite/get-started-sqlite)列出该 driver 支持。 |
| renderer 直接使用 WASM/浏览器数据库 | 放弃 | 会建立与桌面权威存储平行的事实来源。 |
| 立即使用云端数据库 | 放弃 | 不满足 P1 本地优先及 P3 延期准入。 |

## 验证与交付

- DEV-1567 必须验证：Electron ABI 重建、重复迁移、受控读写、异常恢复、package 后加载和关闭重启。
- DEV-1566 才验证 SQLite 与 PDF 的离线咬合；本 ADR 不把该结果提前写成通过。
- 回退：在迁移前保留一致性备份；失败时停止升级并恢复到已验证 schema，不静默降级或删除用户数据。

## 后果与重新评估条件

任何第二 ORM、远程 SQLite 变体、加密/同步 driver 或迁移格式改变均需新 ADR。若 `better-sqlite3` 的 Electron 打包验证失败，先记录可复现失败再比较替代 driver，不同时保留两套运行时。
