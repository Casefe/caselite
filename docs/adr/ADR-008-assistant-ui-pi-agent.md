# ADR-008｜assistant-ui 与 Pi 单运行适配


## DEV-1788 文档审阅 UI 与确认写回｜2026-11-07

本卡限定「文档 → 打开正文」中的现有任务成果工作稿，基线 `fda568686d4e879bf62c48b4781031a0227f208d`。复用现有 assistant-ui 的适配代码更少，但无法满足本卡对 AI SDK UI 的明确要求。采用 `@ai-sdk/react@3.0.327` 的 `useChat` 和 `ai@6.0.324` 的 `ChatTransport`；两包为 Apache-2.0，使用仍发布维护修复的 v6，避免 v7 引入的 MCP 客户端依赖。现有首页、任务和项目继续使用 assistant-ui。两种 UI 共用原 AgentApplication、Pi、Key 和本机运行历史。无需第二服务、SDK 后端或生产网关。依赖树内含官方上游的 `@ai-sdk/gateway@3.0.230`，不启用其 Provider、OIDC、HTTP transport 或遥测。传递依赖 `json-schema@0.4.0` 选择其 BSD-3-Clause 授权，随包提供通知，准入限精确版本。随包通知一并提供新增依赖的 Apache-2.0 全文、上游版权及 MIT 通知。未复制第三方实现。维护成本限两处 UI 适配的回归和升级验证，保存、恢复和运行仍走同一实现；不增加网络服务或订阅成本。

现有 v1 Agent IPC 增加 `document:<UUID>` 范围和预览、拒绝、确认及只读回执查询操作。持久运行仍使用原表和作用域列。JSON 在旧版本可读的 UUID 下保留该记录；恢复时按该行实际范围解码。窗口内预览和提交回执绑定当前 Task、Document、Body、已保存修订、顶层段落内 UTF-16 坐标和原文。本机选区核对不派发。显式发送只携带选区及本轮问题，无自动重连或重新生成。写回只接受本窗口成功 Run 的单行替换文本，信任端重新定位并在原 Yjs 状态生成精确替换，通过 Task 原保存事务追加修订。未知回执只读核对同一私有提交键，缺回执后需另行人工重试确认。其余段落、原修订及 DEV-1655 接受另存新稿规则均沿用原合同。当前仅支持顶层段落内连续文字，嵌套列表、含硬换行的段落与跨段选择提示重选。

隔离演练使用两份合成工作稿、Pi 合成流和原 Electron/SQLite 路径。真实 Provider 调用需单独授权。回退本卡提交即回退 UI、协议扩展和锁版，工作稿及所有已保存修订继续可读，文档审阅历史在回退版隐藏并保留原记录。验证命令、实际通过范围和构建指纹见本卡同树外部证据。

来源：[AI SDK UI Transport](https://ai-sdk.dev/docs/ai-sdk-ui/transport)、[官方 npm @ai-sdk/react](https://www.npmjs.com/package/@ai-sdk/react/v/3.0.327)、[官方 npm ai](https://www.npmjs.com/package/ai/v/6.0.324)、安装包 LICENSE 与冻结锁文件。

## DEV-1735 首页输出展示增量｜2026-11-06

沿用用户授权的首页/共用 Agent UI，新增官方 `@assistant-ui/react-markdown@0.14.24`，与已安装 `@assistant-ui/react@0.15.32`、React 19.3.1 的 peer 范围兼容。只用于不可信输出的只读 CommonMark 展示，不改变正文、Message、Run、Manifest 或 Runtime Owner；没有复制上游源码。官方包与 react-markdown 为 MIT；本轮已阅读安装包 LICENSE，传递依赖 `@ungap/structured-clone@1.4.0` 为 ISC，全文随 THIRD-PARTY-AI-NOTICES 分发。现有准入仅添加上述精确版本，不通配放行 ISC 或未来版本。

输出关闭原始 HTML；模型链接只显示文字，图片只显示说明，不发网络请求，不作为已核验来源。复制保留模型原始 Markdown；失败时提示手动选择复制。回退卸载该组件并恢复原 package/lock 与展示增量，已保存的 Run 纯文本无迁移。适用真实命令与桌面证据留 artifacts/evidence；真实 BYOK 未授权，不以合成 Provider 证明模型质量。依赖准入和精准 diff 仍需独立上下文复核。

真实 Electron 复验发现浏览器 Clipboard API 在现有拒绝权限策略下失败。保持所有 permission handler 不变，复制改走既有 typed Agent IPC → Application `copy_output(scope, run_id)` → 注入的 `copyOutput` 端口 → Electron clipboard.writeText。请求 strict Schema 不接收正文或路径；Application 校验 Task 存在、Run scope/窗口归属，并只读该 Run 的非空且不超过 64,000 字符原始输出。没有剪贴板读取 IPC、任意文字写入口或 Provider 派发；写失败不改 Run，也不在错误回显正文。此必要 UI 接线须独立复核并以原生剪贴板比对验证。

离线交互验收使用既有受控临时演示根新增 `agent-preview` phase：内存合成凭据、同一 Pi 的合成 Stream、HTTP(S) 阻断；不读取正式工作区/真实 Key。`scripts/open-agent-home-demo.mjs` 创建隔离目录后启动同一打包 app，供人工输入/拖入合成 PDF，固定输出明确标 MOCK_ONLY。它不是另一 Runtime 或真实 BYOK 验收。

来源：[官方 npm 包](https://www.npmjs.com/package/@assistant-ui/react-markdown)、安装包 `LICENSE` / `package.json`，以及本仓原 assistant-ui ExternalStoreRuntime。

> 2026-11-06 用户指定首页及 AI 辅助栏改用 assistant-ui Composer 默认文本输入；本条取代下文 Agent 输入保留 Tiptap 的旧决定。任务正文仍使用既有 Tiptap/Yjs；发送按现行04的 PDF-CHAT1／HOMEUI1，以本轮附件卡和所选模型表达范围，发送时固定输入，不另加二次预览确认。删除常驻发送说明不改变权限、预算或未知回执保护。

> 2026-11-05 更新：用户已授权 DeepSeek 接入；下文单 OpenAI 限制由 [ADR-009](./ADR-009-provider-model-selection.md) 覆盖，其他边界保持。

状态：2026-11-05 用户指定采用，增量实施；完整 R1 验收未完成。

基线：3e261479。本轮主要实现责任 DEV-1652，后续 UI 接线由 DEV-1691/1650 消费；不关闭任何未验收整卡。用户最新指令覆盖旧 shadcn 优先和双候选 TCO 比选。

## 决定

- `@assistant-ui/react` 0.15.32 的 ExternalStoreRuntime 只投影 CaseLite 状态；首页和辅助栏共用一个组件，Tiptap 保持输入内核。无云会话、LocalRuntime、react-pi 或第二 Agent Loop。
- `@earendil-works/pi-agent-core` / `pi-ai` 1.5.0 为官方当前包（earendil-works/pi，MIT，Node >=22.19；本机 Node24）。仅注册 OpenAI Provider，固定端点；不读取环境中的凭据、不加载 Coding Agent、Shell、文件或 MCP 工具。
- 本增量只发送用户明确预览确认的输入文本，任务ID只用于归属；不会自动带入任务正文、文件或历史。单次请求，工具集合为空，取消、超时与迟到输出隔离。工具读取在原白名单责任卡准入。
- Renderer → 固定 IPC → Application → Runtime/Credential ports。输入Key只在用户输入及一次配置命令中短暂存在，主进程通过系统 safeStorage 加密保管；查询只回传配置状态，不返回Key。加密不可用则拒绝配置，无明文降级。
- 当前运行投影仅在本次应用会话有效，UI明示重启不保留；不冒称已完成持久化WorkRun。正式运行历史由 DEV-1653 承接，保持单一Owner。
- assistant-ui与Pi仅依赖包调用，不复制上游组件源文件。传递依赖许可和安全审计必须通过；Google/protobuf的未使用安装脚本明确禁用，不放宽strictDepBuilds。

## 验证与回退

Electron 45采用异步safeStorage。凭据初始化解密后只在主进程缓存，配置异步加密落盘成功才更新缓存；配置期间拒绝新Run，已有Run仍可核对。打包实测原Electron签名使加密失败；内部包增加固定Bundle ID和postPackage本机adhoc重签及严格验签。合成Key已验证加密/新实例解密/删除，正式Developer ID、公证和跨升级凭据恢复另验。此凭据适配当前只准入macOS，其他平台拒绝保存而不采用basic_text回退。

实际 SDK＋模拟流检查取消、工具拒绝、单次调用、错误及清理；真实 Electron 验首页/侧栏、Tiptap输入、预览和停止。真实BYOK费用/业务质量单独记，未获准外发不运行。复验任务保存、切换和重开。

回退用本轮提交的反向提交；不删除用户数据。凭据删除走专用配置命令，运行结果不自动写正文。

来源：https://www.assistant-ui.com/docs/runtimes/custom/external-store ，https://github.com/earendil-works/pi/tree/main/packages/agent 。

## 本轮精确版本许可准入

已阅读以下安装包的 LICENSE。只按此精确版本准入；升级仍触发复核。BSD通知、0BSD及Unlicense全文汇总至 apps/desktop/assets/THIRD-PARTY-AI-NOTICES.txt 并通过Forge extraResource随安装包分发。原未知/商业/强copyleft拒绝规则不变。

- @protobufjs/aspromise@1.1.2：BSD-3-Clause
- @protobufjs/base64@1.1.2：BSD-3-Clause
- @protobufjs/codegen@2.0.5：BSD-3-Clause
- @protobufjs/eventemitter@1.1.1：BSD-3-Clause
- @protobufjs/fetch@1.1.1：BSD-3-Clause
- @protobufjs/float@1.0.2：BSD-3-Clause
- @protobufjs/path@1.1.2：BSD-3-Clause
- @protobufjs/pool@1.1.0：BSD-3-Clause
- @protobufjs/utf8@1.1.2：BSD-3-Clause
- buffer-equal-constant-time@1.0.1：BSD-3-Clause
- fast-sha256@1.3.0：Unlicense
- protobufjs@7.6.6：BSD-3-Clause
- secure-json-parse@4.1.1：BSD-3-Clause
- tslib@2.8.1：0BSD

## DEV-1691 输入、流式与停止复验｜2026-11-06

以下归档同步前的历史复验；“本轮”指下述 `2929c9a3` 现场，不代表后续提交再次执行。历史 manifest、assertion-matrix 和原始日志已核对；未通过项保持原结论，当前构建及人工接收另留 Issue 记录。

本轮继续复用现有 @assistant-ui/react 0.15.32 ExternalStoreRuntime／Composer、@assistant-ui/react-markdown 0.14.24 与 Pi Core／pi-ai 1.5.0，不引入第二输入内核或 Runtime。基线 HEAD `2929c9a3` 为含历史未提交修改的现场；284项源文件及296项包条目与窄窗构建清单一致，包内 app.asar SHA-256 为 `fd6d95f947ac513d41daa5f08b41bc3f05d224774bfded6da2da45d6168fd164`。现有6个测试文件57项及Provider合成HTTP的8项在 Node 24.22.2 下通过，覆盖输入组合/Enter、未知回执沿用原Run ID、任务隔离、Pi取消与迟到拒绝、错误脱敏、SQLite中断恢复及登记失败零派发。Provider和输入事件均为合成，不作为真实模型或系统IME验收。主控原生IME证据按未变的Composer／附件／Pi指纹复用，窄窗原生操作单列；本轮未重新执行系统IME。

同包 `check-agent-demo.mjs --synthetic-recovery` 首次由Node26驱动，在首阶段合成Key的系统安全存储 availability 检查3001ms超时，脚本退出1；主控授权排除额外包装影响后，仅一次用固定Node24.22.2在新隔离根正常复验，availability再次3001ms超时，脚本60秒期限以SIGKILL结束首阶段（ETIMEDOUT），脚本仍退出1。两次均未进入流式UI，后两阶段未运行，停止同类重试。保留此失败，不修改Keychain权限或采用明文降级；继续复用结论仅限已验证的输入／运行投影技术路径，不能据此宣称本轮桌面流式／重启整体验收通过。逐断言、命令、构建指纹、MOCK_ONLY隔离启动入口及回退补丁留仓库外本卡证据；实际流式桌面复验仍需系统凭据可用后使用原脚本完成。额外系统禁网测试包装与Electron子进程沙箱不兼容，既有synthetic crash phase未进入恢复流程，read phase未运行；这是测试环境阻断，不计作产品恢复失败，未关闭沙箱绕过。主控补充的原生Stop和“重新填写”只证明局部UI行为，Provider仍为合成，不提升为全流程通过。消息修订、完整选材／来源回跳和新Document接受沿各自Owner另验。本轮真实Provider调用0次，无产品代码或数据格式变更；回退只撤销本节，保留隔离证据，不动历史修改和用户数据。
