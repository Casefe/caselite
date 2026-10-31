# Application、Command／Query／Event 与 IPC 合同 v1

- 状态：DEV-1578 实施中的可执行 Spike；不表示 Matter、Anchor、SQLite 或权限系统已经交付。
- 代码位置：packages/contracts、packages/application、apps/desktop/src/main/ipc、apps/desktop/src/preload。

## 当前两个 Command

| Command | 请求最小字段 | 成功结果 | 真实持久化 |
| --- | --- | --- | --- |
| CreateMatter | request/protocol/workspace/actor/device/idempotency/expected_version/title | Matter ID、版本、matter.created | 否；not-persisted |
| CreateAnchor | 上述信封 + matter/source version/page/quote | Anchor ID、版本、anchor.created | 否；not-persisted |

protocol_version 固定为 1。未知版本返回 PROTOCOL_UNSUPPORTED；不能静默采用新语义。出现不兼容字段或语义时，必须新建协议版本和明确迁移/拒绝规则；v1 不猜测或接受未来版本。

页面坐标没有出现在 CreateAnchor v1：DEV-1560 明确禁止在 PDF 阅读器未实际定位前伪造坐标。当前只接受页码和原文片段；PDF.js 定位、坐标和持久化由 DEV-1568/P1 切片补充。

## 调用与安全顺序

    renderer
      → window.caselite.createMatter/createAnchor
      → preload 固定通道
      → main sender + Zod 校验
      → Application 授权、版本、幂等处理
      → 结构化结果/领域事件

renderer 不取得 ipcRenderer、数据库、文件、路径、SQL 或通用通道。preload 仅公开上述两项业务动作；main 拒绝非受信任页面。

当前 composition root 的授权器恒定允许，只能用于此无持久化 Spike；它不是身份或权限实现。DEV-1561/P1 必须替换为真实对象级授权 Port，SQLite/Outbox 由 DEV-1567/P1 实现。

## 追踪矩阵与后续入口

| 发起位置 | 合同 | Application | 领域/Port | 事件 | 当前状态 |
| --- | --- | --- | --- | --- | --- |
| P1 renderer 的创建事项动作 | CreateMatter v1 | createMatter | Matter 规则与 MatterRepository（未来） | matter.created | 已验证到 Application；未持久化 |
| P1 PDF 阅读器的建立锚点动作 | CreateAnchor v1 | createAnchor | Anchor 规则与 SourceVersion/Anchor Port（未来） | anchor.created | 已验证到 Application；未持久化 |
| P2 Work Runtime 的候选事项操作 | 未来独立 Command | 只能调用 Application | 不得直连 SQLite/文件/Provider | 独立 WorkRun/领域事件 | 未实现，须先有获批用户结果 |
| P4 MCP/连接器的受控操作 | 未来独立外部合同 | 只能调用同一 Application 用例 | 不得直连 Repository/路径 | 审计与领域事件分开 | 未实现，须先有获批连接器 |

这里的 future 不代表已预建目录、接口或能力；它只冻结“必须经过 Application”的边界。

## 错误与 UI 映射

| 错误 | UI 结果 | 恢复动作 |
| --- | --- | --- |
| INVALID_REQUEST | 表单/请求失败，不显示底层细节 | correct_input |
| PROTOCOL_UNSUPPORTED | 客户端版本不兼容 | upgrade_client |
| FORBIDDEN | 无权操作 | request_access |
| CONFLICT | 版本冲突 | refresh_and_retry |
| INTERNAL | 通用失败 | contact_support |

所有错误包含相关 ID，但不包含 SQL、绝对路径、密钥或堆栈。

## 验证和回退

- tests/contracts/application-ipc-contracts.test.ts：Schema、幂等、权限和冲突；
- tests/contracts/ipc-spike.test.ts：固定 preload API、IPC channel、sender、协议与输入拒绝；
- pnpm architecture:check：阻断 renderer 导入 application/contracts/Node。

因当前 macOS/Electron 图形启动存在已记录的系统级阻塞，尚未获得 GUI 端到端实测。上述测试用可注入的 IPC main 注册器验证 handler 路径；不得把它表述为已完成 GUI 验收。回退时删除这两个 workspace 包、preload API 和 main 注册，不保留兼容性通道。
