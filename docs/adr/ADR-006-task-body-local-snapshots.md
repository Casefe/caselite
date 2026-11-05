# ADR-006｜独立Task与本地正文首片

状态：首片实现候选；实际通过范围以测试和打包演示记录为准。来源：DEV-1577/1582、现行02/03 TECH8及2026-11-05用户明确要求实现Task＋正文。首片不涉及账号、云、AI/OCR或真实客户材料。

## 选择与不变量

采用现有SQLite/Drizzle连接与增量迁移，Task元数据、Document/body绑定、不可变正文修订、业务幂等结果与必要Activity同事务。正文采用完整Yjs二进制，当前量级上用快照换取恢复与顺序处理的简单性；暂不增加增量日志/压缩器。WAL、synchronous=FULL及foreign_keys=ON；只验证进程退出/强退，不承诺设备断电或介质损坏。

保存携带原绑定、expected_revision和editor_schema=1；拒绝错绑定、未知结构及旧修订。回执绑定原body与磁盘revision；UI继续输入r2不能被r1回执确认。Yjs可解码不代表当前Schema兼容，读/写均验证default XmlFragment及启用节点/marks；失败保留原二进制，新增格式须同步Schema与回归。

Task目标只用结构化objective；成果Document/body是独立身份，当前每Task只提供一个成果编辑入口。未实现的多成果、富文本任务说明、日期、提升、Run、材料和导出留各自消费者，不预建对应表。

## 采用与来源

Tiptap React/pm/StarterKit/Collaboration统一固定3.32.2；Yjs固定13.6.33。Collaboration只绑定本机Y.Doc，无Provider/网络；禁用StarterKit UndoRedo避免双历史。源码只作为API参考，不复制第三方实现。参考官方tiptap-docs的editor/getting-started/install/react及extensions/functionality/collaboration，核对extension-collaboration源码的document/field/UndoRedo规则；准确依赖及许可证见锁文件和实际licenses:report。

未采用HTML/JSON权威、localStorage临时正文、另建ORM/Runtime/云Provider。完整Yjs状态会增加历史体积；首片保留所有修订，没有自动删除或后台压缩。后续按真实样本量与耗时再评估增量日志和显式保留策略。

## 验证与恢复

契约验证严格参数及宿主身份边界；真实隔离SQLite验证同键重试/冲突、原修订保留、跨工作区/错绑定拒绝、事件写失败整体回滚、未知结构拒绝、迁移失败保全及重开。打包演示另验实际UI创建、中文编辑、保存、进程SIGKILL及重开，不能由Node存储测试替代。

回退不删除数据库：保留旧库与新迁移记录，优先前进修复；旧构建不具备新Task读写能力，不能称为数据恢复。原件及已确认基线不改。当前没有生产客户数据；版本不兼容时停止写入并明确提示，不做自动降级覆盖。
