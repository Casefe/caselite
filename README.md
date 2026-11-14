# CaseLite

**Local-first AI legal workspace**

CaseLite 面向独立律师和小型法律团队。用户先创建独立 Task，逐步导入选定材料、阅读和摘录、人工或 BYOK 辅助起草、核对、保存与交付；Task 可选加入项目，归组不改变原身份与历史。

当前是本地原型：已有 Task 与 Yjs 正文读写、项目及文档目录、知识库分类和收藏、OpenAI／DeepSeek 设置、受控 Pi 执行与本地 Run 历史。材料受管导入、固定来源与 Anchor、OCR、AI 候选另存、同快照 Word／PDF、备份恢复及同步仍按各自责任卡开发和验收。界面、已安装依赖、测试探针或 CI 通过均不代表这些能力已交付。

## 产品边界

无需账号即可使用已实现的本地人工功能。首页、任务、项目、文档、知识库共用三栏布局；首页中间是 Agent。原文、备注、AI 候选和律师确认分别表达，定位正确不等于结论已获原文支持。

BYOK 只向选定 Provider 发送用户明确预览和确认的输入；当前运行适配器只读取输入框文本，不隐形读取文件或历史。停止后远端结果和费用可能未知，不自动切换收费 Provider。个人核心功能免费、同步协作增值是产品方向，尚无已上线收费或协作承诺。

## 开发与验证

Node 与 pnpm 版本由 `mise.toml`、`package.json` 和锁文件固定。安装及环境要求见 [DEVELOPMENT](docs/DEVELOPMENT.md)。

```sh
pnpm install --frozen-lockfile
pnpm env:check
pnpm dev
```

`pnpm check:quick` 执行快速门禁；`pnpm test:integration` 验证当前存储和边界；`pnpm test:full` 含联网审计、许可证、macOS arm64 打包和离线工程联动。Task 实机演示另用 `node scripts/check-task-body-demo.mjs`，不能用 PDF 工程探针替代。命令须使用仓库锁定环境，实际通过范围以同 SHA 原始证据为准；未运行、模拟和真实 Provider 分开记录。

## 进入一个任务

先读 [AGENTS.md](AGENTS.md)，再经 [SOURCES](docs/SOURCES.md) 回读实时 Linear Issue、适用现行01—06和真实依赖产物。当前原型模式在主开发目录串行实施，用可回退提交和实际运行证据交付；不要求逐卡新分支或重复开工确认。

- [产品边界](docs/PRODUCT.md) · [实际架构与Owner](docs/ARCHITECTURE.md)
- [测试分层](docs/TESTING.md) · [安全](docs/SECURITY.md)
- [执行与交接](docs/WORKFLOW.md) · [独立审查](docs/CODE_REVIEW.md)
- [新会话预演](docs/REVIEW_HANDOFF_EXERCISE.md) · [ADR](docs/adr/README.md)
- [工程化研究白皮书](docs/research/engineering-whitepaper.md) · [行动方案与跨工具交接](docs/plans/engineering-action-plan.md)（2026-11-14研究建议，执行仍以实时合同和最新授权为准）
- [Linear 产品开发](https://linear.app/logixy-ai/initiative/caselite-产品开发-1ac38d27e4c0)

工程可判定的验收与律师产品接收分别处理。R0 准备、R1 首个法律任务、后续持续工作／审查／双设备／团队及候选增强各有结束条件，编号不代替真实依赖。开发工具 Runner 与产品内 Pi Agent 是两套职责，不把工具候选作为全部产品开发前置。

## 公开仓库

仓库为 Public。CaseLite 自有软件采用[专有软件许可证](legal/LICENSE.md)，终端使用适用[最终用户许可协议](legal/EULA.md)。允许律师正常办案、提供收费法律服务和交付成果；软件销售、对外再分发、改名经营及外部托管须另获授权。第三方组件仍适用各自许可及 NOTICE，既有有效授权不被追溯撤回。

普通启动先展示两份完整离线协议，分别阅读并主动勾选同意后才能进入工作台；拒绝或关闭窗口则退出。本机保存确认时间及两份正文的 SHA-256，正文变化后重新确认；不上传案件材料，不作为实名或机构签署证明。确认记录无法读取或保存时不放行。SQLite/PDF 等隔离工程探针不进入业务工作台，不代表用户已接受协议。

禁止提交真实案件、客户资料、Key、Token、私密日志或无许可第三方源码。本页只提供摘要，具体许可范围以完整协议为准。
