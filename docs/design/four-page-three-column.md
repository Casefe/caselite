# 五页三栏工作台

本轮用户明确：首页参考 GitHub；任务参考 Linear My issues；项目参考 Linear Projects；文档参考 Notion 文件列表。统一左侧一级导航、中间主要工作区、右侧属性。任务、项目、文档右侧有 AI 标签；首页 Agent 在中间。保留既有「知识库」导航、收藏、獬豸标志和 1920×1080 设计基准。

布局由 DEV-1729 维护。2026-11-05 用户授权在该布局上接通数据，目录增量见 ADR-010（605ad99），AI 运行记录见 ADR-011；当前页面不再使用示例项目和空知识库占位。

## 页面行为

| 页面 | 中间区域 | 右侧 | 数据边界 |
| --- | --- | --- | --- |
| 首页 | Agent 输入、工作建议、继续工作 | 工作区属性与能力说明 | 复用 assistant-ui / Pi 入口，仅发送预览确认的输入 |
| 任务 | 紧凑任务列表、正文修订筛选 | 所选任务属性 / AI | 真实 Task，单击选中，双击、Enter 或右栏打开 |
| 项目 | 本地项目列表、创建和概述编辑 | 真实属性 / 选择项目内Task后使用AI | Matter与说明Yjs已接SQLite，归组保留原Task身份；看板和评论待后续 |
| 文档 | 真实Document目录、收藏、归档与恢复 | 文档属性 / 关联任务 AI | 同一Document/body，归档只读，恢复保留身份 |
| 知识库 | 选定Document的分类/标签/收藏组织视图 | 原文档属性 / 关联任务AI | 与文档库共用原文，无第二正文；固定修订沉淀复制由1701/1702另验 |

筛选后右栏只指向当前结果内的条目，无结果时显示空态。分类、收藏与归档筛选读取本地元数据。AI 会话沿实际 Task ID 隔离；文档与所属任务共享已有会话，不自动发送正文。切换、离开和重开继续经过原未保存保护及持久化接口。

## 参考取舍

- [GitHub dashboard](https://docs.github.com/en/account-and-profile/reference/personal-dashboard)：采用中央提示输入与后续工作列表的层次；不复制代码仓库、云代理任务等业务含义。官方新版尚为预览。
- [Linear My issues](https://linear.app/docs/my-issues)：采用紧凑页签和列表；本地 Task 未支持的负责人、优先级、期限不作虚假字段。
- [Linear Projects](https://linear.app/docs/projects)：采用项目列表、概述和属性的结构；示例状态不冒充已接线业务状态。
- [Notion lists](https://www.notion.com/help/lists)：采用文档名称优先、属性在右、打开条目编辑的方式。

全部为独立实现，未复制第三方源码或商标。普通布局调整无需新增 ADR。

## 验证和回退

适用验证为 check:quick、integration、macOS package、task-body-demo（实际Electron创建/保存/强退重开、四页三栏和筛选选中）、agent-demo（实际SDK＋合成provider），截图仅合成数据。原生窗口演示串行运行，避免焦点争抢。测试断言及实际 diff 由独立上下文复核。UI偏好仍需用户查看，真实模型请求不在此轮自动发送。

失败时保留用户数据库；可按本次提交反向应用展示层变更。当前版本包含追加迁移；回退见 ADR-010/011，不删除用户数据。
