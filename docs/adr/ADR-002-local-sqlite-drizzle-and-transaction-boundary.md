# ADR-002｜本地 SQLite、Drizzle、Repository 与事务边界

- 状态：工具链探针已验证；正式领域存储、生产备份和 ADR 设计验收待后续 Issue
- 日期：2026-10-30
- Linear Issue：[DEV-1558](https://linear.app/logixy-ai/issue/DEV-1558)、[DEV-1567](https://linear.app/logixy-ai/issue/DEV-1567)
- 影响模块：未来 `packages/application`、`packages/domain`、`packages/local-db`
- 代码位置：`packages/local-db` 的基础设施探针、`apps/desktop` 的打包配置；尚未建立正式业务 Repository

## 背景与问题

CaseLite 需要离线优先的本地工作来源，但 renderer 不能持有数据库连接，也不能把数据库 API 变成业务 API。Drizzle 官方支持 `better-sqlite3` 等 SQLite driver，但 Electron 原生模块兼容性、迁移、关闭重启和打包产物都必须实际验证。

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

## DEV-1567 工具链探针与实际验证（2026-10-31）

- 环境：macOS Apple Silicon `arm64`、Node `24.22.2`、pnpm `11.0.9`、Electron `45.1.0`。
- 锁定版本：`better-sqlite3@13.0.3`、`drizzle-orm@0.45.4`、`drizzle-kit@0.31.10`、`@types/better-sqlite3@9.6.0`、`@electron-forge/plugin-auto-unpack-natives@8.0.1`。`better-sqlite3` 与 `node-addon-api` 为 MIT，`drizzle-orm` 为 Apache-2.0；详见本地生成的 `artifacts/licenses/production-dependencies.json`。
- 此版本的 `better-sqlite3` 随包提供 `prebuilds/darwin-arm64.node`。本探针不声称发生了源码重编译；验证的是 Electron 45 实际装载该原生文件。桌面 Webpack 针对当前固定的 macOS arm64 打包目标选择 `better-sqlite3/darwin-arm64`，并由 Forge 原生模块插件将文件放入 `app.asar.unpacked/.webpack/main/native_modules/prebuilds/`。改为其他平台/架构前必须更新此选择并重做打包测试。
- 迁移源目录：`packages/local-db/migrations/`；打包位置：`CaseLite.app/Contents/Resources/migrations/`。仅有 `toolchain_probe` 表；没有案件或资料的正式 schema。
- P0 探针数据库：系统临时目录中的随机子目录，测试结束删除。正式数据库路径尚未选择或创建；后续实现须使用受控的用户数据目录，并在启用真实资料前确定备份、恢复、权限和升级流程。
- 已通过：`pnpm install`、`pnpm --filter @caselite/local-db migration:generate`、`pnpm test:integration`（4 项：提交/回滚/重开/重复迁移、失败迁移恢复、锁定、目录不可写）、`pnpm check:quick`、`pnpm package`。用户终端执行 `pnpm test:packaged-db` 通过，证明打包版创建、写入、关闭重开并读回合成数据。用户终端执行 `CASELITE_DB_PROBE=1 pnpm dev` 后 Forge 报告三部分编译通过、App 以代码 0 退出；探针失败分支会以代码 1 退出。探针只输出固定成功/失败提示，不输出数据库路径或内容。
- 依赖审计：编码环境因 npm 域名解析失败未取得结果；用户终端随后运行 `pnpm audit --prod --audit-level=high`，输出 `No known vulnerabilities found`。这只证明该次审计结果，不保证未来依赖不会出现新漏洞。

正式业务存储升级规则：先停止写入并生成一致性备份，核验备份可读，再执行只前进的版本化迁移；迁移失败时停止启动并保留原文件与备份，人工核对后恢复，不删除失败记录来伪装成功。备份实现及恢复演练不在 P0 探针范围内。

探针回退或替换方式：删除本次新增的 `packages/local-db` 和临时桌面探针代码，撤销对应依赖、Webpack 原生模块加载器及 Forge 打包配置，然后恢复此前锁文件；所有探针数据库均在系统临时目录，不涉及真实法律资料。未来更换驱动需先建立新 ADR、验证迁移兼容性与数据恢复，不能直接删除正式数据库。

## 验证与交付

- DEV-1567 必须验证：Electron ABI 重建、重复迁移、受控读写、异常恢复、package 后加载和关闭重启。
- DEV-1566 才验证 SQLite 与 PDF 的离线咬合；本 ADR 不把该结果提前写成通过。
- 回退：在迁移前保留一致性备份；失败时停止升级并恢复到已验证 schema，不静默降级或删除用户数据。

## 后果与重新评估条件

任何第二 ORM、远程 SQLite 变体、加密/同步 driver 或迁移格式改变均需新 ADR。若 `better-sqlite3` 的 Electron 打包验证失败，先记录可复现失败再比较替代 driver，不同时保留两套运行时。
