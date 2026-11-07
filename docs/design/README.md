# CaseLite UI 规范

以 [现行产品与工程合同](../SOURCES.md) 确认范围，以对应的 Renderer 和真实桌面运行确认实现。以下专题中的规划、候选和历史样式按各自标记阅读。

| 专题                                                    | 用途                                       |
| ------------------------------------------------------- | ------------------------------------------ |
| [五页三栏工作台](four-page-three-column.md)             | 五页三栏的历史布局与演进背景               |
| [工作台导航与统一尺寸](workspace-shell-layout.md)       | 导航、尺寸和头像入口的历史设计             |
| [MyCase 与 Linear 设计参考](mycase-linear-workspace.md) | 首轮导航和项目视图的历史依据               |
| [任务字段设计](task-fields-linear-reference.md)         | 字段顺序、新建及普通日期的设计参考         |
| [设置中心与模型服务](settings-model-services.md)        | 设置和 Provider 表单的设计及接线范围       |
| [首页 Agent 的资料交互](pdf-agent-interaction.md)       | PDF、提问、回答与继续操作                  |
| [任务辅助起草流程](task-agent-draft-flow.md)            | 任务内选材、候选、人工确认与回退的流程设计 |

## 属性栏

- 基础构件集中在 `renderer/shared/ui`：`Icon`、`TagPicker`、`PropertyRow/PropertyValue`、`InspectorSection`。它们负责交互和语义，不保存项目、任务或文档。编辑值行与只读值行分别保留 label 和 dl/dt/dd 语义。
- 通用评论在 `renderer/shared/discussion/DiscussionFeed.tsx`；项目包装负责项目评论/人工更新的范围，任务页面提供任务范围。不得因共用展示而合并业务 scope 或持久化真源。
- `ui-design.css` 只登记固定加载顺序，`styles/*.css` 按原连续区段保留层叠；共享尺寸/主题与页面样式逐步归属，不在局部需求中重排整个入口。新样式优先使用所属组件或功能的类名，不扩大为全局控件覆盖。
- 修改共享构件必须核对实际消费者：属性行覆盖项目创建/提升/侧栏、任务侧栏、文档/知识库；标签覆盖新建任务、任务和文档；评论覆盖任务、项目和人工更新评论。各自保存失败、草稿、切换和重开仍由业务测试保护。

- 页面决定属性栏放在哪里、显示哪个对象、何时允许操作。窄窗沿用各页面的滚动布局，值列可以收缩，长只读值换行。文档与知识库可向右滚动至属性栏。
- [共享属性样式](../../apps/desktop/src/renderer/ui-design.css) 使用 `inspector-disclosure`、`inspector-property-row` 和 `inspector-property-label`。属性与领域区使用原生 `details/summary`，项目创建表单复用属性行。紧凑行用固定标签列和弹性值列，平时无边框。只读项保留 `dl/dt/dd` 语义。
- 使用语义主题变量 `--ink`、`--muted`、`--active` 和 `--line` 表达值、标签、悬停和分隔线。Tab 焦点用可见轮廓，原生折叠支持键盘开关，禁用值以弱化文字呈现。正在保存、失败和恢复提示由对应表单提供。
- [项目属性与领域](../../apps/desktop/src/renderer/projects/ProjectFields.tsx) 复用于新建、从任务提升和项目侧栏。[项目保存](../../apps/desktop/src/renderer/projects/ProjectPropertyEditor.tsx) 保留属性确认与归档职责。[任务属性](../../apps/desktop/src/renderer/ui/TaskProperties.tsx) 保留状态、日期、负责人和标签保存，[任务归组](../../apps/desktop/src/renderer/projects/TaskProjectAction.tsx) 继续管理所属项目。[文档与知识库属性](../../apps/desktop/src/renderer/ui/DocumentInspector.tsx) 展示只读属性，由 [文档目录](../../apps/desktop/src/renderer/ui/DocumentLibrary.tsx) 管理文档标签保存。

现有回归入口包括 [项目属性](../../apps/desktop/src/renderer/projects/ProjectFields.test.tsx)、[任务属性](../../apps/desktop/src/renderer/ui/TaskProperties.test.tsx)、[任务归组](../../apps/desktop/src/renderer/projects/TaskProjectAction.test.tsx)、[文档与知识库](../../apps/desktop/src/renderer/ui/DocumentLibrary.test.tsx) 和 [隔离 Electron 探针](../../apps/desktop/src/main/project-demo.ts)。

任务字段专题中的团队权限、自定义字段等候选，以及起草专题中须由各自 Issue 接线的选材、来源和交付步骤，按对应合同和运行证据判定。属性栏的共享外观只覆盖本节所列页面。
