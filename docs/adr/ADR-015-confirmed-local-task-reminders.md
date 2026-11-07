# ADR-015｜用户确认的单Task本机提醒

- 状态：提议（DEV-1686 实施中，工程检查/原生和人工验收分开记录）
- 批准：DEV-1686，本开发对话唯一写入；基线 `6c195679490546837d9196aaf5deb8db647212ba`。
- 合同：现行02/05/06固定ID，DEV-1686 `C2026-11-06-SCHEMA1` 与 `C2026-11-06-LAWYER1`；实时回读于2026-11-07。

## 问题与边界

Task普通date-only截止日不能代替已确认的提醒时刻。当前没有服务器或关机调度，不能保证退出、休眠、断电期间准时。SQLite仍拥有结构化提醒；正文/Yjs、不可变原件、Task属性及Run各归原Owner。只通过现有可信窗口Guard→typed Preload/IPC→Application→同一Task连接的Reminder Port。

## 采用方案

一个Task最多一个当前Reminder，独立稳定UUID、Task外键、workspace、日期、时刻、IANA时区、确认后的固定UTC instant。UI明确支持2000—2099年，Task普通日期的0001—9999范围不变。Application用本机Intl/tzdb取相邻偏移并反向校验本地日历字段；gap无候选、overlap显式选择。时区和候选变化后必须重新确认；系统时区变化不重新解释既有instant。未知结果先查原幂等回执；已提交schedule不因后来tzdb变化再次验证而丢失原回执。未来tzdb变化不会自动改写已确认时间点，用户需要重确认时显式改期。

`version`是所有用户修改的CAS版本；`plan_revision`只在设定/改期/取消时递增。手动read/unread不产生新投递身份，也不改变Task版本。未到期和已取消计划不能标已读。改期重置read和当前attempt投影，保留旧attempt历史；取消使旧计划失效，界面只显示当前计划/到期的已读未读，无归档功能。

新迁移0008只增三张表，不修改已应用0000—0007。命令回执、计划/版本与task_activity同SQLite事务。Reminder attempt以 `(reminder_id, plan_revision)` 唯一，在OS调用前同事务记录`unknown`和活动；崩溃间隙保守保留未知，不盲目重发。`shown`仅指OS show事件，非保证用户看到；failed/unsupported/unknown都不等于送达，任何OS事件不自动read。存储故障时不调用OS。

Main启动、5秒轮询与powerMonitor.resume补查，先核对计划再投递。通知正文不含任务名称/案件内容。ID包含userData哈希命名空间、Reminder UUID和计划修订；历史getHistory仅处理本命名空间，不能清默认工作区或其他功能通知。改期/取消关闭进程内旧对象；启动读取并关闭系统历史旧计划。历史恢复与点击均重新核对当前计划，失效或读取失败不导航、不read；当前通知点击只聚焦应用，用户从提醒页回Task。OS不允许枚举/显示时不可声称清理或送达已验。

## 候选与放弃

- 不用Task due_date自动派生：它没有时刻和确认，也不是法定期限。
- 不采用单纯内存timer：无法重启恢复和去重。
- 不把OS调用、show、click或close当read：用户阅读必须独立动作。
- 不在未知尝试后自动重发：跨SQLite/OS没有原子事务，优先避免重复；到期Inbox仍可查看，用户可显式重新设定。
- 不加入云调度、外部日历、第二Task Router/Store、额外依赖或Runtime。

## 证据与未验收

实施和检查记录写在DEV-1686开发主评论与外置1686-*证据目录；原生休眠、通知拒绝、系统通知中心历史残留的真实覆盖按实际结果标记，模拟事件不冒充系统通过。律师业务/体验接收独立进行。

官方接口参考（2026-11-07读取，未复制源码）：[Electron Notification](https://www.electronjs.org/docs/latest/api/notification)、[powerMonitor](https://www.electronjs.org/docs/latest/api/power-monitor)、[Linear Inbox](https://linear.app/docs/inbox)。本地锁定Electron 45.1.0；无需采用上游实现或新增许可证。

## 后果、回退与重新评估

恢复可能保留unknown且不再OS重试；应用内到期提醒仍显示，用户可改期重新确认。UI刷新每5秒；通知权限/专注模式/签名由系统决定。关闭应用时没有后台保证。小提交可Git revert功能接线，保留新增表和已存数据；不回滚已应用迁移、不重置/删除库。未来需多提醒、日期范围扩大、tzdb更新提示或外部调度时另获准入和迁移/兼容测试。
