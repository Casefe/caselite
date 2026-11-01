# DEV-1564｜新 AI 会话代码交接与审查演练

> 这是**待实际执行**的验收操作单；文档存在不等于 DEV-1564 通过，不改变该 Issue 状态，不允许使用真实案件/密钥。

## 目标和前提

在新会话（不携带开发者历史上下文）中，只凭仓库与 Linear，确认规则能被发现、核心边界能被解释、一个最小演练变更能被检查、审查结论可追溯。演练不实现 Matter/Anchor 产品功能、不创建正式开发队列。

## 步骤及通过证据

1. 在**隔离的新分支/临时工作树**，记录 `git rev-parse HEAD`、`git status --short`、Node/pnpm 版本；读取 `AGENTS.md`、`docs/CODE_REVIEW.md`、`docs/ARCHITECTURE.md`、`docs/TESTING.md`、当前 Linear Issue，并报告实际读取路径。
2. 在**不读取原开发聊天**条件下，说明 Renderer→Preload→Main→Application 的调用边界、现有脚本位置以及禁止修改的范围；列出两个相关失败路径和恢复方法。
3. 在隔离目录或测试夹具模拟违规 Renderer 导入 `node:fs`、删除既有测试或取消 CI；使用现有负向测试和 `pnpm architecture:check`、`pnpm review:changes` 验证能发现；不能把违规提交至 main。
4. 执行 `pnpm check:quick`，根据变更风险补充 `pnpm run ci`／`pnpm test:full`，分别报告通过、失败、未运行和局限；不使用真实资料。
5. 让**独立上下文审查者**只读实际 diff、Issue、相关 ADR/合同和原始测试证据，记录审查的输入、缺陷、阻断项和不确定性；不能照抄作者自评。
6. 生成符合 `.github/PULL_REQUEST_TEMPLATE.md` 的演练报告；标注是否真正创建 PR、是否观察到 GitHub 必需检查；律师确认后才推进首批正式开发任务。

## 证据记录模板

| 项目 | 结果/证据链接 | 未验证项 |
| --- | --- | --- |
| 当前提交/环境 | 待执行 | 待执行 |
| 规则发现和理解 | 待执行 | 待执行 |
| 违规负向测试 | 待执行 | 待执行 |
| 本地/CI 检查 | 待执行 | 待执行 |
| 独立审查实际 Diff | 待执行 | 待执行 |
| 人工接受/退回 | 待执行 | 待执行 |

**停止条件**：读取不全、架构不符、测试/安全门禁失效、缺少实际证据或误把 Linux CI 当成 macOS E2E；如实记录退回，不标记完成。
