# ADR-021｜本地 DOCX 语义草稿与合并表格

- Issue：[DEV-1811](https://linear.app/logixy-ai/issue/DEV-1811)
- 授权：2026-11-08 用户六步串行迁移；本记录只覆盖第一步。
- 状态：实现及验证中；不代表律师验收。
- 原实现基线：9ff45d9。衔接基线：ab02877；适用现行02/03/06。

原件经既有 files/Application 固定字节、hash 与任务范围。Mammoth 1.13.0 在受限 worker 中读取受控字节，禁用外部文件；ZIP 条目数、展开量、XML、执行时间和内存有边界。预检后的条目由同一受控读取入口提供给锁定版本的 Mammoth，避免二次解析 ZIP 时选中未检查内容；禁用嵌入样式映射。Application 在语义转换前后核对来源范围。Renderer 只接收 HTML 投影，DOMPurify 白名单后用唯一 Tiptap schema 转 JSON、检查和预览。人工确认后仅初始化此来源所属任务的空正文，复用原有 Yjs 二进制、expected_revision、幂等回执及 SQLite 事务；已有稿不覆盖。

正式表格采用与现有编辑器相同版本 3.32.3 的 MIT TableKit；启用 table/tableRow/tableCell/tableHeader。宿主校验跨度、列宽、对齐、矩形覆盖及复杂度，并拒绝未知节点/属性。每格至少一个块，空内容仍用空段落。纯文本只是派生，不能重建或替换原始 Yjs。

本地 schema 1 保持原有编码和根。DOCX 草稿使用现有任务成果正文的表格校验，其他富文本场景继续拒绝表格。回退 DOCX 导入时保留已有正文及 ADR-022 的表格读取兼容层。多人协作/跨版本同步启用前，须另定义能力协商及拒绝旧客户端的协议；本次不把当前加性变化当同步兼容承诺。

Docmost 参考 adb2ba5076eeddcccaa55cfbb1296f104d1cce47：import service 的 HTML→JSON→Yjs 路径与统一 extensions 配置。现有 CaseLite 保存、授权和失败合同继续生效，不迁入 PostgreSQL、Redis、Hocuspocus、IndexedDB 第二正文库或企业 AI 后端。无 Docmost 源文件直接复制至本增量；参考工程保留在仓库外，源码授权不因 LLM 修改自动消失。

首版是语义草稿：段落、标题、基础列表与合并表格；图片、页眉页脚、分页、Word 修订/批注与复杂编号需核对固定原件。独立检测修订/批注，只提示存在，不推断已接受或法律确认。Mammoth 信息丢失不可由净化或 Tiptap 补回。

验证要求：真实转换与 Yjs 重开；非法/重叠/越界表格拒绝且旧稿保全；恶意 HTML、损坏 ZIP、大小限制、跨范围；固定原件 hash；真实打包桌面禁网路径，模型为 MOCK_ONLY。回退使用本卡独立差异/提交，不删除原件、历史修订或用户既有修改。

DEV-1814 补充：项目 Word 原件阅读复用同一语义阅读组件；项目另存操作仅由受信任桌面宿主处理，系统保存对话框前后均调用 `read_project`，保持项目归组校验，不降级为 task 范围读取。Application 不接收保存路径、不直接处理另存操作。输出仍为固定原件副本，使用新文件名，正文与源版本均不覆盖。
