# 设置中心与模型服务配置

用户本轮明确：OpenAI / gpt-4.1-mini 的 Key 设置迁入设置；增加系统设置、账户管理、外观、模型、个性化；模型设置参考 WorkBuddy，包括 DeepSeek、MinerU OCR、元典。

基线 d8306f1。模型表单归 DEV-1736，设置导航由 DEV-1746 消费，真实凭据能力仍归 DEV-1648。后续用户于 2026-11-05 明确授权 DeepSeek 实际接入（基线09fb51c），当前执行范围已扩展至 Agent/IPC 与凭据适配器，详见 [ADR-009](../adr/ADR-009-provider-model-selection.md)。SQLite 与既有正文保存不变，无新增依赖。

## 采用与边界

- [WorkBuddy 模型配置](https://www.workbuddy.ai/docs/zh/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Model-Configuration)：采用设置内服务列表与详情表单、明确保存/验证区分、删除确认；不照搬明文配置文件。
- OpenAI：已有真实能力迁移到设置。profile 只读状态；configure/clear_key 复用受控宿主入口及 safeStorage，输入提交后清空，永不读取秘密回填。保存失败不得显示已保存；失败后可以重新读取状态。设置不自动检测网络或产生费用。
- [DeepSeek](https://api-docs.deepseek.com/)：复用 Pi AI 1.5.0 的 DeepSeek Provider；启用独立 Key、deepseek-flash / deepseek-v4-pro 选择与“设为默认模型”。Key 以系统 safeStorage 加密；保存不自动发请求，默认选择持久化且用于下一次明确发送。
- [MinerU OCR](https://mineru.net/apiManage/docs)：文档解析服务配置预览，不放入对话模型选择。后续真实文件上传必须另验选择范围与确认。
- [元典](https://github.com/yuandian-ailaw/yuandian-mcp-server)：按元典开放平台法律数据服务设计；预览 API 入口，不把 MCP 工具假装成聊天模型。后续按受控互联入口接入，不安装或自动运行外部 MCP。

MinerU OCR 与元典两项仍待接入，表单不收集、保存或外发密钥；只提供真实可点击的服务选择与配置位置。保留 OpenAI 现有可用服务，用户未要求删除它。

系统/账户/外观/个性化展示当前能力与后续入口：本地功能无需登录、同步账号待开放、当前浅色三栏紧凑主题、人工确认与会话收藏。没有未实现的“保存成功”按钮，没有新增账户或偏好存储。

## 导航与检查

对话区显示当前模型状态及模型设置入口；设置下的模型页唯一承接密码表单。已有 Task 未保存时继续禁止离开；从 Task 打开设置后可返回同一个已保存正文。

验证：设置单元测试覆盖密码清空、失败回执、重新读取、删除取消/确认、待接入服务不可写入；既有 Agent 生命周期测试保留。实际 Electron 合成演示验证导航、各分区、safeStorage 密文与重新实例化读取、删除/取消、返回正文，并保留原创建/保存/SIGKILL重开断言。DeepSeek 的实际 SDK 请求/流解析及失败路径使用合成 HTTP 验证；原生演示使用合成响应并明确标记。真实模型鉴权与生成仍需用户真实 Key 验证；云OCR与元典查询未接入。

回退遵循 ADR-009；保留凭据及默认模型文件，不删除用户数据。
