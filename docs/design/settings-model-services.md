# 设置中心与模型服务配置

DEV-1746（2026-11-07）把设置重组为工作区、外观、AI 与服务、数据与隐私、账户与协作。依据是 [同类产品与现行功能配置盘点](https://linear.app/logixy-ai/document/caselite设置同类产品与现行功能配置盘点-f25817e47e73)。

基线 d8306f1。模型表单归 DEV-1736，设置导航由 DEV-1746 消费，真实凭据能力仍归 DEV-1648。后续用户于 2026-11-05 明确授权 DeepSeek 实际接入（基线09fb51c），当前执行范围已扩展至 Agent/IPC 与凭据适配器，详见 [ADR-009](../adr/ADR-009-provider-model-selection.md)。SQLite 与既有正文保存不变，无新增依赖。

## 采用与边界

- [WorkBuddy 模型配置](https://www.workbuddy.ai/docs/zh/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Model-Configuration)：采用设置内服务列表与详情表单、明确保存/验证区分、删除确认；不照搬明文配置文件。
- OpenAI：已有真实能力迁移到设置。profile 只读状态；configure/clear_key 复用受控宿主入口及 safeStorage，输入提交后清空，永不读取秘密回填。保存失败不得显示已保存；失败后可以重新读取状态。设置不自动检测网络或产生费用。
- [DeepSeek](https://api-docs.deepseek.com/)：复用 Pi AI 1.5.0 的 DeepSeek Provider；启用独立 Key、deepseek-flash / deepseek-v4-pro 选择与“设为默认模型”。Key 以系统 safeStorage 加密；保存不自动发请求，默认选择持久化且用于下一次明确发送。
- [MinerU OCR](https://mineru.net/apiManage/docs)：文档解析服务配置预览，不放入对话模型选择。后续真实文件上传必须另验选择范围与确认。
- [元典](https://github.com/yuandian-ailaw/yuandian-mcp-server)：按元典开放平台法律数据服务设计；预览 API 入口，不把 MCP 工具假装成聊天模型。后续按受控互联入口接入，不安装或自动运行外部 MCP。

MinerU OCR 与元典两项仍待接入，表单不收集、保存或外发密钥；只提供真实可点击的服务选择与配置位置。保留 OpenAI 现有可用服务，用户未要求删除它。

| 分区 | 用户动作与责任归属 |
| --- | --- |
| 工作区 | 查看任务提醒与财务入口。提醒在任务和 Inbox 管理，财务页当前显示空态。 |
| 外观 | 唯一主题控制通过现有 appearance 入口读取或保存本机主题。 |
| AI 与服务 | 通过既有 agent 入口读取、刷新、保存、删除本机模型凭据或切换默认模型。写作偏好仍待开放。 |
| 数据与隐私 | 查看本机保存、显式发送和人工确认写回说明。备份与隔离恢复待接入。 |
| 账户与协作 | 查看免登录说明。跨设备同步和团队协作待开放。 |

## 导航与检查

对话区已有的模型设置捷径指向「AI 与服务」。未保存的 Task 继续阻止离开。返回时通过原任务读取入口恢复任务选项卡和来源，文档打开的工作稿仍回到文档审阅界面。

验证：设置单元测试覆盖密码清空、失败回执、重新读取、删除取消/确认、待接入服务不可写入；既有 Agent 生命周期测试保留。实际 Electron 合成演示验证导航、各分区、safeStorage 密文与重新实例化读取、删除/取消、返回正文，并保留原创建/保存/SIGKILL重开断言。DeepSeek 的实际 SDK 请求/流解析及失败路径使用合成 HTTP 验证；原生演示使用合成响应并明确标记。真实模型鉴权与生成仍需用户真实 Key 验证；云OCR与元典查询未接入。

本次导航可通过回退 DEV-1746 的本地提交恢复。主题、密钥、模型和文档修订沿各自现有存储保留。
