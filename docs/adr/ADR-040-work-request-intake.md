# ADR-040｜本机工作请求收件与人工分拣

- 状态：提议（DEV-1896 隔离试做，未合并，待人工确认）
- 日期：2026-11-16
- Linear Issue：[DEV-1896](https://linear.app/logixy-ai/issue/DEV-1896)
- 影响模块：contracts、application、local-db、desktop preload/IPC/收件页
- 责任与人工确认：谭辉负责产品取舍与业务接收；本记录不代替该接收
- 代码位置与提交：`packages/local-db/src/intake-store.ts` 与迁移 `0036_work_request_intake`；提交以本分支为准
- 基线：`d5307fcb704c194a3698c2e35e85aa8b1af1417d`（origin/main）
- 合同：现行01 `68e0ba6c-88b7-48f3-af95-6465245084f3`、现行02 `05e230ae-e2b6-4841-be0f-c626c6583749`、现行06 `d8addbc1-493d-4edc-8095-04982b70ae76`。本试做未改这些合同。

## 背景与问题

尚未采纳的工作请求需要一个收件区，由人接受、拒绝、暂缓或标成重复，然后进入或关联已有 Task。请求不能因为被记下来就变成案件、委托或正式 Task。

已核对创建附件草稿（`material_stages` 里的 creation draft）。它的状态是 open/bound/finished/discarded，负责暂存附件并在创建 Task 时绑定。它没有 pending/accepted/rejected/snoozed/duplicate，也不能表达“先拒绝、草稿仍留给原主”。因此本片不把草稿表当成收件记录。草稿仍由材料 Owner 持有；收件只保存草稿 id。

Plane `makeplane/plane` `ea63ca8` 的 intake 模型与 inbox 界面是 AGPL-3.0-only。本片没有读取、复制或改编那些源码。状态名来自 DEV-1896 已写明的分拣结果。

## 必须满足的不变量

- Renderer 只经 `caselite:intake:v1` 的 preload/IPC 进入 Intake Application，再进入同一 SQLite 连接上的收件存储。
- 接受并新建 Task 时，调用原 Task 存储的 create。请求行、Task、附件绑定和两边回执在同一事务里提交；更新失败或进程中断时不留下半个 Task。
- 同一请求第二次接受返回已绑定的 Task，不插入第二行。
- 拒绝、暂缓、标重复不绑定、不丢弃附件草稿。
- 暂缓时间已过时，列表可以标成“该重新看”，状态保持 snoozed，不自动接受。
- 不能把请求标成自己的重复，也不能把已经是重复的请求再串成链。其他工作区的任务或请求拒绝关联。
- 不更新 matters 的状态、归档或版本。可选的 matter_id 只沿用原 Task 创建去归组。

## 候选方案

| 方案                                    | 优势                                  | 风险/成本                                  | 证据                                                             |
| --------------------------------------- | ------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------- |
| A 复用创建草稿                          | 少一张表                              | 草稿状态和分拣状态冲突，拒绝时容易丢掉附件 | 已读 `material-creation-draft.ts` 与 `material-store.ts`，不采用 |
| B 本机 `work_requests` + 原 Task create | 请求在接受前不是 Task；创建路径不复制 | 新增迁移和回执                             | 本分支迁移 0036 与集成测试                                       |
| C 复制 Plane intake                     | 现成模型                              | AGPL，且进程和权限模型不同                 | 按 ADR-005 不采用，未取源码                                      |

## 决定及原因

隔离试做采用方案 B。正式是否保留这张表，等人工看过试做结果再定。本 ADR 因此仍是提议。

## 验证与交付

- 命令和退出码写在本轮试做记录，不在这里声称未跑的检查已通过。
- 迁移只新增 `work_requests` 与 `work_request_receipts`，不改已有 Task 行。
- 回退：撤回本分支提交，不删除已有库里的其他表。已执行过 0036 的本地库会留下空的新表；不回滚已应用迁移，不删除原任务、正文、原件或凭据。

## 后果与重新评估条件

外部邮箱、网页、客户公开入口、自动分派和材料外发都不在本片。若要增加来源或自动接受，须另获准入，不能把 snooze 到期解释成接受。
