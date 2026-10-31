# DEV-1566｜桌面离线集成回归

- 范围：同一个 macOS Apple Silicon 打包应用、固定合成 PDF、固定合成 SQLite 记录。无真实案件资料、服务器、OCR、Matter/Anchor 产品写入。
- 输入：DEV-1567 SQLite/Drizzle 打包结果、DEV-1568 PDF Worker/阅读页、DEV-1578 类型化 IPC、DEV-1570 编辑器延期结论。
- 开发分支：`dev-1566-offline-integration`；准确提交以 PR 为准。

## 路径和权威

打包应用中的 Chromium renderer 阅读仓库内置 PDF；同一 renderer 只通过 `window.caselite.offlineProbe` 的固定方法向 preload 发起请求。main 检查 sender、协议版本与严格 Zod DTO，再调用 Application 的测试用例；Application 经注入 Port 写入 `toolchain_probe`。此表是 DEV-1567 的基础设施样本，不是正式 Matter 表。正式 `createMatter` / `createAnchor` 仍为 `not-persisted` Spike。

`offlineProbe` 的 IPC handler **仅当** `CASELITE_INTEGRATION_PHASE=write|read` 的打包测试进程启动时注册。它只接受固定 ID `dev-1566-synthetic` 和固定值 `offline-integration-verified`，无任意路径、SQL 或通用 IPC 能力。测试根目录由脚本在系统临时目录建立，main 校验真实路径及目录名前缀；数据库位于其下的 `中文 路径/probe.sqlite`。正常应用进程没有测试 handler。实验结束后脚本删除整个临时目录。

## 执行与证据

从仓库根目录：

1. `pnpm install --frozen-lockfile`、`pnpm test:full`；`test:full` 会先运行 G0、审计、集成测试和打包，再运行 `pnpm test:packaged-integration`。
2. 若只重跑桌面回归，先 `pnpm package`，再 `pnpm test:packaged-integration`。该命令在用户登录的 macOS 图形会话中执行；无图形权限的自动化容器可能以 `SIGABRT` 退出，这不是成功证据。
3. 脚本在同一包内执行五次进程：写入、关闭/重启读回、从带中文和空格的副本再读回，然后在该副本中分别模拟 PDF Worker 缺失与版本不匹配。版本不匹配样本在打包时从同版本 PDF.js Worker 复制并仅改写其内部版本号，正常 Worker 不变。正常阶段验证本地 PDF Worker、文字层及画布，并在双页合成样本中翻到第 2 页，选取文字，确认页内 `BETA-002` 不会混入第 1 页的 `ALPHA-001`；同时检查错误 DTO、损坏 PDF、缺失 PDF 后记录仍可读。故障阶段要求显示错误且已写入的 SQLite 记录不变。加载失败时 PDF 测试画面显示可见错误，样本选择框保留，并能直接切回正常 PDF；桌面外壳另有最后一道错误边界。迁移计数必须一直为 1。
4. `artifacts/evidence/dev-1566-packaged-integration.json` 记录各阶段、平台、Node 与依赖版本、锁文件 SHA-256、失败阶段和临时目录清理结果；该文件不提交到公开仓库。GitHub Linux CI 只执行无图形的代码与集成测试，不能替代本机打包态结果。

## 已覆盖与剩余边界

已有独立 SQLite 测试覆盖事务回滚、失败迁移与不可写目录。集成测试覆盖受信任/不受信任 IPC、非法 DTO、重开数据和数据库 Port 失败时的安全错误。桌面打包测试覆盖同一进程中的 PDF 与 IPC/SQLite、断开 HTTP(S) 访问、两次重启、PDF 损坏/缺失及中文/空格路径。需要将每次真实命令结果写回 Linear，不因脚本存在就称已通过。

尚须单列：物理断网的人工冷启动；签名/公证/安装器；真正的 Matter、SourceVersion 与 Anchor；大文件、OCR、多人协作和正式权限。Playwright Electron 自动化仍受安全 Fuse 限制，不为此放宽 Fuse。若某项未测，将 DEV-1566 保持待验收，并在首片合同中列明阻塞或转交对应 Issue。

回退：撤销本次分支可移除测试专用合同、Port、runner 与文档；没有产品数据库迁移。临时测试目录由 runner 清理，若异常中断可根据 `caselite-integration-` 前缀人工确认后删除；不要对用户目录执行清理脚本。
