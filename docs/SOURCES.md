# CaseLite｜Linear 来源索引与 Markdown 归属

> 本文件只定位来源，不保存动态任务清单。执行依据为 **CaseLite 精简版 v3.0 现行01—06**；现行修订及本轮执行授权以资源正文、更新时间和用户指令核对。开工仍须实时读取适用合同与批准。

## 1. 事实来源与冲突规则

1. **Linear Issue/Resource**：需求、Owner、依赖、任务批准、合同修订和验收决定的权威来源；状态、优先级与下一步从实时数据筛选。
2. **GitHub Git/PR/CI**：对应 SHA 的代码、Schema、迁移、锁文件、准确 Diff、测试和合并证据；本地命令以当前仓库核验，历史通过不能借作当次结果。
3. **本地 Markdown**：长期规则、环境方法、来源索引与必要复杂计划，不维护第二套产品合同、Issue 状态或队列。
4. 代码说明实际实现，不能推翻批准要求；来源缺失或冲突时列出具体差异，由 Owner 决定，不能凭旧合同推测。

## 2. 六份现行 Resources（按任务读取）

| 稳定入口                                                                                                                                       | Resource ID                            | 按需内容                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ----------------------------- |
| [现行01｜产品范围与五阶段任务闭环合同](https://linear.app/logixy-ai/document/现行01caselite-精简版-v30产品范围与五阶段任务闭环合同-ca0fbebf8d25)               | `68e0ba6c-88b7-48f3-af95-6465245084f3` | 范围、五阶段、当前与候选      |
| [现行02｜架构、数据所有权与公开接口](https://linear.app/logixy-ai/document/现行02caselite-精简版-v30架构数据所有权与公开接口-2f8a6583717a)     | `05e230ae-e2b6-4841-be0f-c626c6583749` | 架构、数据 Owner、公共接口    |
| [现行03｜文件、编辑、标注与交付合同](https://linear.app/logixy-ai/document/现行03caselite-精简版-v30文件编辑标注与交付合同-91814a50f5b2)       | `1c93a8b2-68d6-4b85-aa8f-8a1ccc9adf89` | 文件、正文、标注、交付        |
| [现行04｜单 Agent 文档辅助合同](https://linear.app/logixy-ai/document/现行04caselite-精简版-v30单-agent-文档辅助合同-a581412f0308)             | `96a82f72-0deb-4faa-9fb0-91dffa9471ea` | 单 Agent、输入/外发、新稿确认 |
| [现行05｜操作验收、失败与恢复样例](https://linear.app/logixy-ai/document/现行05caselite-精简版-v30操作验收失败与恢复样例-788bbb1e76a6)         | `ca981e54-47e8-4713-961c-015d67fcd40e` | 验收分层、失败与恢复          |
| [现行06｜LLM 开发、工程操作与交接手册](https://linear.app/logixy-ai/document/现行06caselite-精简版-v30llm-开发工程操作与交接手册-432b4760f93b) | `d8addbc1-493d-4edc-8095-04982b70ae76` | 开发、批准、审查、交接        |

修订定位：资源标题的v3.0不是冻结版本；正文可含OPT1、EXEC3、TECH8及直接开发授权。01—06为稳定定位ID，不以旧R4/R5/R6文字充当当前阶段或修订。实施卡记录实际读取的更新时间、相关段落及用户授权，变化后重核范围与证据，不把资料修订视为产品升级。

每轮只加载当前 Issue 全文、相关合同章节、生效的 AGENTS、必要源码/API/测试。涉及文件/正文读02/03，AI读02/04，验收读05，开发/授权读06；不要求每轮全文重读六份或所有研究。01—06是合同编号，不是仓库目录或 Project 实施顺序。

五阶段是跨 Project 的业务视图和验收主线。Project 保留交付责任，实际开工按获准 Issue 的依赖与前置产物确定。首个产品闭环由 [DEV-1657](https://linear.app/logixy-ai/issue/DEV-1657) 收口：独立 Task 中导入 PDF、标注成摘录、用选定摘录经真实 BYOK 生成、修改保存，并从同一修订实际验证 Word 与 PDF。普通导出固定修订，正式定稿单独确认。

[R6｜MCP、外部知识与 Agent 连接](https://linear.app/logixy-ai/project/caselite-06mcp外部知识与-agent-连接近期优先-cd60cba1db53) 管理近期 MCP M1 等交付。[专项合同06｜MCP 与外部连接器](https://linear.app/logixy-ai/document/专项合同06caselitemcp与外部连接器-2e4196f80d30) 约束连接器。现行06是工程操作与交接手册，三者按各自职责查阅。

## 3. 工程规范与专项工作的唯一入口

| 入口                                                                                                                                                                                           | 职责与适用时机                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| [AGENTS.md](../AGENTS.md)                                                                                                                                                                      | 开工硬规则、安全停止条件、模块边界；核对根与目标目录实际生效规则                                                                       |
| [README.md](../README.md)、[DEVELOPMENT.md](./DEVELOPMENT.md)                                                                                                                                  | 安装、启动、命令与环境；实际脚本以 `package.json` 和当前输出为准                                                                       |
| [WORKFLOW.md](./WORKFLOW.md)                                                                                                                                                                   | 律师/ChatGPT/Linear/Codex/GitHub操作、十二项开发机制执行对照、批准、返工和断点恢复                                                        |
| [ARCHITECTURE.md](./ARCHITECTURE.md)、[ADR 索引](./adr/README.md)                                                                                                                              | 稳定边界与决定依据；产品范围、Owner、同步准入先按现行02/06核对                                                                         |
| [TESTING.md](./TESTING.md)、[SECURITY.md](./SECURITY.md)                                                                                                                                       | 实际测试/证据和安全底线；适用验收按现行05，不由旧阶段表扩容                                                                            |
| [CODE_REVIEW.md](./CODE_REVIEW.md)、[PR 模板](../.github/PULL_REQUEST_TEMPLATE.md)                                                                                                             | 风险、准确 Diff、同 SHA 证据、独立审查和回退                                                                                           |
| [REVIEW_HANDOFF_EXERCISE.md](./REVIEW_HANDOFF_EXERCISE.md)                                                                                                                                     | 新会话独立预演步骤；证据留当前 Issue/PR，不以文档存在视为通过                                                                          |
| [自动开发专项 Resource](https://linear.app/logixy-ai/document/开发工具专项caselitechatgpt-linear-codex-github-自动开发与受控合并-v1-aa598a441700)（ID `9cbbe541-74ce-4bcd-9983-6ee408c9f509`） | 开发工具链唯一细则，服从现行06实时正文和本轮授权；1694执行/评论/Draft PR、1695同SHA CI/待验收、1696受控合并、1697后置候选。实际能力按profile/run证据核对 |
| [开源架构参考与采用矩阵](https://linear.app/logixy-ai/document/研究参考caselite开源架构参考与采用矩阵-v11-c4cdac98fa55)、[ADR-005](./adr/ADR-005-third-party-code-license-and-clean-room.md)   | 采用/源码复用前按需核对来源、commit、许可、NOTICE、实际消费者及退出方案                                                                |

现有专项文档、ADR及 [首片历史设计](./plans/first-slice.md)保留原工程证据；其中旧 v2.x、“P0—P4”、Fact/Review、Outbox及旧任务顺序不作为当前范围/执行指令。适用的 Electron/IPC、数据保护、许可和测试禁令继续有效；有具体冲突回读现行合同并报告，不能借版本变化删除安全要求。本次四文件修复不代表这些文档已全部更新。

## 4. 历史参考与维护方法

**历史参考，不作为当前开发依据**：[旧产品 v2.2](https://linear.app/logixy-ai/document/caselite产品定义-v22现行-1adb0efed051)、[旧架构 v2.2](https://linear.app/logixy-ai/document/caselite架构与开发约定-v22现行-d22d41990c7d)、[旧验收 v2.2](https://linear.app/logixy-ai/document/caselite场景与验收样例-v22现行-65005791136a)。URL中的“现行”是历史地址，不恢复其执行地位；旧任务列表及阶段划分的追溯使用 Git 历史和 Linear 历史档案，不在此复制。

- 更新索引时从 Linear 回读标题、ID、修订、链接及归属；只改当前 Issue 授权的文档，不因索引自动预建包、合同或计划文件。
- 重要长期技术决定按需进入既有 ADR；`docs/plans/`仅用于必要复杂实施计划，不为每个 Issue 机械新建 Markdown。
- 不保存全部 Issues、动态状态、项目数量或开发日志；不新增 TASKS/PROGRESS/NEXT/DEVELOPMENT_LOG 平行真源。自动化机器检查点归产品仓库外的 Runner journal，人读阶段摘要归目标 Issue 单run评论。
- 研究、候选和旧链接只有经当前 Owner 准入后才能成为要求；不自动恢复历史规划，不以资料堆积或 AI 自评代替证据。
- 非公开成本、客户数据、密钥、敏感日志及未经授权的完整材料不得进入 Public 仓库或外部评论/PR。
