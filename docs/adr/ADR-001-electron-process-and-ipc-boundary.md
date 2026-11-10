# ADR-001｜Electron 进程、preload 与类型化 IPC 边界

- 状态：已决定；首个真实 IPC 仍待 DEV-1578 验证
- 日期：2026-10-30
- Linear Issue：[DEV-1558](https://linear.app/logixy-ai/issue/DEV-1558)
- 影响模块：`apps/desktop/src/main`、`preload`、`renderer`、未来 `packages/contracts`、`packages/application`
- 代码证据：`apps/desktop/src/main/index.ts`、`apps/desktop/src/preload/index.ts`，提交 `fbfece3`

## 背景与问题

Electron renderer 处理不可信的页面内容，不能取得 Node、SQLite、任意文件或进程控制能力。当前工程骨架已启用 `contextIsolation`、`sandbox`、关闭 `nodeIntegration`，且 preload 尚未暴露任何 API。

## 必须满足的不变量

- renderer 只能调用 preload 暴露的逐项业务方法；preload 不转发通用 `ipcRenderer`。
- IPC 的输入、输出和错误将在 DEV-1578 中以版本化 TypeScript + Zod Schema 校验。
- main 在调用 Application 前校验请求范围、权限、版本与输入；错误不含 SQL、路径、密钥或堆栈。

## 候选方案

| 方案 | 结论 | 原因/证据 |
| --- | --- | --- |
| 最小 contextBridge API + 一项 IPC 对应一项业务动作 | 采用 | [Electron Context Isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation) 明确反对暴露通用 IPC 发送能力。 |
| renderer 直接使用 Node/数据库/文件系统 | 放弃 | 越过权限与审计边界，违反 Electron [Security](https://www.electronjs.org/docs/latest/tutorial/security) 建议。 |
| 通用 RPC 或第二套桌面 API | 延后 | 当前没有用户结果证明其必要性。 |

## 验证与交付

- 已验证：`pnpm typecheck`、`pnpm package` 和打包后的基础窗口可运行（DEV-1557 证据）。
- 待 DEV-1578：CreateMatter/CreateAnchor 的真实 IPC Spike、Zod 拒绝非法输入与结构化错误。
- 回退：删除新的 preload 方法与其 handler；不暴露兼容性别名或通用通道。

## 后果与重新评估条件

每增加一个业务入口，必须同时增加合同、handler、Application 用例和负向测试。若需要流式大数据、二进制传输或外部网页隔离，先写补充 ADR 与 Spike。

## 窗口能力收紧｜DEV-1861｜2026-11-10

- 状态：已决定；已按用户本轮安全加固授权接入代码，实际验证与未测范围见对应 Issue。
- 问题：活窗口/mainFrame身份校验不能表达工作台与协议、解析、导出窗口的不同能力。
- 决定：宿主在加载固定入口前登记workbench/consent；workbench持有既有业务/外观/探针能力，consent只持有协议与初始外观能力，未登记窗口默认拒绝。参数与对象授权仍由既有Application承担，不新增业务角色、DTO或第二Router。
- 生命周期：关闭、销毁、渲染进程退出及离开固定入口均撤销。原入口重载保留新文档能力但增加代际，同一IPC事件的异步复验不能跨代；URL只用于固定入口复验，不能替代窗口与mainFrame身份。
- 在能力撤销或文档换代时通知既有Agent Application释放该窗口Owner，阻止准备中的模型派发并取消已运行请求；仅拒绝迟到响应不足以阻止外发。已派发的远端处理和费用不能承诺撤回，沿用现有取消与历史回执语义。
- Task IPC把该请求代际的AbortSignal传给既有导出Application和文件Port，出队前、保存对话框返回后、复制/打开副作用前复验。公开DTO、原幂等键和固定快照不变；已经完成的落盘/ACK不因迟到撤权而删除或伪装成未保存，重新读取原回执恢复。
- 放弃：把getAllWindows作为业务授权集合；由Renderer自报角色；给阅读/解析窗口复用业务preload；为加固新增权限数据库。
- 验证：纯逻辑角色/导航/旧事件负测、所有业务handler拒绝测试、真实Electron隔离工作区及主窗正常路径。Mock与真实运行分列，未运行不宣称通过。
- 回退：独立提交撤回接线与能力模块，不改变用户数据或既有sandbox/CSP；撤回意味着撤销本增量保护，须记录残余风险。
- 参考：Electron官方Security与既有研究的IPC统一校验/阅读隔离原则；无第三方源码复用。出现新的窗口角色、入口或权限时重新评估并补拒绝测试。
