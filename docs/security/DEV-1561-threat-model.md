# DEV-1561｜P0 Electron、密钥与法律数据安全基线

- **状态**：P0 实施记录；不是生产级安全审计或合规认证。
- **范围**：本地 Electron 工程骨架、公开仓库和合成测试资料。
- **不含**：真实客户资料、Provider 调用、MCP、云端身份、共享协作或正式密钥托管。

## 已实施的最小控制

| 风险 | 当前控制 | 可执行证据 | 残余风险 |
| --- | --- | --- | --- |
| 不可信页面获得 Node 权限 | `contextIsolation`、`sandbox`、关闭 `nodeIntegration`、关闭 webview | `pnpm security:electron` | 图形进程启动后仍须在支持的 macOS/Electron 组合上做端到端验收 |
| 页面跳转、弹窗、权限与下载扩大边界 | 默认拒绝新窗口、导航、重定向、权限与下载 | `pnpm security:electron` | 当前没有安全外链/下载用户功能；新增前必须另行设计与测试 |
| Renderer 绕过业务入口 | 固定 preload API、IPC 发送者/协议/Zod 校验、架构门禁 | `pnpm architecture:check`、IPC 合同测试 | 当前 Application 是不持久化 Spike，尚无真实对象级授权 |
| 包被环境变量或调试参数改变行为 | Forge Fuses 关闭 RunAsNode、Node options 和 inspect 参数 | `pnpm security:electron`、`pnpm package` | 需在每次 Electron 升级后复验 Fuses |
| 真实凭据误提交公开仓库 | `.env` 拦截、基础凭据模式检查、Secretlint 推荐规则集及假密钥自检 | `pnpm security:baseline` | 扫描不能证明历史记录、外部系统或人工复制渠道没有泄露 |
| 错误/日志泄露路径、正文或凭据 | P0 产品代码禁止直接 `console` 输出；面向用户的启动错误不含路径/堆栈 | `pnpm security:logs` | 未来引入受控日志器时，必须做字段白名单、脱敏与测试 |

秘密扫描采用项目内开发依赖 `secretlint@13.0.5` 与 `@secretlint/secretlint-rule-preset-recommend@13.0.7`，均锁入 pnpm 锁文件，不依赖编辑器插件或全局安装；官方发布信息标明其为 MIT。扫描器只读取本地工作区与系统临时目录中的**运行时生成假令牌**，不上传文件内容。

## 凭据与外发边界

P0 没有 BYOK 输入、Provider SDK、OCR、MCP 或网络资料上传功能；CSP 的 `connect-src 'none'` 因而是正确的默认值。当前不能声称“已安全保存密钥”，因为没有任何密钥保存功能。

当 P2 首个 Provider 获批时，必须先实施一个 `CredentialStore` Port：生产适配只可通过 Electron `safeStorage` 加密后写入受控系统位置；测试替身只在内存中存在，且不得回显密钥。凭据不得写入 SQLite、日志、备份、同步、提示词记录、测试样本或仓库。该工作不在 DEV-1561 中提前实现，以免制造无用户入口的空功能。

任何资料外发前，界面/合同必须显示：发送资料的来源和范围、目标 Provider、费用或预算、取消方式、成功/失败/未知提交状态。没有这项确认，任何外发默认拒绝。文档、网页、模型和未来 MCP 返回均是**不可信输入**，不得因此获得文件、数据库、网络或正式法律交付权限。

## 恶意输入与恢复

- 伪造 IPC、非法协议版本、畸形请求：返回结构化安全错误；不得执行文件、SQL、命令或任意 URL。
- 恶意网页/外链/PDF：当前禁止页面导航、弹窗、远程连接、下载和 webview；需要业务支持时另立 Issue，先定义允许清单和失败路径。
- 发现真实资料或凭据：停止提交与推送；撤销相关凭据；按平台的秘密清除流程处理历史；不要把秘密复制到 Issue、聊天、日志或截图。
- 安全检查失败：修复后重跑同一命令；生成物可用 `pnpm clean` 删除；本分支可在合并前删除或使用 Git 回退。

## 后续门槛

P1 SQLite/PDF、P2 Provider、P3 云端共享和 P4 MCP 均必须延续这些边界。尤其 P3 需要用两名用户、两个工作区与撤权后的旧客户端验证隔离；这不是本 P0 文档可以替代的测试。
