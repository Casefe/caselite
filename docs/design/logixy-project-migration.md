# DEV-1807｜Logixy 项目界面迁移

本轮用户于 2026-11-08 批准迁移项目列表与无边框属性栏，先交付本地验收，验收后才允许合并主代码与 GitHub。实现 Owner 为 CaseLite Renderer。

## 来源与授权

来源仓库 `LogiX-Cloud/logixy`，提交 `5f935f1bfbd7e3785cbc3d7f353f09a32fdcebfc`。用户提供的 `logixy-main-1108.zip` 与该提交的 13,310 个文件 Git blob 完全一致，核验记录保存在本地研究产物 `identity-check.json`。

上游相关自有源码没有独立开源授权声明；本轮依据用户确认已付费、可直接使用及本次迁移授权，完成受限范围的本地适配。不把这次授权表述为上游已开源，也不复制第三方依赖或整套私有仓库。下列文件未含单独 NOTICE 文本；CaseLite 保留此来源记录。公开合并依本次用户验收条件进行。

| 来源（apps/frontend/src/ 下） | 采用与适配 |
| --- | --- |
| app/dashboard/projects/_components/project-list-view.tsx | 固定列宽、黏性表头/首列、列开关、选中预览与键盘打开。CaseLite 的 ProjectList 通过原 ReadTable 使用 TanStack Table；查询和排序继续使用原项目目录。没有搬入云端组合投影、Next 路由或批量写入。 |
| components/project/properties/components/property-button.tsx | 28px 高无框值、6px 圆角、悬停和可见焦点的视觉规格。PropertySelect 复用本机 select，保持键盘与当前表单校验。没有引入上游 Popover/Command/XState。 |
| app/dashboard/projects/[projectId]/_components/project-properties-sidebar/components/property-row.tsx | 76px 标签列、弹性值列、10px 间隔。保留 CaseLite PropertyRow 的 label 语义，CSS 只匹配项目字段。 |
| app/dashboard/projects/_components/project-meta.tsx | 名称图标、人员缩略标识、状态和空值呈现。数据仍为原 Matter 属性，未推导客户、关键日期或风险。 |

## 组件与状态边界

- `ProjectList.tsx` 是展示层，接收 Matter 和明确动作，不调用 IPC、不存第二份项目，也不跨模块修改 Task 或 Document。
- `ReadTable` 的 `sized` 默认关闭。只有项目列表启用列宽；任务、文档、财务原调用保持不变。
- `PropertySelect` 是共享无框选择器，目前仅项目使用；没有自动保存、领域状态或全局样式。
- `ProjectPropertyEditor` 原样保留，继续串行确认回执、保留中文输入及失败草稿。ProjectCatalog 原受控命令、属性更新省略正文、原键恢复和归档语义保持。
- 新 CSS 位于已有 `renderer/styles/` 资源目录，由现有构建器发射；仅项目入口导入。未新增 CSS 框架或构建器。
- 首页、Agent、任务/文档保存、数据库及正文格式不变。不改变实际未接入字段的业务含义；缺项留空，默认隐藏的列可通过「显示」重新打开。

## 验收和回退

基线 `e60bbc2eb1a873437b52bc9b5f82235cd53a5336`。原有四个材料适配/IPC/preload/contract 未提交文件不归本卡；通过差异指纹确认未改动。本卡只提交自己的 UI、测试和来源记录。回退使用本卡提交的反向提交，不回滚 SQLite 数据或其他在途代码。

重点核对：列表显示/搜索/排序/预览/返回、窄窗横向滚动与固定首列、明暗主题、属性真实保存/重开/冲突/未知回执，以及任务/文档/Home/Agent 的回归。实际通过情况与包指纹记入本卡验收记录；工程自动化不代替用户业务验收。
