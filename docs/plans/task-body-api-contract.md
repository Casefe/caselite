# DEV-1582｜首片唯一Task接口

> 原最低接口的设计快照，实际签名以task.ts为准。后续objective_state、catalog项目归组和Agent历史在各自已存在公开门面增量；不由旧“当前不建Run”推断现有能力。原Matter/Anchor探针和正式Task/正文仍分开。

来源：DEV-1582当前EXEC2/TECH8及DEV-1577最低数据合同。正式入口是固定`caselite:task:v1`通道，Preload的task(request)只暴露该Application门面；不是通用SQL/文件调用或第二业务Router。现有Matter/Anchor工程接口不复用为Task持久化，不宣称探针为产品能力。

可执行校验与响应：packages/contracts/src/task.ts；Application入口：packages/application/src/task-application.ts。

| operation | 最小输入                                                                           | 成功结果                                                               |
| --------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| create    | title、objective；protocol_version=1、request_id、idempotency_key                  | 唯一Task/Document/body身份、初始对象版本与正文revision=0、receipt      |
| update    | Task ID、expected_version、title、objective及写入身份                              | 同Task身份、新对象版本；不改正文                                       |
| list      | 协议版本                                                                           | 当前可信本机工作区内Task列表；不创建Run                                |
| read      | 协议版本、Task ID                                                                  | Task元数据/绑定、正文revision/Schema及Yjs二进制；不创建Run             |
| save      | 原Task/Document/body绑定、expected_revision、editor_schema=1、完整二进制、写入身份 | 原绑定、新磁盘正文revision及receipt，不确认后续未提交输入              |
| status    | 协议版本、原idempotency_key                                                        | 原操作持久结果；未知结果返回NOT_FOUND，UI保留结果未知，不伪报失败/成功 |

request_id仅诊断一次请求；业务幂等按可信工作区＋操作及idempotency_key绑定内容。换request_id同键同内容返回原结果；同键异内容拒绝CONFLICT。幂等结果与数据/必要活动同事务，回执丢失先查status，不能盲建新对象。

Renderer不得声明actor/工作区、路径或SQL，严格Schema拒绝未知字段；main验证活跃顶层frame，Application消费宿主配置的本地工作区Port，SQLite每次读写包含范围和绑定校验。合法UUID不授予跨Task/body权限。

错误区分INVALID_REQUEST、FORBIDDEN、NOT_FOUND、CONFLICT、WRITE_FAILED、READ_FAILED、RESULT_UNKNOWN。IPC超时/响应未知保留原键先查询，不能用新键重放；返回错误不包含堆栈、绝对路径或正文。仅结果确认成功后UI显示保存，重复请求先核对原内容再判断预期版本。

后续1699持续对话、1700提升、1600状态、提醒及完整筛选由消费者扩展同一门面，当前不建表/Run。接口设计通过不证明SQLite/桌面已接线；未知Schema与旧修订反例在实际持久化中验证。
