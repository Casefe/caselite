# 四页三栏工作台

本轮用户明确：首页参考 GitHub；任务参考 Linear My issues；项目参考 Linear Projects；文档参考 Notion 文件列表。统一左侧一级导航、中间主要工作区、右侧属性。任务、项目、文档右侧有 AI 标签；首页 Agent 在中间。保留既有「知识库」导航、收藏、獬豸标志和 1920×1080 设计基准。

本轮主 Owner 为 DEV-1729，共用布局由任务/文档/项目页面消费。基线 bbaae5e。仅修改渲染展示、选择交互与隔离演示检查，不改变 SQLite/Yjs、IPC、AI 运行协议、凭据或存储。

## 页面行为

| 页面 | 中间区域 | 右侧 | 数据边界 |
| --- | --- | --- | --- |
| 首页 | Agent 输入、工作建议、继续工作 | 工作区属性与能力说明 | 复用 assistant-ui / Pi 入口，仅发送预览确认的输入 |
| 任务 | 紧凑任务列表、正文修订筛选 | 所选任务属性 / AI | 真实 Task，单击选中，双击、Enter 或右栏打开 |
| 项目 | 项目列表 / 看板 | 示例项目属性 / AI 入口说明 | 仍为明确标记的示例，不伪造持久化；项目 AI 上下文待接入，可转首页 |
| 文档 | 名称、关联任务、正文修订、更新日期 | 文档属性 / 关联任务 AI | 展示现有 Task 成果正文；不是已实现文件导入/归档。打开复用同一正文 |

筛选后右栏只指向当前结果内的条目，无结果时显示空态。文档搜索保持在文档页面。AI 会话沿实际 Task ID 隔离；文档与所属任务共享已有会话，不自动发送正文。切换、离开和重开继续经过原未保存保护及持久化接口。

## 参考取舍

- [GitHub dashboard](https://docs.github.com/en/account-and-profile/reference/personal-dashboard)：采用中央提示输入与后续工作列表的层次；不复制代码仓库、云代理任务等业务含义。官方新版尚为预览。
- [Linear My issues](https://linear.app/docs/my-issues)：采用紧凑页签和列表；本地 Task 未支持的负责人、优先级、期限不作虚假字段。
- [Linear Projects](https://linear.app/docs/projects)：采用项目列表、概述和属性的结构；示例状态不冒充已接线业务状态。
- [Notion lists](https://www.notion.com/help/lists)：采用文档名称优先、属性在右、打开条目编辑的方式。

全部为独立实现，未复制第三方源码或商标。普通布局调整无需新增 ADR。

## 验证和回退

适用验证为 check:quick、integration、macOS package、task-body-demo（实际Electron创建/保存/强退重开、四页三栏和筛选选中）、agent-demo（实际SDK＋合成provider），截图仅合成数据。原生窗口演示串行运行，避免焦点争抢。测试断言及实际 diff 由独立上下文复核。UI偏好仍需用户查看，真实模型请求不在此轮自动发送。

失败时保留用户数据库；可按本次提交反向应用展示层变更。没有迁移、删除或远端发布动作。
