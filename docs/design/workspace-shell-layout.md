# 工作台导航与统一尺寸｜DEV-1729｜2026-11-05

本轮用户要求覆盖此前全局顶栏与品牌副标题设计。唯一结果：五项一级导航共用无顶栏工作台，左下头像、称呼及设置入口，内容区域尺寸统一。

- 一级导航仍为首页、任务、项目、文档、知识库。品牌只显示 logo 与 CaseLite。
- 设置位于导航栏最底部，整块头像/本地用户/设置可点击；折叠后头像仍可进入设置。当前称呼与头像为本地默认值，非账户服务或资料编辑功能。
- 移除全局搜索、独立演示标记、橙色新建按钮和右上头像整条工具栏。列表搜索框与页面“新建任务”按钮均删除；新任务统一从首页 Agent 输入目标后点击“创建本地任务”进入。隔离演示标记随左下设置显示。
- 栏宽唯一入口为 `apps/desktop/src/renderer/ui-design.css`，集中原视觉与布局规则，由 webpack 打包成同名本地资源，工作台只加载这一份 UI 设计文件。默认1920×1080下：导航200px，右栏300px，中央弹性1420px。窗口≤1250px时导航180px，右栏250px；中央最低340px，极窄窗口允许横向滚动。折叠导航65px。
- 首页、任务、文档、知识库与项目列表共用布局。任务路径栏归入中栏，右侧栏从工作区顶部起。知识库只补统一壳、属性/AI切换和诚实空态，不代表知识功能已接入。
- 复用既有 Task、Yjs、IPC、数据库、未保存离开保护及设置中心。无新依赖、存储迁移或网络能力。

参考 [WorkBuddy 设置说明](https://www.workbuddy.ai/docs/zh/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/System-Settings) 的头像→设置入口层级；实际位置以用户本轮指定左下为准，未复制第三方代码。

## 验证与边界

`pnpm check:quick`、`pnpm test:integration`、`pnpm package`；`node scripts/check-task-body-demo.mjs` 执行实际 Electron 新建、保存、拒绝未保存导航、切换、SIGKILL重开、设置返回，逐张截图检查顶栏/新建按钮/搜索框消失、头像设置位于底部及统一三栏尺寸；任务/文档/知识库与同视口首页对比中栏与右栏完整边界。1920×1080为桌面模拟视口、100%缩放、DPR2，不宣称实体1080p显示器测试。

初次桌面验证在 document.hasFocus() 前置超时；保留失败目录。测试只主动聚焦隔离应用和 webContents，保留原严格焦点、格式、保存断言。依据 [Electron app.focus](https://www.electronjs.org/docs/latest/api/app#appfocusoptions) 与 [webContents.focus](https://www.electronjs.org/docs/latest/api/web-contents#contentsfocus)。

项目详情几何、实体触控/双击手感、知识库后端与用户视觉接受不能据此自动验收。回退采用本轮独立提交的 git revert，不回滚用户数据库。
