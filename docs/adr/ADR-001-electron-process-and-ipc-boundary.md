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
