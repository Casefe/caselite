# Application、Command／Query／Event 与 IPC 合同 v1

- 状态：DEV-1578 可执行 Spike，正在复验；不表示 Matter、Anchor 的真实持久化或权限系统已经交付。
- 代码位置：packages/contracts、packages/application、apps/desktop/src/main/ipc、apps/desktop/src/preload。

## 当前两个 Command

| Command      | 请求最小字段                                                               | 成功结果                        | 真实持久化        |
| ------------ | -------------------------------------------------------------------------- | ------------------------------- | ----------------- |
| CreateMatter | request/protocol/workspace/actor/device/idempotency/expected_version/title | Matter ID、版本、matter.created | 否；not-persisted |
| CreateAnchor | 上述信封 + matter/source version/page/quote                                | Anchor ID、版本、anchor.created | 否；not-persisted |

protocol_version 固定为 1。未知版本返回 PROTOCOL_UNSUPPORTED；不能静默采用新语义。出现不兼容字段或语义时，必须新建协议版本和明确迁移/拒绝规则；v1 不猜测或接受未来版本。

页面坐标没有出现在 CreateAnchor v1：DEV-1560 明确禁止在 PDF 阅读器未实际定位前伪造坐标。当前只接受页码和原文片段；PDF.js 定位、坐标和持久化由 DEV-1568/P1 切片补充。

## 调用与安全顺序

    renderer
      → window.caselite.createMatter/createAnchor
      → preload 固定通道
      → main sender + Zod 校验
      → Application 授权、版本、幂等处理
      → 结构化结果/领域事件

renderer 不取得 ipcRenderer、数据库、文件、路径、SQL 或通用通道。preload 公开上述两项业务动作，以及 DEV-1566 固定合成数据用的 `offlineProbe`；后者仅在打包集成测试进程中注册 handler，正常应用进程没有对应 handler。main 拒绝非受信任页面，测试请求还必须满足严格 Zod 合同。测试入口不表示 Matter 或 Anchor 已持久化。

当前 composition root 的授权器恒定允许，只能用于此无持久化 Spike；它不是身份或权限实现。每次重试先重新授权，再比较原命令的操作、身份、作用域和业务数据；同一幂等编号用于不同内容时返回 CONFLICT。内存中的幂等记录随进程退出消失，不构成跨重启保证。真实对象级授权、SQLite/Outbox 的同事务写入仍属 P1 实施范围。

## 追踪矩阵与后续入口

| 发起位置                       | 合同             | Application                   | 领域/Port                                       | 事件                  | 当前状态                       |
| ------------------------------ | ---------------- | ----------------------------- | ----------------------------------------------- | --------------------- | ------------------------------ |
| P1 renderer 的创建事项动作     | CreateMatter v1  | createMatter                  | Matter 规则与 MatterRepository（未来）          | matter.created        | 已验证到 Application；未持久化 |
| P1 PDF 阅读器的建立锚点动作    | CreateAnchor v1  | createAnchor                  | Anchor 规则与 SourceVersion/Anchor Port（未来） | anchor.created        | 已验证到 Application；未持久化 |
| P2 Work Runtime 的候选事项操作 | 未来独立 Command | 只能调用 Application          | 不得直连 SQLite/文件/Provider                   | 独立 WorkRun/领域事件 | 未实现，须先有获批用户结果     |
| P4 MCP/连接器的受控操作        | 未来独立外部合同 | 只能调用同一 Application 用例 | 不得直连 Repository/路径                        | 审计与领域事件分开    | 未实现，须先有获批连接器       |

这里的 future 不代表已预建目录、接口或能力；它只冻结“必须经过 Application”的边界。

## 错误与 UI 映射

| 错误                 | UI 结果                                                    | 恢复动作                                                            |
| -------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------- |
| INVALID_REQUEST      | 表单/请求失败，不显示底层细节                              | correct_input                                                       |
| PROTOCOL_UNSUPPORTED | 客户端版本不兼容                                           | upgrade_client                                                      |
| FORBIDDEN            | 无权操作                                                   | request_access                                                      |
| CONFLICT             | 版本冲突                                                   | refresh_and_retry                                                   |
| IPC_TIMEOUT          | 桌面调用超过 15 秒，操作结果未知；不能显示为保存失败或成功 | check_status；当前 Spike 尚无持久化状态查询，须人工核对，不自动重试 |
| INTERNAL             | 通用失败                                                   | contact_support                                                     |

main 捕获 Application 或结果校验抛出的异常，返回固定的 INTERNAL 文案与新生成的 correlation_id；底层 SQL、绝对路径、密钥、堆栈不穿过 IPC。preload 对两项固定业务命令设置 15 秒等待上限；超时只说明客户端没有及时收到结果，main 可能已经完成操作。preload 不自动重试、不更换原请求的幂等编号，也不把超时标成失败或成功。当前没有持久化状态查询和跨重启幂等保证，不能仅凭此错误安全地自动补发；首个真实存储切片必须设计状态核对和同一幂等编号的重放规则。拒绝的 IPC Promise 或不符合合同的响应由 preload 转为固定 INTERNAL，异常文本不进入 renderer。

Repository／Outbox 尚未接入正式 Matter／Anchor 命令。`tests/integration/ipc-transaction-failures.test.ts` 用真实 SQLite 事务和仅存在于测试中的合成 Outbox 表，分别触发 Repository 主键冲突和 Outbox 约束失败，检查业务写入回滚、Outbox 无残留、IPC 错误不泄漏 SQL。这证明 SQLite 原子回滚及 IPC 错误边界可行；**不证明正式业务表、持久化幂等、授权或故障恢复已完成**。这些须在 P1 的领域 Schema 和首个持久化切片中实现并重新验收。

UI 状态对应：发起命令时为 loading；编辑且未发出命令时为 dirty；`not-persisted` 必须显示为演练结果，不能显示为 local-saved；CONFLICT 显示冲突并提示刷新，FORBIDDEN 显示无权，INVALID_REQUEST 显示可纠正输入，INTERNAL 显示通用失败与 correlation_id。只有未来收到真实本地事务提交确认，才能显示 local-saved。

## 验证和回退

- tests/contracts/application-ipc-contracts.test.ts：Schema、幂等、权限和冲突；
- tests/contracts/ipc-spike.test.ts：固定 preload API、IPC channel、sender、协议、输入拒绝、15 秒超时、无自动重试及异常响应清理；
- tests/integration/ipc-transaction-failures.test.ts：测试专用 SQLite／Outbox 事务故障、回滚和结构化错误；
- pnpm architecture:check：阻断 renderer 导入 application/contracts/Node。
- `pnpm test:packaged-integration`：在打包 Electron 的真实 renderer → preload → main → Application 路径执行 CreateMatter、CreateAnchor、重复请求、旧协议和非法输入；独立证据由脚本记录。

安全的请求／响应摘要（仅合成标识与结果类型，不记录法律正文或路径）：

| 测试请求                                            | 预期响应                                     |
| --------------------------------------------------- | -------------------------------------------- |
| CreateMatter v1、CreateAnchor v1                    | `ok`、对应 `*.created` 事件、`not-persisted` |
| 两项命令用相同幂等编号重试                          | 原结果，不产生第二个内存结果                 |
| 同编号改换内容或命令                                | `CONFLICT`                                   |
| 旧协议、缺失或非法字段                              | `PROTOCOL_UNSUPPORTED`／`INVALID_REQUEST`    |
| 模拟底层异常                                        | `INTERNAL`，不回传异常文本                   |
| 真实 SQLite 测试事务中 Repository／合成 Outbox 失败 | `INTERNAL`，两表均无半成品，不回传 SQL       |
| 两项命令的 IPC 无响应超过 15 秒                     | `IPC_TIMEOUT`、结果未知、不自动重试          |

2026-10-31 在用户 Mac 终端运行 `pnpm test:full` 通过：格式、lint、架构、安全、类型、单元、合同、生产依赖审计、集成、打包与打包应用内的 PDF＋IPC＋SQLite 合成测试均通过；本地证据为 `artifacts/evidence/g0-full-2026-10-31T13-06-42.290Z.json`。Playwright Electron 自动化依照安全 Fuse 设置明确为 `NOT RUN`，不计为通过。本工具环境运行打包应用时出现 SIGABRT，因此以用户 Mac 的执行结果作为桌面验证依据。回退本次验收修复时撤销该分支提交；回退整个 Spike 时须一并移除两个 workspace 包、preload API 和 main 注册，不保留兼容性通道。
