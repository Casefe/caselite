# 设置中心与模型服务配置

用户本轮明确：OpenAI / gpt-4.1-mini 的 Key 设置迁入设置；增加系统设置、账户管理、外观、模型、个性化；模型设置参考 WorkBuddy，包括 DeepSeek、MinerU OCR、元典。

基线 d8306f1。模型表单归 DEV-1736，设置导航由 DEV-1746 消费，真实凭据能力仍归 DEV-1648。本轮修改渲染层及合成演示检查，不改变 Agent/IPC/SQLite/凭据协议，不新增依赖或网络请求。

## 采用与边界

- [WorkBuddy 模型配置](https://www.workbuddy.ai/docs/zh/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Model-Configuration)：采用设置内服务列表与详情表单、明确保存/验证区分、删除确认；不照搬明文配置文件。
- OpenAI：已有真实能力迁移到设置。profile 只读状态；configure/clear_key 复用受控宿主入口及 safeStorage，输入提交后清空，永不读取秘密回填。保存失败不得显示已保存；失败后可以重新读取状态。设置不自动检测网络或产生费用。
- [DeepSeek](https://api-docs.deepseek.com/)：对话模型配置预览，当前运行适配未接入，禁用凭据采集及保存。
- [MinerU OCR](https://mineru.net/apiManage/docs)：文档解析服务配置预览，不放入对话模型选择。后续真实文件上传必须另验选择范围与确认。
- [元典](https://github.com/yuandian-ailaw/yuandian-mcp-server)：按元典开放平台法律数据服务设计；预览 API 入口，不把 MCP 工具假装成聊天模型。后续按受控互联入口接入，不安装或自动运行外部 MCP。

后三项均明确待接入，表单不收集、保存或外发密钥；只提供真实可点击的服务选择与配置位置。保留 OpenAI 现有可用服务，用户未要求删除它。

系统/账户/外观/个性化展示当前能力与后续入口：本地功能无需登录、同步账号待开放、当前浅色三栏紧凑主题、人工确认与会话收藏。没有未实现的“保存成功”按钮，没有新增账户或偏好存储。

## 导航与检查

对话区显示当前模型状态及模型设置入口；设置下的模型页唯一承接密码表单。已有 Task 未保存时继续禁止离开；从 Task 打开设置后可返回同一个已保存正文。

验证：设置单元测试覆盖密码清空、失败回执、重新读取、删除取消/确认、待接入服务不可写入；既有 Agent 生命周期测试保留。实际 Electron 合成演示验证导航、各分区、safeStorage 密文与重新实例化读取、删除/取消、返回正文，并保留原创建/保存/SIGKILL重开断言。真实模型鉴权、云OCR与元典查询不在本轮验收内。

回退仅反向应用本次 UI/演示代码变更，无数据迁移。
