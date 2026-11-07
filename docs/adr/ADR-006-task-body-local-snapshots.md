# ADR-006｜独立Task与本地正文首片

> 原首片决定保留追溯。任务内容与编辑器后续由ADR-007扩展，项目及目录由ADR-010扩展，Run历史由ADR-011扩展；原“只用结构化objective／尚未实现”不代表当前事实。当前任务内容的Yjs/投影不冒充现行02／DEV-1704的独立Document说明，表示差异需原Owner明确；此注不授权破坏性迁移。

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

## DEV-1600｜普通任务状态增量（2026-11-07）

状态：实现候选，验证结果另留本卡。Task增加todo/in_progress/done/canceled四态，旧行默认todo，不根据正文、Run或交付推断。只允许用户显式转换，四态间可重新选择；同状态请求不写新版本/活动。原task:v1增加change_status，沿原Task Owner、workspace校验、expected_version及同事务幂等/活动；不改项目、正文、Run、材料或法律确认。

0006采用单条ALTER ADD COLUMN与列级CHECK，不重建Task表、不关闭外键；生成器的重建表SQL会引用旧库不存在的status，故保留生成snapshot而人工核对等价增量SQL。0000—0005及旧对象ID、正文、版本、时间、归组和回执不改。响应schema对缺status的历史回执补todo，旧请求shape/digest不加默认值；原键核对后重读当前Task，不能拿旧回执快照覆盖当前状态。

UI属性草稿/未决提交与正文dirty分别跟踪，不能以属性保存清正文草稿。旧库、失败迁移、同键/异内容、版本及workspace冲突、事件/回执故障、正文保全与重启均须真实隔离验证；不在正在运行的默认用户库演练。回退代码保留新列/已提交状态，不DROP或重置迁移；需要恢复旧备份时仅在隔离副本核验，并明确备份之后的新写入不能悄悄丢弃。此演练不代表完整产品备份功能通过。

## DEV-1601｜普通优先级与日期（2026-11-07）

原Task增加priority（0未设置、1紧急、2高、3普通、4低）与nullable due_date。日期是0001—9999的真实YYYY-MM-DD字面值，不转换UTC时间点、不推算法定期限或自动提醒。单人负责人显示本人，不增加团队分派Owner。

task:v1新增strict update_attributes，要求两个字段显式出现；沿原workspace、expected_version、原键回执、Activity同事务。旧create/update/save/change_status的请求及digest不加默认值；仅响应解码历史回执补priority=0/due_date=null，确认后仍须重读当前Task。新0007用两条ALTER ADD COLUMN及具名CHECK，保留0000—0006和旧行ID/正文/状态/版本/时间/回执。生成器重建SQL留隔离证据，snapshot按同一约束核对。

UI复用原属性草稿和未知提交恢复，一次只编辑状态或普通属性，原提交未决时不切换对象。设置、清空、闰年、过去日期、时区字面值、旧请求保留、迁移和事务故障需分验。回退只撤代码，保留新列/迁移与已保存数据，不降级覆盖。系统时区、中文IME和律师体验另记人工验收。

## DEV-1605｜Task列表查询（2026-11-07）

原task:v1的list增加strict query，明确当前workspace或project范围；旧无query入口仍仅当前workspace兼容。标题/说明使用原SQLite投影参数化检索，状态/优先级/普通日期/正文、排序均白名单，20项分页并以id打破同值排序；项目每次验证当前workspace与归档状态。不建FTS或第二Task缓存Owner。返回page元数据仅为查询投影，不写Activity或Run。

UI会话内保留query/选中ID/滚动位置，属性未决时禁换范围；每次查询清楚显示loading/error，旧异步响应失效，已保存变更通过原Task读回使列表重查。筛选不是授权，Store仍做workspace/project检查。跨页是当前数据的offset分页，不宣称并发快照；回退只撤代码，无数据迁移。

## DEV-1778｜任务标签与属性自动保存（2026-11-07）

0012 在原 `task_items` 增加 `tags`，默认 `[]`，SQLite 约束校验数组形状与数量，Task 合同校验每项的文本与长度。迁移使用增量 ALTER，保留旧任务身份、正文修订、关联及回执。任务新建与 `update_attributes` 可显式带标签，旧更新省略时保留现有值，显式 `[]` 才清空。旧请求摘要与历史回执保持可读。

自动保存按已确认版本串行处理变更，仍使用原状态和属性操作及同事务活动、回执。结果未知时先查原幂等键。已确认回执只用来证明提交，随后重读当前任务。冲突时保留输入并停止后续写入。回退只撤功能代码，保留 0012 迁移和标签列。若需恢复旧备份，在隔离副本核验恢复点与后续数据。
