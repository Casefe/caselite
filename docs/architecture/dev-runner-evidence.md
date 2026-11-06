# 外置 Runner 证据读取与恢复

适用于 DEV-1694 的合成文档联调。Runner 位于仓库外，不属于 CaseLite 产品 Runtime；稳定入口以外置 `README.md`、`runner/live.py`、`runner/live_cli.py` 为准。

## 读取与核对

由可信宿主从唯一安装根运行只读入口：

```sh
python3 -B -m runner.live_cli inspect --approval <批准JSON路径> --current <当前状态JSON路径>
```

批准、当前状态由宿主提供，不读取或复制认证文件。`inspect` 返回该 run 的事件；批准过期或撤销后仍可查看，但不因此获得继续写入权限。哈希仅证明输入一致，真实合同、批准和依赖仍由宿主核对。

| 字段 | 含义与核对方法 |
| --- | --- |
| `runId` | 单次执行的 UUID，关联批准、隔离 clone、journal、模型日志及平台回执；不得混用不同 run 的证据。 |
| `baselineSHA` | 批准的起始提交。核对 clone 起点，以及最终提交的父提交是否与其一致。 |
| `checks` | 固定检查结果，含 `treeSHA`、文件列表和各检查退出码。`diff-check` 检查暂存差异格式，`approved-document` 检查文档约束；不代表产品测试。 |
| `recovery` | CLI 失败响应中的恢复提示，要求查看既有 run 和原日志；不是自动重试许可或成功回执。 |

先核对白名单文件和实际内容，再核对 `checks.treeSHA`、提交树、索引和工作树。宿主写回前还须核对最终提交 SHA 与 GitHub PR head；检查后有变化时，旧检查不能证明新 head。提交记录不能单独证明其内容经过检查。

## 各类证据的边界

- Codex：JSON 事件中的 sessionId、完成事件、退出码和 usage 证明模型进程的可观察执行；不证明内容正确。无法观察的用量或费用保留 `UNKNOWN`。
- 本地检查：证明固定文档 profile 对指定树的检查结果，不证明 Electron、恢复或业务功能通过。
- Linear：主评论及回执证明证据写回到对应 Issue；不自动证明业务验收，不变更原 Owner、状态、依赖或历史。
- GitHub：分支、Draft PR 及回执证明远端对象和 head；不证明审批、合并、发布或产品完成。平台副作用由获准宿主执行，worker 不持有写回凭据。

## 未知结果与恢复

状态根为唯一安装根下的 `.runner-state`。先保全 `active-run.json`、`runner.lock`、`live-<runId>.jsonl` 和对应 Codex 原始日志，由宿主通过 `inspect` 核对事件链、intent 和 receipt。原始日志仅留在本机受限目录，不上传完整 stdout。

`PREPARED` 表示已持久化意图，宿主才可按批准调用一次；`CONFIRMED` 复用已核对回执；`QUERY_REQUIRED`、`UNKNOWN`、超时或回执丢失时，先查询原 session、提交、PR、commentId，不能重跑模型、另建 PR 或重复创建评论。`confirm` 只登记核实后的既有回执，不授权新写入。额度限制的等待时间不是重跑授权，当前入口不自动重跑。

journal 缺失、损坏、孤立预约或无法确认远端结果时停止并保留现场，交 Owner 判断；不得删除锁、预约或日志来领取新 run，也不得更换 runId 绕过未知副作用。

## 适用限制

本机制依赖可信本机用户、可信同用户进程、唯一安装根及唯一状态根。同用户可改文件，不同安装副本的锁不互斥；文件权限和锁不构成对恶意同用户进程的隔离。

现有执行 profile 仅支持无客户数据的小型 Markdown 文档，固定使用 `diff-check` 和 `approved-document`，不接受任意 shell 检查，也不适用于产品代码、Schema、规则或 CI 开发交付。文档联调即使取得模型、本地及平台回执，也不能宣称 CaseLite 产品开发已验收。
