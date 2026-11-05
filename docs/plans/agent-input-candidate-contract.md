# DEV-1580｜Task内固定输入、Run与候选合同

本卡冻结现行04最低设计DTO与负例。contracts/agent-input.ts是可执行格式／纯约束，不是新Agent IPC、数据表、Provider调用或候选写入。现有agent:v1仍只发送确认的输入框文本；下面材料Manifest、新稿及对话绑定必须由1651／1654／1653／1655／1699消费者接线后才能宣称可用。

## 唯一Owner与五个最低DTO

| DTO | 唯一责任／最低字段 | 消费者 |
| --- | --- | --- |
| ProviderProfile | 稳定profile、Provider／模型匹配、宿主CredentialRef、输出上限及0自动重试；Key不入普通DTO | 1648／1652，复用现有安全凭据Adapter |
| SelectedInputManifest | 固定Task／版本／Run、逐项稳定身份和文字快照／hash、角色、来源及正文修订、排除项、确切payload、确认preview身份和Provider | 1651由Owner Query读取，1654受控工具复用 |
| WorkRun输入绑定 | run_id、task_id、manifest_id及payload hash；Run状态、事件、费用和partial仍由现有1653唯一拥有 | 1653；不持久化第二Pi session |
| ReadToolPolicy | 固定Manifest、只读选中Document／Source／Task消息白名单，无发现／Effect | 1654；当前运行适配器tools为空 |
| DraftCandidate | 稳定候选／Task／Run／Manifest、待核对文字、固定来源引用 | 1655；Decision只允许拒绝或接受为新Document |

Task消息、顺序、更正、材料／产物关联由1699公开Query提供；UI／assistant-ui只投影，不能从Pi内部会话或Editor DOM拼业务历史。角色区分原文摘录、OCR候选、Document文本、个人备注、用户更正及已接受历史候选。FAILED_ONLY、REPLACED_OLD、OTHER_TASK、UNSELECTED、INACCESSIBLE、BUDGET记录为排除原因，不把失败partial或被更正旧消息默默重送。

本版尚不准入S11已保存标注／备注输入：其annotation_id、标注revision、AnchorRef及备注body／已保存修订必须由S11／D01公开Query提供后按原Owner扩展DTO。不能将Annotation备注伪装成普通Document或读取临时Editor DOM绕过绑定；当前schema没有annotation输入kind，格式会拒绝。

## 预览、授权与预算

宿主Application先验证Task范围及每个所选对象的访问、固定修订／来源版本与实际字节，然后从唯一Owner读取快照。每份selected内容与hash由宿主重新产生；Renderer提供的ID、hash、role、preview ID或合法Zod格式不是授权、真实读取或人工确认凭证。工作区不由Renderer自报；归组Project不自动扩权，保留仍可访问历史来源版本。

renderSelectedInput固定序列化用户要求和本次selected项，payload必须逐字等于该结果，不能追加未列明的历史或工具输出。最多32项、整个payload不超过4000个JS字符、单次输出2048 tokens、0自动重试，是当前最小运行预算；字符不是token／费用估算。系统提示、Provider消息封装及实际token成本需1651／1652在最终发送边界另核对，未知费用明确UNKNOWN。

确认绑定宿主生成的不可变Manifest、payload hash、Provider和模型。派发前重核权限／确认；用户改变输入、版本、Provider或范围须重新预览。已保存内容在确认后出现新修订，不自动替换本Run固定旧修订；已选旧修订仍有权访问时可继续，失权则拒绝。不得仅比较摘要或勾选数判断发送一致。

只读工具必须从同一Manifest选项读取，未知工具／任意路径／SQL／Shell／外部MCP发现全部拒绝。材料中的指令是数据，不授予工具或写权限。工具结果若改变实际payload或预算，重新确认，不在一次收费调用后暗中继续第二Loop。

## Run、事件与恢复

Run稳定ID按Task、Manifest、Provider／模型和固定输入登记，再派发；同ID同输入查询原Run，不重复计费；同ID异输入冲突。request_id只关联请求，不能代替业务幂等键。事件绑定原Task／Run及单调sequence；重复序号核对内容，相同文本不同事件不按文本去重；旧／缺序／身份冲突明确报告，不能串Task。取消终态后迟到事件不得再写正文。

状态沿用现有running／succeeded／cancelled／failed／interrupted，模型成功不是Document已保存。可得用量如实记录，取消／超时／连接断开和崩溃后的费用或远端结果不明记UNKNOWN；不自动换Provider、重试或重启付费调用。重启保留固定输入、已落盘partial及Run身份，恢复为interrupted，不重建另一个Task或Pi session。

## 候选与新稿

候选只能预览；candidateIsWithinManifest验证候选所属Task／Run／Manifest及SourceRef是实际选中集合的子集。该结构检查不证明引文逐字相同、可定位或支持结论，S12仍须核对固定来源及quote范围，失败／无材料明确报缺；模型链接或UUID不自行成为可信引用。

candidate_id永久绑定同一文本、Task／Run／Manifest、SourceRefs与用户所见预览，是不可变候选身份。任一内容／输入版本／来源引用变化必须产生新candidate_id并重新预览，不能原地覆盖后沿用旧接受。接受时宿主从候选Owner读回该不可变版本并核对本次确认，不信任Renderer回传文本或未授权候选ID；输入的固定Manifest本身同样不可变。这是1655须实现的版本约束，不是现有SQLite已具备候选存储的声明。

拒绝不写原稿／原件。接受命令携带candidate_id、Task和稳定幂等键，不能指定覆盖Document。1655经Application调用公共Document能力，保存新Document及Run／输入关系；已保存／提交中／结果未知分别显示，未知先查询同键，重复不多建。旧单Task单成果约束须由消费卡按原Owner迁移，新稿保存不能伪装为覆盖原成果。1701定稿、固定交付快照和导出不由本决定自动触发。

## 错误与分层验收

INVALID_REQUEST（格式／旧协议）、FORBIDDEN（失权／跨Task）、VERSION_CONFLICT（确认或源修订变化）、PREVIEW_STALE（payload／模型改变）、NO_KEY、PROVIDER_UNAVAILABLE、RATE_LIMITED、BUDGET_EXCEEDED、RUN_CONFLICT、TOOL_DENIED、CANCELLED、INTERRUPTED、WRITE_FAILED、RESULT_UNKNOWN分别保留可解释恢复动作，不展示Key／绝对路径／敏感全文错误。

本卡合同测试覆盖Key／模型错配、收费自动重试及任意工具拒绝；预览被改、重复选项身份、超预算与错误角色；跨Task／Run／Manifest与伪造SourceRef；接受不允许覆盖目标。纯格式／集合验证不代替宿主授权、SHA计算、真实Owner读取和UI／Provider验收。

真实验收计划见DEV-1554的task-agent-draft-flow：无Key人工路径；用户提供Key的真实请求与原始payload检查；无Key／401／429／材料注入、取消迟到、重复事件、输出引用、接受事务失败／回执丢失及重启。选定已保存消息／修订、已排除旧更正、FAILED_ONLY／OTHER_TASK在重启／追问／重试中不得重新外发。当前这些消费者和真实API为NOT_RUN，不能用DTO四项测试冒充整链通过。

回退撤回设计DTO／文档，不删除Run、原稿、用户二进制或凭据；后续存储变更另按唯一Owner增量迁移和恢复合同验收。无新Runtime、同步、专业事实、法律确认或外部写回。
