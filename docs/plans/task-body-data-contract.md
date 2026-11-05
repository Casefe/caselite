# DEV-1577｜首片最低身份与正文绑定

> 本文冻结最初Task＋成果正文的最低合同。后续catalog支持可选matter_id；ADR-007引入任务内容objective_state及宿主派生objective，ADR-011增加Run历史。它们不能被下文原“为空／不创建Run”误解为当前未实现。现行02／DEV-1704要求独立Document说明，当前ADR-007表示差异仍归原Owner对齐；保留格式及历史，不在本说明中代改Schema或宣布1704完成。

来源：现行02/03 C2026-11-05-TECH8，DEV-1577当前执行合同。范围：独立Task＋一个成果Document/正文；多文档、归组、日期及对话消费者后续扩展。实现消费者1590/1599/1623，页面消费1576/1592。

- WorkItem为代码Task唯一身份，UUID稳定；Matter为空。本机宿主确定local工作区，无账号但每次Query/写入仍校验所属工作区，不信任Renderer传actor。
- Task持title、结构化objective、对象version与时间；Document持稳定id、Task归属；body持稳定body_id、Document绑定、editor_schema=1与已保存body_revision。目标不是正文镜像。
- 正文保存完整Yjs二进制，Tiptap默认XmlFragment为内容；不得用HTML/JSON作为第二正文真源。body_revision为磁盘提交修订，非state vector；每次保存附原绑定及expected_revision，旧修订拒绝，旧已保存二进制保留。
- 协议版本1、对象version、正文revision、editor_schema、数据库迁移版本分别表达。未知Schema拒绝读取为可写文档，不改原二进制。版本迁移仅增版本，复用已有Drizzle迁移runner，旧toolchain_probe保留。
- 元数据、正文绑定、持久幂等结果与必要Activity同SQLite事务；失败整体回滚。WAL/FULL验证进程终止重启；不承诺断电、介质损毁或未确认输入强杀后不丢失。
- 未发送/未保存输入只在当前编辑会话，离开须保存或取消离开；消息归1699，Run/候选归1580/AI，材料归1579；本轮不预建这些表、不创建Run。

正式可执行DTO见packages/contracts/src/task.ts。绑定错Task/Document/body拒绝；A/B隔离、重复请求、旧修订、未知Schema、失败回滚和重启由真实实现验证。此合同本身不证明产品功能通过。
