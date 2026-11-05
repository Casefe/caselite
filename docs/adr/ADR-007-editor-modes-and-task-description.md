# ADR-007｜两种编辑器交互与任务说明富文本

状态：提议（实现与验证中）；来源为2026-11-05用户指定任务、Agent、项目概述、评论使用Notion-like交互，文档默认Simple交互。主实现归DEV-1732，保留各消费者数据和验收Owner。

沿用Tiptap 3.32.3（本轮核对的稳定补丁版本，四个直接包统一固定）/StarterKit/本地Yjs，两个UI模式共用editor_schema=1的已有节点集，不引入付费模板源代码、账号、云Provider或第二套编辑内核。Notion-like实现空行斜杠菜单、选区格式栏和块操作；文档Simple采用常驻格式工具栏。它们是CaseLite自行实现的交互，不宣称安装了官方商业模板或其全部功能。

任务说明需要保存格式，不能把富文本输入静默降级为纯文本。因此增量扩展现有Task Application请求：create/update可携带objective_state（同Schema的Yjs完整状态）；read额外返回objective_state。新增task_objective_revisions，以Task ID及Task version固定不可变说明状态，与元数据、回执、Activity同SQLite事务。task_items.objective对于富文本说明只作服务端重建的纯文本检索/列表投影；旧任务未升级说明时继续使用原纯文本，不改原成果Document/body身份或revision。本决定在新增富文本说明范围覆盖ADR-006“仅结构化objective”的旧限制。

旧客户端可继续创建/编辑纯文本任务；已含富文本说明时，旧客户端如果改变纯文本目标而不携带状态，拒绝以防格式丢失；仅改标题且目标不变时保留原状态。新增读写均验证Yjs结构与4000字符投影上限。格式损坏、旧version、跨工作区、回执未知和事务失败不得覆写旧说明。

Agent目标为会话草稿，离开首页保留完整二进制状态；转任务时把同一状态交Task创建事务。项目概述/评论仍是明确标记的非持久化示例，只演示富文本输入与当前会话反馈，不构造正式协作数据或调用付费Comments扩展。正文保存沿用原Yjs回执，不将HTML/JSON存成第二真源。

验证旧库迁移、说明格式重开、幂等/冲突/跨工作区、说明事务故障回滚、旧客户端保护；真实Electron验两种模式、斜杠/选区/块操作、中文组合输入保护、保存和强退重开。未验证能力据实记录。

兼容仅指新版服务端接收旧请求格式，不保证仍驻留的旧可执行程序并发写同一工作区；旧版本含未保存输入的正常窗口不强退，本轮产品演示使用独立数据目录。

真实Electron创建测试发现：已安装的`@tiptap/y-tiptap 3.0.12`在块转换时新增`__tiptap_position_migrations:root:default`辅助Map。只对这个精确根及version=1位置记录、数值身份、向量和转移结构做有界校验；未知根/格式继续拒绝，保留二进制位置历史，不丢弃它以绕过校验。正文节点与editor_schema=1不变，旧二进制对新增辅助根可能拒读，故不可同时使用旧程序写升级后的工作区。纯文本投影按Tiptap块分隔与硬换行规则派生，标题、引用/列表和尾段均做真实编辑器往返验证。

保持Electron现有CSP，关闭Tiptap运行时style标签注入；排版样式由打包CSS提供，不放宽script/style-src。

## 来源与采用边界

官方文档：https://tiptap.dev/docs/ui-components/templates/notion-like-editor 、https://tiptap.dev/docs/ui-components/templates/simple-editor 、React composable API、Collaboration及insertContentAt。按tiptap技能更新参考main，tiptap `0074302`，tiptap-docs `e13321ab`。只参考文档/API与交互，未复制模板或第三方实现；官方Notion-like需Start计划，Simple为MIT，二者不是运行时自动切换开关。当前UI自研常用交互子集；图片、链接、颜色/高亮、表格、提及、云AI/协作均不因模式名称而启用。

后果：任务说明完整状态增加本地历史体积；只做显式修订追加，无自动删除。若未来扩展节点，先同步Schema/迁移及恢复测试。回退应保留已升级数据库和Yjs二进制，撤回UI不降级覆盖富文本；旧程序同时写原工作区不在已验证范围。
