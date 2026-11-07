# ADR-009｜DeepSeek与OpenAI显式选择

日期2026-11-05；用户明确授权，主责任DEV-1648。基线09fb51c。本修订覆盖ADR-008的固定OpenAI限制，其余单运行/不自动重试/不读取环境凭据/无工具边界保持。

使用既有pi-ai 1.5.0（MIT）公开deepseekProvider，无依赖升级、不复制上游源码。允许模型仅gpt-4.1-mini、deepseek-flash、deepseek-v4-pro；服务商及HTTPS地址由受信目录确定，不允许Renderer提交任意endpoint或fallback。

凭据按服务商存于各自safeStorage密文文件，保留原openai-credential.enc路径，新增deepseek-credential.enc。默认模型单独以agent-model.json保存非秘密枚举，先原子替换落盘才确认；文件损坏明确失败，不悄悄选择另一服务。默认模型缺失沿用OpenAI；删除Key不自动切模型。选择默认模型必须已有对应凭据。

发送预览冻结模型；start命令携带模型并校验与当前默认一致，过期预览拒绝且不派发。已接受Run将模型/Provider固定在记录中，同一run_id用不同模型重放判冲突；旧v1调用不传模型只按旧固定OpenAI解释。运行中拒绝凭据/默认模型修改。查询只返回两家配置状态和非秘密模型，错误不反射上游或Key。

验证：合同的模型/凭据隔离、默认切换/幂等/配置并发；真实Pi Provider的合成HTTP流、401/429/连接失败/取消/超时；真实Electron安全存储、重开、UI配置/发送及原正文回归。合成HTTP不代替官方鉴权；未提供真实Key时实际联网推理记NOT_RUN。

回退本次提交并重新打包；保留新增密文/默认文件（旧版不读取），不删除用户数据。不引入OCR、工具、持久化对话或新计费平台。
