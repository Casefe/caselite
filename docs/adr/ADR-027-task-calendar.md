# ADR-027：Task 日历元数据与共享查询

状态：DEV-1824 提议；先运行隔离迁移 Spike，再实施，最后由主控独立复核。

## 范围与依据

唯一结果为正式日历、首页同源重要事项与同Task属性。Issue updatedAt 2026-11-09T00:16:42.606Z；基线24aa17c；现行02/05/06更新分别2026-11-09T00:38:13.754Z（TASK-CALENDAR已实时回读）、2026-11-08T12:44:25.939Z、12:44:28.884Z。沿Task/SQLite、Document/Yjs、Reminder原Owner；不增加外部同步、附件或法律计算。无外部源码/新依赖。

## 决定

在task_items增量固定列保存计划日、同日时段日期/起止时刻/IANA时区、明确重要标记/类型ID、关注日期来源及自选日期/时刻。Task DTO增加可选calendar值；旧请求/历史回执省略时保持兼容，不改旧摘要。普通date-only不转UTC；时段是人工工作安排，不借用Reminder instant，也不据此生成通知。单一时段不支持跨夜/循环；按记录日期聚合，UI显示保存的IANA时区，不承诺跨时区日期投影。自选关注时刻未记录时区时明确标注，不能冒称本机时刻；只有可确认与本机时区一致的工作时段才按本机当前时刻标为已过时点。非目标必须明确。

类型是工作区结构化配置：稳定ID、名称、enabled、show_home、version；12个内建定义缺配置时只读提供version0，写配置才落库，自定义为新ID。停用仅阻止新的引用，保留已有Task引用和历史；首页显示独立。不存第二份重要事项数组。查询范围沿既有Task工作区读取，Document或Project的归档不被另行推导为Task归档。

继续使用既有严格Task请求Schema→Preload/可信发送端IPC→Task Application→SQLite。update_calendar沿原预期Task version、task_activity和task_receipts同事务；set_calendar_type沿同工作区原键回执/摘要及类型版本同事务。未知结果保留原请求先status原键，再read当前值，不用历史ACK覆盖新值。

calendar_query在当前工作区全部Task范围执行重要/所选日期/仅时段/无日期/日期计数查询，限页与稳定排序；不依赖已有任务页20行、首页recent或Renderer直接读库。首页和日历使用同Query key/取消迟到读取/失效策略及同重要行组件；根据用户增量，明确标重要的自选关注日也参与当天Task与日计数；自选关注时刻参与左下时点安排，不伪造结束时刻。日计数按Task ID合并截止/计划/时段/重要关注日，同一Task只计一次；左下仅时段且日期匹配。普通日期、重要关注日和提醒互不覆盖。

UI复用TaskInspector、TaskProperties、TaskContentEditor、SidebarAgent（按Task ID隔离），所有导航走原草稿/未知回执守卫。原ReminderInbox保留为日历可达入口，不改其计划/已读。Google/EventKit仅显示未接入，不放模拟同步进产品。

## 迁移、验证与回退

0020为追加迁移，0000—0019字节不变。Drizzle snapshot由现有CLI在仓库外从0019生成；实际SQL采用同约束的追加列/表，拒绝生成SQL中的Task重建/关闭外键方案。最小WAL ALTER/一致性backup及故障回滚Spike已通过（2026-11-09，calendar-spike.test.ts）；正式迁移与产品仍待后续检查及独立复核。先用20项迁移的合成库及一致性backup验证WAL下ALTER/回滚，再测实际20→21升级：旧Task/Document/body/回执/提醒逐值不变，故障DDL不留下半迁移，重开读回，外键/integrity检查，事务活动/回执故障、跨workspace及陈旧版本拒绝。现有旧迁移测试读取路径仍可用，不以新列破坏旧fixture。

代码回退保留0020和已保存列/类型及读取能力；旧应用不得删除/反向迁移新库。升级真实验收库前由主控先保全一致性备份，使用隔离合成工作区完成真实Electron验证。rollback不删除Task、Yjs、原件、提醒或凭据。

允许路径为Issue列明的contracts/application/local-db、main/preload、日历/Home/Inspector/Settings必要消费者、样式/测试/probe与本ADR；不改规则/CI/依赖。验证为quick/review/security/integration、唯一Forge打包、真实IPC/SQLite重开及640/1440，真实Provider调用0。高风险迁移/协议由主控独立审查，工程通过不等于律师接收。
