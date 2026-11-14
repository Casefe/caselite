# ADR-009｜DeepSeek与OpenAI显式选择

日期2026-11-05；用户明确授权，主责任DEV-1648。基线09fb51c。本修订覆盖ADR-008的固定OpenAI限制，其余单运行/不自动重试/不读取环境凭据/无工具边界保持。

使用既有pi-ai 1.5.0（MIT）公开deepseekProvider，无依赖升级、不复制上游源码。允许模型仅gpt-4.1-mini、deepseek-flash、deepseek-v4-pro；服务商及HTTPS地址由受信目录确定，不允许Renderer提交任意endpoint或fallback。

凭据按服务商存于各自safeStorage密文文件，保留原openai-credential.enc路径，新增deepseek-credential.enc。默认模型单独以agent-model.json保存非秘密枚举，先原子替换落盘才确认；文件损坏明确失败，不悄悄选择另一服务。默认模型缺失沿用OpenAI；删除Key不自动切模型。选择默认模型必须已有对应凭据。

发送预览冻结模型；start命令携带模型并校验与当前默认一致，过期预览拒绝且不派发。已接受Run将模型/Provider固定在记录中，同一run_id用不同模型重放判冲突；旧v1调用不传模型只按旧固定OpenAI解释。运行中拒绝凭据/默认模型修改。查询只返回两家配置状态和非秘密模型，错误不反射上游或Key。

验证：合同的模型/凭据隔离、默认切换/幂等/配置并发；真实Pi Provider的合成HTTP流、401/429/连接失败/取消/超时；真实Electron安全存储、重开、UI配置/发送及原正文回归。合成HTTP不代替官方鉴权；未提供真实Key时实际联网推理记NOT_RUN。

回退本次提交并重新打包；保留新增密文/默认文件（旧版不读取），不删除用户数据。不引入OCR、工具、持久化对话或新计费平台。

## 2026-11-07 设置与新增服务商

本次用户授权扩展设置与模型目录，以 DEV-1746 为设置入口，沿 DEV-1648 的凭据和发送约定实施，基线 5415d37。新增 GLM（glm-4.7-flash）、Kimi（kimi-k2.6）及硅基流动（deepseek-ai/DeepSeek-V4-Flash）。各自使用固定 HTTPS 地址和独立加密凭据文件。三款初始接入按文本模型处理，材料仍按原有选择范围与本机文本提取规则预览。用户显式选择后才可切换模型。

复用已安装的 Pi Chat Completions 接口。配置不触发请求，运行沿既有单派发、2048 输出上限、零重试和禁用工具规则。用合成 HTTP 检查固定路由、鉴权头、发送体和流式结果。真实鉴权及服务质量待使用对应有效 Key 验证。

回退时保留新版工作区及原密文。旧包无法解析新增模型的运行记录。若已将新增模型设为默认或已生成新增模型记录，旧包仅用升级前的工作区副本，完整历史继续由新版读取。

## 2026-11-14 DEV-1862｜统一最后 HTTP 派发边界

在唯一 Pi Runtime 内为现有五家 Provider 注入同一个宿主 transport。安装版 Pi 的公开 `fetch` 选项由 Responses 与 Chat Completions 适配器传入 HTTP client；沿现有 `maxRetries: 0`，不新增 Runtime、依赖或备用服务。

可信目录固定 Provider 的 HTTPS base URL 和完整 endpoint：OpenAI 仅 `/v1/responses`，其余服务仅各自既有 `/chat/completions`。Pi 选中模型的 ID、Provider 和 base URL 必须与本次输入一致；发送前再次核验完整 URL 和 POST，拒绝其他 host、port、path、query、fragment、用户信息。每个 Run 只有一次底层 HTTP 尝试，失败也不恢复次数；强制 `redirect: 'error'`，并拒绝 3xx、已跟随重定向或最终 URL 不符的响应。未获准目标在正文和 Key 进入底层 fetch 前被拒绝。

transport 保留并合并原 Run、Request 和 SDK 请求的取消信号；已取消、已结束或迟到的请求/响应不能继续派发或返回成功。原 Application 输入范围、凭据端口、Run 身份、预算与未知费用状态保持。合成 transport 测试只证明本地拒绝和安装 SDK 接线；真实 Provider/Key/网络调用为 0，产品接合、完整门禁和独立复核须另留证，不能据本决定宣称上线。

URL 等非 Request 输入只做一次字符串转换，校验与发送使用同一原生字符串；Request 输入先建立原生 Request 快照，校验快照 URL/方法并发送同一快照。SDK init 同步复制一次并固定取消信号与 redirect，防止可变 URL 的二次转换或覆写 Request.url getter 在校验后偷换目标；正文和鉴权保留在本次请求中，不为校验预先消费正文。

回退只撤本次 runtime/transport 接线和新增测试；不迁移或删除原 Run、正文、原件及凭据。
