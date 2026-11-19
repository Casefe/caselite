# ADR-040｜项目任务分组、目标日期与模块进度对账

- 状态：提议，试做验证，等待原生验证与业务接收
- 日期：2026-11-16
- Issue：DEV-1891（相关：DEV-1604、DEV-1603、DEV-1712）
- 差异标识：PLANE-GAP-20261111/module_progress
- 基线：d5307fc，CaseLite 现行 01、02 和 06

## 背景与问题

Plane 存在 Module 概念（参考 `apps/api/plane/db/models/module.py` 与 `apps/web/components/modules`），允许为项目内一组工作项指定目标日期（`target_date`）、组织生命周期状态（`backlogged`、`planned`、`in_progress`、`paused`、`completed`、`cancelled`）及聚合完成度与进度追踪。

CaseLite 在 DEV-1604 规划了 Matter 内任务分组，在 DEV-1603/1712 与 ADR-020 中建立了本地项目里程碑（`project_milestones` 与 `task_milestones`）。本 ADR 解决在不新增第二真源与独立模块实体的前提下，如何对齐 Plane Modules 相比普通字段 GroupBy 所缺失的目标日期、组织状态与可对账进度能力。

## 决定与边界

1. **纯字段 GroupBy 不足但无需新增 Module 表**
   - 验证 DEV-1604 纯字段投影（如 `groupByStatus`、优先级、负责人）：仅在展示层对已有任务字段重新分桶，无法为分组本身指定工作包目标日期，无法管理独立的分组生命周期状态，也不能将异构状态任务聚合为统一阶段工作包。
   - 但 CaseLite 已有 `project_milestones` 及 `task_milestones` 结构，任务在 Matter 内可分配且仅分配给一个里程碑。
   - 决定不新建独立 Module 表或第二 Project 实体，避免实体膨胀、多重归属与双真源；复用现有里程碑作为任务分组工作包，并在只读视图上扩展可对账进度与组织状态。

2. **可对账进度（Reconcilable Progress）规范**
   - 分组进度通过只读聚合从现有权威状态推导，不作为冗余状态缓存落盘。
   - 细分状态计数：
     - `todo`：状态为 `todo` 的有效任务数
     - `in_progress`：状态为 `in_progress` 的有效任务数
     - `done`：状态为 `done` 的已完成任务数
     - `canceled`：状态为 `canceled` 的已取消任务数
     - `total`：计入进度的有效任务数（`todo + in_progress + done`，即非 `canceled`）
   - 内部恒等式对账：
     - `total === todo + in_progress + done`
     - 关联任务总数 `=== total + canceled`
     - 完成百分比 `percent = total > 0 ? Math.round((done / total) * 100) : 0`
   - 项目全量对账：
     - 项目总任务数 `=== 已关联里程碑任务数 + 未关联任务数`
     - 项目总完成数 `=== 各分组完成数之和 + 未分组完成数`
     - 任何分组任务数不得超出项目实际任务集合。

3. **普通组织状态（Organization Status）**
   - 分组状态为普通工作组织状态，不引入法律阶段含义、法定期限或审批流权限。
   - 组织状态推导：
     - `archived`：`archived_at` 非空
     - `completed`：`total > 0 && done === total`
     - `in_progress`：`in_progress > 0 || (done > 0 && done < total)`
     - `planned`：其他情况（含全部待办或空分组）
   - 逾期判定：当 `target_date < today && status !== 'completed' && status !== 'archived'` 时标注已逾期。

4. **严格的作用域与原件保护**
   - 跨作用域拒绝：`assign_milestone` 必须校验任务与里程碑属于同一项目与同一工作区；跨 Matter 关联直接拒绝（`NOT_FOUND`）。
   - 保护原件与身份：解绑任务、归档或删除里程碑绝不删除 Task 实体、Task 正文或材料附件；任务的主项目归属（`task_projects`）不受里程碑解绑影响。

5. **界面交互与直达原任务**
   - 在项目计划（`ProjectPlanning`）面板，每个里程碑分组清晰展示：分组名称、目标日期、组织状态徽标（规划中／进行中／已完成／已归档）、逾期警示、进度条与明细计数（待办／进行中／已完成／已取消）。
   - 分组内列出所有关联任务，并提供直接点击打开原任务（`openTask`）的直达链接。

## 验证与证据

- 合同测试验证 `milestoneSchema` 扩展与恒等式对账工具函数。
- 集成测试验证真实 SQLite 数据库下的细分聚合计数、状态推导、跨项目分配拒绝、故障回滚、重启持久化及幂等回执。
- 组件测试验证界面状态徽标、逾期提示、进度条构成展示以及点击打开原任务的回调触发。
