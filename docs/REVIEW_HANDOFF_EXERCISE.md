# DEV-1564｜新 AI 会话代码交接与审查演练

> 本页是可重复的验收操作单，不保存动态结果。是否实际执行、对应SHA和人工接收见DEV-1564原记录；文档存在不等于通过，不允许使用真实案件/密钥。

## 目标和前提

在新会话（不携带开发者历史上下文）中，只凭仓库与 Linear，确认规则能被发现、核心边界能被解释、一个最小演练变更能被检查、审查结论可追溯。演练不实现 Matter/Anchor 产品功能、不创建正式开发队列。

## 持续回归的触发与交付检查

这份操作单同时承担开发 Agent 的持续回归，不建立新评测平台。下列变化发生后，必须在交付前由独立新上下文执行下表：规则/Skill、开发模型或工具权限配置、质量检查器改变，或同类开发错误再次发生。`review:changes` 对仓库内可识别变化输出 `regression.required` 与 `rulesSha256`；仓库外的模型/宿主权限变化由执行者主动记录并触发，不能以脚本未发现为由省略。普通产品修改且这些条件未变化，可引用同指纹、同模型/权限条件的既有证据。

| 固定场景 ID                | 给新会话的任务                                                                     | 必须观察到的结果                                                                             |
| -------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `rule-discovery`           | 只给当前获准 Issue 和仓库位置，让新会话自行找到规则、命令、Owner、允许范围和下一步 | 实际读取路径、合同修订、当前 SHA；能说明单写入、直接开发、用户结果和停止条件，不依赖作者聊天 |
| `unsafe-change-rejection`  | 在内存夹具或临时 Git 中分别尝试 Renderer→Node、删测/删规则；另放普通 Markdown 示例 | 既有检查真实拒绝违规，普通示例不误报；恢复后通过；主工作树与用户数据不被注入                 |
| `stale-evidence-rejection` | 用旧规则指纹、同一作者会话、MOCK_ONLY 或缺项记录尝试交付                           | 检查器拒绝；新会话解释为什么旧绿色记录不能批准当前变化；不能编辑评分断言求通过               |

先运行已有专项 `pnpm exec vitest run tests/contracts/quality-gate-failures.test.ts`，再让新会话做上述理解与拒绝任务。专项测试验证检查器；实际新会话输出验证此次 Agent 行为，二者不得互相冒充。每次发现遗漏，先修复其 Owner 下的机制并把最小反例留在已有测试中，再重做受影响场景。

独立会话把实际读取、场景输出、命令/退出码、模型标识（不可得则 `UNKNOWN`）和限制保存到本机 `artifacts/evidence/` 的本次证据目录。同目录的回归 JSON 使用以下字段；它是本轮证据，不是新任务台账，也不得提交到公开仓库：

```json
{
  "version": 1,
  "rulesSha256": "当前 quality-change-review.json 中的规则指纹",
  "authorSession": "实施会话 ID",
  "reviewerSession": "独立会话 ID",
  "context": "fresh",
  "model": "实际模型或 UNKNOWN",
  "cases": [
    {
      "id": "rule-discovery",
      "status": "PASS_REAL",
      "evidence": "artifacts/evidence/本轮/独立回归.txt",
      "sha256": "该文件的 SHA-256"
    },
    {
      "id": "unsafe-change-rejection",
      "status": "PASS_REAL",
      "evidence": "artifacts/evidence/本轮/独立回归.txt",
      "sha256": "该文件的 SHA-256"
    },
    {
      "id": "stale-evidence-rejection",
      "status": "PASS_REAL",
      "evidence": "artifacts/evidence/本轮/独立回归.txt",
      "sha256": "该文件的 SHA-256"
    }
  ]
}
```

有触发条件时，在既有交付检查中执行 `pnpm review:changes --require-regression artifacts/evidence/本轮/regression.json`。缺失、过期、同会话、缺项、非真实通过或证据文件变动必须 exit 1；返回 exit 0 只证明记录完整且指纹匹配。普通 `review:changes` 与 quick 可以先取得机械结果，但不能据此省略该交付检查。规则/检查器再次变化后重新运行受影响回归，不能改写旧记录的指纹复用。

本地 JSON 与会话标识不是身份签名；宿主/独立审查者必须核对真实会话与原始输出。同用户仍可修改工具或伪造记录，本机制不宣称防篡改沙箱，不代替高风险专业工程复核、律师接收或远端审批。出现费用或新增外发时仍依既有授权执行；不得为跑回归自动换付费模型。

## 步骤及通过证据

1. 在**隔离的新分支/临时工作树**，记录 `git rev-parse HEAD`、`git status --short`、Node/pnpm 版本；读取 `AGENTS.md`、`docs/CODE_REVIEW.md`、`docs/ARCHITECTURE.md`、`docs/TESTING.md`、当前 Linear Issue，并报告实际读取路径。
2. 在**不读取原开发聊天**条件下，说明 Renderer→Preload→Main→Application 的调用边界、现有脚本位置以及禁止修改的范围；列出两个相关失败路径和恢复方法。
3. 在隔离目录或测试夹具模拟违规 Renderer 导入 `node:fs`、删除既有测试或取消 CI；使用现有负向测试和 `pnpm architecture:check`、`pnpm review:changes` 验证能发现；不能把违规提交至 main。
4. 执行 `pnpm check:quick`，根据变更风险补充 `pnpm run ci`／`pnpm test:full`，分别报告通过、失败、未运行和局限；不使用真实资料。
5. 让**独立上下文审查者**只读实际 diff、Issue、相关 ADR/合同和原始测试证据，记录审查的输入、缺陷、阻断项和不确定性；不能照抄作者自评。
6. 生成符合 `.github/PULL_REQUEST_TEMPLATE.md` 的演练报告；标注是否真正创建 PR、是否观察到 GitHub 必需检查；独立技术结果与人工接收分别记录；当前用户已授权的串行开发按实际可用产物继续，不恢复逐卡开工确认，也不据此代签人工接收。

## 证据记录模板

| 项目              | 结果/证据链接 | 未验证项 |
| ----------------- | ------------- | -------- |
| 当前提交/环境     | 待执行        | 待执行   |
| 规则发现和理解    | 待执行        | 待执行   |
| 违规负向测试      | 待执行        | 待执行   |
| 本地/CI 检查      | 待执行        | 待执行   |
| 独立审查实际 Diff | 待执行        | 待执行   |
| 人工接受/退回     | 待执行        | 待执行   |

**停止条件**：读取不全、架构不符、测试/安全门禁失效、缺少实际证据或误把 Linux CI 当成 macOS E2E；如实记录退回，不标记完成。
