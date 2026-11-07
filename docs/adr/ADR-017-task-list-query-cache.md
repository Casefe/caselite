# ADR-017｜任务分页读取缓存试点

[DEV-1800](https://linear.app/logixy-ai/issue/DEV-1800) · 用户已批准限定任务列表读取。

- Renderer 使用精确版本 `@tanstack/react-query@5.107.1`，依赖 `@tanstack/query-core@5.107.1`。两包为 MIT，React 19 符合 peer 范围。通过 npm 依赖引入，不复制源码。来源为 [TanStack Query](https://github.com/TanStack/query)，许可清单由现有脚本生成。
- 每个工作台实例只有一个任务分页 QueryClient。键含完整 TaskListQuery，缓存只驻内存，60 秒内可复用。只通过原 typed IPC 读取，不依赖网络在线状态，无自动重试。筛选、选择、滚动和编辑状态仍由页面持有。
- SQLite 是任务权威。现有保存、幂等回执及工作区授权继续走原入口。刷新入口先取消过期的缓存读取，再标记任务分页失效。取消不代表中止宿主 IPC。全量任务快照继续服务原消费者。
- 当前应用按单本地工作区运行。跨工作区或宿主外部写入接入时，重新审查键与变更通知。其他列表的读写不属于本试点。
- 回退为撤销提交，移除读取缓存和新增依赖；没有数据迁移。
