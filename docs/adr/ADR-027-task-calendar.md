# ADR-027：Task 日历元数据与共享查询

状态：DEV-1824 提议；先运行隔离迁移 Spike，再实施，最后由主控独立复核。

## 范围与依据

唯一结果为正式日历、首页同源重要事项与同Task属性。Issue updatedAt 2026-11-09T00:16:42.606Z；基线24aa17c；现行02/05/06更新分别2026-11-09T00:38:13.754Z（TASK-CALENDAR已实时回读）、2026-11-08T12:44:25.939Z、12:44:28.884Z。沿Task/SQLite、Document/Yjs、Reminder原Owner；不增加外部同步、附件或法律计算。无外部源码/新依赖。

## 决定

在task_items增量固定列保存计划日、同日时段日期/起止时刻/IANA时区、明确重要标记/类型ID、关注日期来源及自选日期/时刻。Task DTO增加可选calendar值；旧请求/历史回执省略时保持兼容，不改旧摘要。普通date-only不转UTC；时段是人工工作安排，不借用Reminder instant，也不据此生成通知。单一时段不支持跨夜/循环；按记录日期聚合，UI显示保存的IANA时区，不承诺跨时区日期投影。自选关注时刻未记录时区时明确标注，不能冒称本机时刻；只有可确认与本机时区一致的工作时段才按本机当前时刻标为已过时点。非目标必须明确。

类型是工作区结构化配置：稳定ID、名称、enabled、show_home、version；12个内建定义缺配置时只读提供version0，写配置才落库，自定义为新ID。停用仅阻止新的引用，保留已有Task引用和历史；首页显示独立。不存第二份重要事项数组。查询范围沿既有Task工作区读取，Document或Project的归档不被另行推导为Task归档。

继续使用既有严格Task请求Schema→Preload/可信发送端IPC→Task Application→SQLite。update_calendar沿原预期Task version、task_activity和task_receipts同事务；set_calendar_type沿同工作区原键回执/摘要及类型版本同事务。未知结果保留原请求先status原键，再read当前值，不用历史ACK覆盖新值。

calendar_query在当前工作区全部Task范围执行重要/所选日期/仅时段/无日期/日期计数查询，限页与稳定排序；不依赖已有任务页20行、首页recent或Renderer直接读库。day保留全日Task语义，中央其他当日任务使用独立untimed查询，先排除本日时刻再计数/分页，避免超过50条时段造成空页；日期计数与列表共用已完成/取消过滤条件。首页和日历使用同Query key/取消迟到读取/失效策略及同重要行组件；根据用户增量，明确标重要的自选关注日也参与当天Task与日计数；自选关注时刻参与左下时点安排，不伪造结束时刻。日计数按Task ID合并截止/计划/时段/重要关注日，同一Task只计一次；左下仅时段且日期匹配。普通日期、重要关注日和提醒互不覆盖。

UI复用TaskInspector、TaskProperties、TaskContentEditor、SidebarAgent（按Task ID隔离），所有导航走原草稿/未知回执守卫。原ReminderInbox保留为日历可达入口，不改其计划/已读。Google/EventKit仅显示未接入，不放模拟同步进产品。

## 迁移、验证与回退

0020为追加迁移，0000—0019字节不变。Drizzle snapshot由现有CLI在仓库外从0019生成；实际SQL采用同约束的追加列/表，拒绝生成SQL中的Task重建/关闭外键方案。最小WAL ALTER/一致性backup及故障回滚Spike已通过（2026-11-09，calendar-spike.test.ts）；正式迁移与产品仍待后续检查及独立复核。先用20项迁移的合成库及一致性backup验证WAL下ALTER/回滚，再测实际20→21升级：旧Task/Document/body/回执/提醒逐值不变，故障DDL不留下半迁移，重开读回，外键/integrity检查，事务活动/回执故障、跨workspace及陈旧版本拒绝。现有旧迁移测试读取路径仍可用，不以新列破坏旧fixture。

代码回退保留0020和已保存列/类型及读取能力；旧应用不得删除/反向迁移新库。升级真实验收库前由主控先保全一致性备份，使用隔离合成工作区完成真实Electron验证。rollback不删除Task、Yjs、原件、提醒或凭据。

允许路径为Issue列明的contracts/application/local-db、main/preload、日历/Home/Inspector/Settings必要消费者、样式/测试/probe与本ADR；不改规则/CI/依赖。验证为quick/review/security/integration、唯一Forge打包、真实IPC/SQLite重开及640/1440，真实Provider调用0。高风险迁移/协议由主控独立审查，工程通过不等于律师接收。

## 2026-11-10｜预测式三栏的只读增量

本次沿用户已确认原型与主控正式交回范围，基线 `b900a7237abbd8c01ef675b6c24f97fad2bd5eed`。现行02/05/06及DEV-1824已实时回读；旧Issue中的checkout/base不作为本次写入目标。

`calendar_query` 增加 `past` 与 `future` 两个严格枚举，只读原工作区Task：past按边界日之前的截止日排序查询，界面称“日期已过·待核对”，不认定法律逾期；future查询边界日之后任一截止、计划、时段或明确重要的自选关注日期。两者沿原关闭状态筛选、50条稳定分页、全范围总数及权限绑定，不从当前页估算数量，不写Task、日期、Activity或回执。无表、迁移、存储格式或写命令变化，旧view与旧请求不变；date-only沿原本地日期比较。

月历与预测日期条合并取计数区间，跨月仍覆盖所有可见日期，同Task按日去重。中间保留时段与其他当日Task，历史截止Task从过去入口可达，无日期任务与完成/取消筛选、布局恢复仍可展开。左侧重要日期紧凑模式仅压缩呈现和条数，保留原跨日期范围及排序，未来和日期待确认事项不被默认隐藏，首页消费者不变。右侧直接使用原TaskInspector→InspectorLayout→SidebarAgent，保留原Task ID、保存回执及草稿守卫，不增加Runtime。

验证采用受影响单元/合同、真实SQLite分页/隔离/不写数据检查、quick/security/review及本轮模型/权限独立回归；真实命令结果留本机证据。GUI前台时段尚未交回，真实Electron布局/属性/AI上下文操作不得预报通过；先冻结构建与候选，待统一验收。回退本次只读接口与UI补丁，不回退数据库或删除旧数据。
