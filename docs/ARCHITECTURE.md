# CaseLite｜架构与数据所有权

依据现行02及当前消费卡，定位见 [SOURCES](SOURCES.md)。实际模块、签名、迁移和依赖以源码及同SHA证据为准。历史P0—P4不是当前创建目录或安装服务的命令。

## 实际调用与装配

```text
Renderer → typed Preload → 固定版本IPC → Application → Port → 受控Adapter
                                                  ↓
                                        SQLite／平台凭据／Pi Runtime
```

Renderer只通过Preload方法访问业务；仅导入Preload类型，不运行时导入contracts、Node、Electron、SQLite或Provider。Main验证活窗口及主frame；Application校验strict DTO；存储和能力Owner再校验对象范围。无账号不等于信任Renderer自报身份，工作区由宿主决定。

| 现有位置 | 唯一职责与真实入口 |
| --- | --- |
| apps/desktop/src/renderer | React界面、Tiptap编辑、assistant-ui投影；共享布局在ui-design.css |
| apps/desktop/src/preload | caselite-api.ts，固定task/catalog/agent与历史工程探针方法，无通用invoke／SQL／路径 |
| apps/desktop/src/main | 生命周期、composition、受控IPC及平台Adapter；真实连接在index.ts装配 |
| packages/contracts | TypeScript／Zod跨边界格式、错误和版本；不依赖驱动 |
| packages/application | Task／Catalog／Agent用例与Port；不依赖React/Electron/数据库驱动或Provider SDK |
| packages/local-db | 同一SQLite连接、Drizzle迁移、正文校验、Task／目录／Run持久化Adapter |
| scripts与tests | 已有质量门禁、合成样本、负向与真实桌面harness；不是业务Runtime |

Domain、files、独立PDF/editor包、同步服务和MCP均按实际消费者创建，不为画架构图预建空包。普通CRUD保持普通TypeScript模块；只有格式／权限／持久化和外部能力边界需要Port。开发Runner放产品仓库外，不进入Electron。

Renderer 内部渐进分层：`shared/ui`、`shared/navigation`、`shared/data` 不依赖具体页面；公共讨论能力不导入项目等功能实现。`features/*` 与既有 `projects/finance/review` 间仅使用明确公开入口；当前公开跨功能入口是项目展示词汇、任务归组操作、金额格式化和文档审阅组件。规则位于 `scripts/lib/renderer-boundaries.mjs`，由已有 architecture:check 执行。旧 `ui` 仍包含业务页面，不视为全部通用组件；已禁止其导入项目表单私有实现，其余迁移按实际消费者推进。共享排版不合并各对象的保存队列或版本状态。

## 单一数据权威

Task是WorkItem的稳定身份，可不归组项目。task_projects只保存关系；归组不重建Task、Document或body。项目结构化属性归SQLite，描述复用已有Yjs正文存储。Document的归档、分类、标签与收藏属于元数据；知识目录沿用同一Document，不另建可编辑知识正文。

正文完整Yjs二进制是内容权威；HTML、JSON、纯文本和未来FTS仅是可重建投影。editor_schema、对象version、body_revision、协议版本、数据库迁移版本各有含义，state vector不等于保存回执。Body保存携带原Task／Document／body绑定、expected_revision和稳定业务幂等键。元数据、正文、回执及必要Activity优先同SQLite事务；回执未知先查询原结果，旧修订拒绝，不盲建新稿。

Task内容现有实现见ADR-007：objective_state是Yjs，objective由宿主派生纯文本。它不是两份独立可写权威；但与现行02／DEV-1704的“结构化目标＋独立Document说明”仍有待原Owner对齐的表示差异。保留原二进制和格式，不在入口文档中暗改表、重定义Owner或宣称1704完成。ADR-006及首片计划中的“仅结构化objective”只描述原固定切片。

原件尚待文件消费者接入：AssetVersion固定字节／hash／ready，SourceVersion登记业务范围，Anchor固定来源版本与位置，Annotation备注和SourceRef消费公共能力。原件不可由正文、OCR、外部应用或新来源版本覆盖。跨文件系统和SQLite才使用有恢复检查点的提交，不将Y.Doc内存事务冒充磁盘保存。当前不预建云Outbox。

## Agent 与外部能力

assistant-ui只投影业务Run；Application持有Run身份／范围／顺序，SQLite保留历史。Pi Core通过唯一RuntimeAdapter执行；pi-ai显式注册OpenAI／DeepSeek Provider，不引入Coding Agent默认工具、Shell、SQL或第二Pi session真源。

当前运行只发送明确确认的输入文本；选定来源／对话修订的完整Manifest与候选接受由各消费卡接入。Provider Key由系统safeStorage加密并放宿主数据目录，不返回Renderer，不写普通业务表／日志。取消不保证远端撤销或零费用；中断Run保留partial且重启不自动付费重放。真实Key/API、预算和法律质量必须另验。

MCP只能包装Application授权入口；只读查询、候选写回及人工接受分开。同步须经原选型入口和E2EE合同准入，结构化命令、Yjs和不可变附件各守唯一Owner，不能直接同步SQLite文件。服务器、Hocuspocus、Redis、向量库和第二Runtime当前均不因方向确定而安装。

## 验证与长期变更

`pnpm architecture:check`扫描真实导入、公共入口、循环、空包与生产依赖准入；安全基线验证Electron隔离、Fuses、CSP及凭据/日志保护。静态扫描不能证明任意恶意脚本安全；真实sender/frame拒绝、事务/旧库、保存/失败、进程终止和重启另有对应测试。

SQLite／迁移、正文恢复、原件／Anchor、密钥／权限、长期协议、关键依赖及构建门禁改动须ADR和必要独立技术复核。当前保存保证仅覆盖已确认修订的已验证故障模型，不承诺未保存键入、断电、介质损毁或设备灭失。数据回退保留旧库与Yjs二进制，禁止旧程序降级覆盖。

ADR入口为 [adr/README.md](adr/README.md)，模板为 [ADR_TEMPLATE.md](adr/ADR_TEMPLATE.md)。源码、实时合同和证据不一致时明确差异及Owner，不据文档改写事实或删除数据。
