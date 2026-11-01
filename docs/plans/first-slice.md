# DEV-1563｜首个最小垂直切片实施合同

- 状态：**首片体验合同已由律师于 2026-11-01 确认；没有产品实现**。分支 `codex/dev-1563-first-slice-contract`。技术实现仍须通过 DEV-1564 预演及对应开发 Issue 验证。
- 唯一用户结果：律师在无账号、无网络的桌面程序中创建一个事项，锁定一份合同 PDF 的本地副本，选中一段原文并保存位置；关闭并重启后仍能打开**同一文件版本、同一页、同一处文字**。
- 本文只规定首片，不标记 [DEV-1553](https://linear.app/logixy-ai/issue/DEV-1553) M1 或 P1 M2 完成。产品尚无 Matter、SourceVersion、Anchor 正式表或文件库。现有 `CreateMatter`/`CreateAnchor` IPC 返回 `not-persisted`，`toolchain_probe` 只是 SQLite 工具链样本。
- “安装并启动”的开发验收指本机从 Forge ZIP 解压并启动打包应用；现有 ZIP 未签名、未公证，正式分发安装仍需后续发布任务。
- 业务来源：[DEV-1563](https://linear.app/logixy-ai/issue/DEV-1563)、[产品定义 v2.2](https://linear.app/logixy-ai/document/caselite产品定义-v22现行-1adb0efed051)、[架构约定 v2.2](https://linear.app/logixy-ai/document/caselite架构与开发约定-v22现行-d22d41990c7d)、[场景与验收 v2.2](https://linear.app/logixy-ai/document/caselite场景与验收样例-v22现行-65005791136a)。DEV-1563 描述中的 v2.1 已由现行 v2.2 取代。
- 设计输入：[P1 Schema 候选](https://linear.app/logixy-ai/document/caselite-p1领域-schema状态机与迁移合同-v1待验证-999c029bbe84)、[P1 五栏目 UI 候选](https://linear.app/logixy-ai/document/caselite-p1五栏目-ui页面状态与交互合同-v1待验证-1e13f18159bf)、[SourceVersion/Anchor 候选](https://linear.app/logixy-ai/document/caselite-p1sourceversion文件pdf-与-anchor-合同-v1待验证-68d7d52f2e0a)。它们仍待各自设计 Issue 验证；本文只固定首片必需的子集，若后续完整 Schema/UI 合同提出冲突，应先在 Linear 决定，不暗中改产品行为。

## 1. 律师逐屏走查

以下是低保真交互合同，不是已实现截图。固定五栏目为**概况、任务、文件、交付物、动态**；首片只使概况、文件及必要动态可操作，其余显示未开放，不伪造可用。Review 是上下文/待确认区，不增加栏目。整个流程不要求登录、Key、服务器或 OCR。

| 屏幕                    | 律师看到与输入                                                                                  | 成功后的可见结果                                                             | 失败时看到与下一动作                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 首次启动 / 事项列表     | 空列表和“新建事项”；无注册弹窗                                                                  | 本地工作区就绪；显示“仅保存在此设备”                                         | 数据库初始化或迁移失败：禁止创建，说明已有资料未被删除，提供重试/恢复入口和诊断 ID                 |
| 新建事项                | 输入事项名称；名称必填，去首尾空格，1–160 字符                                                  | 新事项进入列表和概况，明确“已保存到本地”                                     | 空名、重复提交或数据库失败：留在表单；可查询提交结果，不生成两个事项                               |
| 文件栏目 / 选择现有 PDF | 点击“添加合同原件”，由系统文件选择器选择一个 PDF；取消只关闭选择器                              | 显示原文件名和“正在建立本地锁定副本”，尚不宣称导入完成                       | 取消不产生文件记录；不存在、无权限、非 PDF、损坏或超限显示具体原因，可重新选择；已有事项不变       |
| 确认锁定副本            | 显示名称、大小、SHA-256 摘要及“CaseLite 会保存一份独立副本，原文件不会被修改”；点击“锁定并添加” | 文件栏目出现“本地原件 v1·已锁定”；原路径仅作来源提示，不作身份               | 复制、哈希、校验、空间或 DB 失败不显示“已锁定”；允许重试并清理残留，不覆盖已有版本                 |
| PDF 阅读                | 在文件栏目打开已锁定版本；显示版本、页码、缩放和“已保存到本地”                                  | 本地 Worker 显示画布和文字层；离线可读                                       | 副本缺失/损坏、Worker 失败：不切换到外部路径或其他版本，显示“此版本暂不可读”及恢复入口             |
| 选择原文                | 在文字 PDF 的某页拖选连续文本，预览原文、页码及附近文字；可取消                                 | 预览只属于当前锁定版本，未保存前不产生 Anchor                                | 无文字层的扫描件提示“无法选取原文；本切片不提供 OCR”；空选区、跨页选区、无法唯一定位时要求重新选取 |
| 保存位置                | 点击“保存位置”，可见选中句、页码、版本与保存中状态                                              | 生成 Anchor，显示“已保存到本地”；普通高亮不自动成为事实、依据或法律结论      | 保存失败保留当前预览，允许查询结果/重试；不能先显示成功或把失败写成正式引用                        |
| 退出与恢复              | 正常关闭或强制退出，再打开同一事项的文件栏目                                                    | 打开同一 `source_version_id`，回到保存的页与片段并高亮；可查看版本和选中原文 | 锚点不再匹配时显示原句、原页及“需重新定位”，不得自动跳到相同文字的另一处                           |

键盘可达、焦点明确、错误不只靠颜色表达；失败文案说明“哪些内容仍安全保存”和“下一步能做什么”。同步/云端状态不出现在本地首片的成功提示中。

## 2. 首片对象与状态

```text
Workspace 1 ── * Matter 1 ── * Source 1 ── * SourceVersion 1 ── * Anchor
                                      │              │
                                      │              └── SourceAssetLink ── AssetVersion ── Asset
                                      └── （同一 Source 的 v1/v2 历史均保留）
Matter / SourceVersion / Anchor ── ChangeEvent + AuditEvent + 必要本地 Outbox
Device + Matter ── ReadingPosition（仅表示上次查看处，不是法律引用）
```

| 对象                                     | 首片最低字段与含义                                                                                                                                                                                         | 不变量                                                                                              |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Workspace                                | `id`，本机无注册即可使用的稳定范围                                                                                                                                                                         | 不是云账号；首片单本地工作区                                                                        |
| Matter                                   | `id`, `workspace_id`, `title`, `version`, `created_at`, `updated_at`, `schema_version`                                                                                                                     | 本地生成不透明 ID；新建 `version=1`；名称不是身份                                                   |
| Asset / AssetVersion                     | `asset.id`；`asset_version.id`, `asset_id`, `sha256`, `size`, `mime_type`, `original_name`, `storage_locator`（仅 main/files 内部）, `status`, `created_at`                                                | 二进制版本不可变；`ready` 前不可阅读/引用；路径不跨 IPC                                             |
| Source / SourceVersion / SourceAssetLink | `source.id`, `matter_id`, `kind=contract`; `source_version.id`, `source_id`, `version_label`, `asset_version_id`, `content_hash`, `captured_at`, `freshness_state`; 关联记录连接内容版本与文件版本         | 法律材料版本与二进制版本分开；v2 新增，不覆盖 v1；哈希仅证明字节一致，不证明真实性/法律效力         |
| Anchor                                   | `id`, `matter_id`, `source_version_id`, `page_number`（界面 1 起）, `quoted_text`, `prefix`, `suffix`, `text_start`, `text_end`, `geometry`（可用时）, `locator_version`, `validation_state`, `created_at` | 绑定具体 SourceVersion；页码+范围+上下文共同消歧；原文变化后旧 Anchor 不自动迁移                    |
| ReadingPosition                          | `device_id`, `matter_id`, `source_version_id`, `anchor_id`, `updated_at`                                                                                                                                   | 用于恢复阅读；必须引用存在且可读的版本；不代替 Anchor                                               |
| ChangeEvent / AuditEvent / Outbox        | 稳定事件/操作 ID、对象/版本、动作、时间、主体/设备、最小载荷、状态                                                                                                                                         | Matter 写入与必要本地 Outbox 同一 SQLite 事务；审计不存原文全文、绝对路径或秘密。首片不发送网络请求 |

上述是实施合同的**最低语义字段**，不是已运行迁移。数据库字段、外键和索引还须与 [DEV-1577](https://linear.app/logixy-ai/issue/DEV-1577) 的完整 Schema 设计校对。时间统一 UTC，ID 不依赖路径/标题/文件哈希。所有 DTO 有协议版本和运行时校验；单个 Matter 只能访问自己的 Source/Anchor。删除、跨 Matter 复用、复杂权限不在首片内。

## 3. 文件与原文规则

1. **选择即关联，确认后锁定本地快照。** 首片成功路径只依赖 CaseLite 控制的数据目录内的不可变副本；外部文件即使改名、移动、删除或修改，已锁定 v1 仍可读。不得把暂存路径或原路径当 ID。用于试验的路径和内容不得进公开仓库。
2. 导入时由 main 获得系统选择器给出的受控文件句柄；读取前后比较大小/修改时间并对复制后的字节计算 SHA-256。若源文件在复制中变化，报“源文件已变化，请重选”，不宣称锁定成功。用户看到摘要可核对字节一致性，但不能据此断言真实签署或证据能力。
3. 相同 Matter、同一 Source 中再次导入**同一 SHA-256**：返回已有 SourceVersion 并提示“此文件版本已存在”，不制造第二版本或第二 Anchor；同名但不同字节须以新版本确认。不同 Matter 可共用底层字节的内部去重，但各自 Source/权限/版本独立。
4. 外部原件更新时，界面不得静默替换快照。律师明确选择“添加新版本”后产生 v2；旧 v1 和 Anchor 可读。v2 可标记旧锚点“需复核”，但首片不自动迁移 Anchor，也不计算法律结论影响。读取时只按明确的 SourceVersion ID，不按文件名猜测。
5. PDF 文字层选区需同页，保存页码、原句、前后文和稳定文字范围/几何定位。再次打开时核验该锁定版本哈希和选区文字；同句跨页时页码必须消歧，同页重复还须范围/几何消歧。无法唯一核验则停在原页并显示“需重新定位”，不能跳到首个搜索结果。
6. 扫描件在本切片可作为锁定文件阅读，但无可选择的原文文字层；不伪造 OCR 精确位置。损坏/加密 PDF 安全拒绝阅读或导入；OCR 和页级图像批注留给后续 Issue。
7. 首片限定 `application/pdf` 且文件最大 **20 MiB（实施假设，待开发 Spike 测试资源占用）**。超过上限显示“文件过大，当前版本无法导入”；开发实现可降低上限，但须更新合同并重新经律师确认。阅读字节经专用 `GetSourceVersionPdf` 入口从 main 受控读取并交给 react-pdf，不开放通用文件路径/协议或任意 SQL。

## 4. 业务入口与端到端接线

```text
renderer/features（五栏目与阅读 ViewModel）
  → preload（逐项方法） → contracts（Zod DTO/结果） → main/ipc（sender、范围、版本、权限）
  → application/use-cases（幂等、事务编排、领域规则） → domain
  → local-db + files + pdf（各自 Port/Adapter；react-pdf 只负责显示）
```

当前 `packages/contracts/src/commands.ts` 的 `CreateMatter`/`CreateAnchor` 与 `packages/application/src/spike-application.ts` 可复用输入校验结构，但其 `not-persisted` 结果**必须在正式实现时改为经过持久化验证的 `saved-locally` 合同**，并保留协议版本兼容/拒绝规则。不能用 Spike 结果冒充新合同。

| 动作（UI → preload）                   | 请求最低字段                                                                                                                | 成功输出（ViewModel，不含 Drizzle Row/路径）                                           | 结构化失败/恢复                                                                               |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `CreateMatter`                         | `request_id`, `protocol_version`, `workspace_id`, `actor_id`, `device_id`, `idempotency_key`, `expected_version=0`, `title` | `matter_id`, `new_version=1`, `local_save_status=saved-locally`, 事件 ID               | `INVALID_REQUEST` 改输入；`CONFLICT` 查状态；`STORAGE_UNAVAILABLE` 保持表单、重试             |
| `ListMatters` / `GetMatter`            | 工作区 ID、分页/事项 ID                                                                                                     | 稳定 ID、标题、版本、状态                                                              | 无事项为空态；越界 `FORBIDDEN`；损坏库进入恢复态                                              |
| `SelectAndStagePdf`                    | UI 发出选择动作，**不发送任意路径**                                                                                         | 不透明 staged token、名称、大小、哈希、有效期                                          | `CANCELLED` 无副作用；`FILE_MISSING/UNREADABLE/TOO_LARGE/INVALID_PDF` 可重选                  |
| `ImportSourceVersion`                  | Matter/Source ID（首次可空）、staged token、`expected_version`、幂等键、确认锁定                                            | `source_id`, `source_version_id`, `asset_version_id`, `version_label`, `saved-locally` | `SOURCE_CHANGED` 重选；`FILE_WRITE_FAILED`/`STORAGE_UNAVAILABLE` 保留旧版本；重复返回已有版本 |
| `GetSourceVersionPdf`                  | Matter ID、SourceVersion ID                                                                                                 | 受大小限制的 PDF 字节与版本摘要；不含绝对路径                                          | 文件缺失/哈希不符只显示该版本不可读；不得回退外部路径                                         |
| `CreateAnchor`                         | Matter ID、SourceVersion ID、页码、原句、上下文/范围、`expected_version=0`、幂等键                                          | Anchor ID、版本、`saved-locally`、验证状态                                             | `ANCHOR_AMBIGUOUS/MISMATCH` 重选；DB 失败不显示保存成功                                       |
| `ResolveAnchor` / `GetReadingPosition` | Matter ID、Anchor ID 或阅读位置                                                                                             | 精确 SourceVersion、页码、选区或 `needs-review`                                        | 旧版/缺失/损坏不静默跳转；提示恢复副本或重新定位                                              |

示例（字段名和错误枚举由对应实施 PR 在 `contracts` 中冻结；当前不是现成 API）：

```json
{
  "request_id": "f1a1a0a8-3998-4b71-98bd-c94666a4c88f",
  "protocol_version": 2,
  "workspace_id": "ws_demo",
  "actor_id": "local_owner",
  "device_id": "device_demo",
  "idempotency_key": "7470e956-c71c-4a6b-a75f-c897c199b835",
  "expected_version": 0,
  "payload": { "title": "合成合同审阅" }
}
```

```json
{
  "ok": true,
  "value": {
    "entity_kind": "matter",
    "entity_id": "matter_01",
    "new_version": 1,
    "local_save_status": "saved-locally",
    "domain_events": [{ "type": "MatterCreated", "event_id": "event_01" }],
    "warnings": []
  }
}
```

```json
{
  "ok": false,
  "error": {
    "code": "ANCHOR_AMBIGUOUS",
    "message": "这一页有多处相同文字，请重新选取具体位置。",
    "retryable": false,
    "recovery_action": "reselect_text",
    "correlation_id": "79a2ea1f-9f94-4872-9046-29e4bd4feccb"
  }
}
```

`request_id` 用于追踪调用，`idempotency_key` 用于避免重复业务效果；超时后先按键查提交结果，再决定重试。`expected_version` 对已有对象要求乐观并发校验；旧协议应显式拒绝/升级，不默许字段丢失。成功的 `saved-locally` 仅指本地 SQLite/文件提交完成，**不等于云端已同步、律师已核验或法律引用成立**。DomainEvent/Outbox 的 payload 只存最小 ID/版本，不放原件内容。

## 5. 一致性、迁移、备份与恢复

文件与 SQLite 无共同原子事务，按以下可恢复顺序编排，不声称二者天然同时提交：

1. 受控目录内创建临时文件，限制大小，复制并校验 PDF、长度和 SHA-256；写入并同步文件，随后以原子重命名放入不可变存储。尚无业务记录指向它。
2. 在**一个 SQLite 事务**中提交 Asset/AssetVersion、Source/SourceVersion/Link、ChangeEvent/AuditEvent、必要本地 Outbox 和幂等结果；提交后才向 UI 返回“已保存到本地”。Matter 创建及 Anchor 创建各自也在一事务中提交业务记录、事件、必要 Outbox 与幂等结果。
3. 崩溃前未提交 DB：文件可能成为孤儿；重启后按受控 manifest/引用清单清理或恢复，绝不扫描/删除用户外部文件。DB 已提交而文件不可读：标记不可读并进入备份恢复，不以原路径重建同一版本。
4. 阅读位置在 Anchor 成功后另行本地事务保存；若仅位置写入失败，Anchor 仍存在且可从文件栏目找回，界面不能声称“下次自动回到此处”。强制退出后只承认已提交状态；未提交选区可丢失但不能出现半个已保存 Anchor。
5. 首次建库及升级使用版本化 Drizzle 迁移：空库、上一版本夹具、重复启动、迁移中断/失败、重启继续均需测试。迁移前停止写入并生成可核验的一致性备份；失败保持原库与文件版本，阻止继续写入，提供恢复说明，不自动删除/降级。
6. 最小备份包含 SQLite **一致性快照**、不可变文件版本、manifest（IDs、相对内部位置、大小、SHA-256、schema 版本）及校验结果；不包含凭据。备份写到用户指定的受控目标，先完成/校验后才报告成功。恢复在隔离位置验证 manifest、哈希、迁移兼容和 Anchor 回跳，再切换为活动数据；失败保留旧数据。**实际备份 UI、目标与恢复演练是开发开工门禁，不能用普通文件复制替代 SQLite 备份。**

具体用户数据目录、备份格式、磁盘满/权限错误注入和 SQLite WAL checkpoint 策略，由开发 Issue 结合真实 macOS 沙箱/Forge 打包运行证据固定；正式资料接入前不得使用当前非加密研发盘的合成探针目录存放客户文件。

## 6. 合成样本、预期与门槛

唯一测试资料为仓库公开合成样本；[manifest](../../tests/fixtures/case-materials/manifest.json) 有固定 SHA-256，[人工金标准](../../tests/fixtures/case-materials/golden-standard.md) 有预期。`fixtures:case-materials --refresh` 会重生成 PDF，不能在验收中随意运行并覆盖金标准。以下路径均相对仓库：

| 样本                                                                    | 冻结预期                                                                                      | 门槛        |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------- |
| `tests/fixtures/case-materials/development/contract-v1-text.pdf`        | 导入为锁定 v1；文字可选；保存后重启回到同版同页同片段                                         | G0/G1/G6/G7 |
| `tests/fixtures/case-materials/development/contract-v2-text.pdf`        | 明确添加 v2；只改付款期限十日→三十日；v1 与旧 Anchor 保留且可读，旧 Anchor 不自动变为 v2 引用 | G1/G2/G6    |
| `tests/fixtures/case-materials/development/anchor-repeat-two-pages.pdf` | 相同提示语在两页；第 1 页 `ALPHA-001` 与第 2 页 `BETA-002` 不可串页；重启仍定位所选页         | G1/G6       |
| `tests/fixtures/case-materials/development/contract-v1-scan.pdf`        | 可显示图像；没有文字层时不允许创建“精确文字 Anchor”，明确提示 OCR 未提供                      | G1/G7       |
| `tests/fixtures/case-materials/development/damaged.pdf`                 | 拒绝导入/阅读并显示可恢复错误；不损坏已有 Matter/SourceVersion                                | G1/G6/G7    |
| `tests/fixtures/case-materials/regression/supply-contract-v1-text.pdf`  | 独立 Matter 回归，不得跨 Matter 取文件或 Anchor                                               | G1/G7       |

**G0**：从干净锁文件安装；`pnpm check:quick`、`pnpm ci`（Linux）、`pnpm test:full`（macOS）按当次结果记录；打包资源与原生 SQLite 可加载。**G1**：版本/哈希/文字选择/双页消歧/失配与扫描边界；定位正确与法律支持正确分开。**G2**：只验证 v1/v2 历史和锚点保全，不声称 Finding/知识/交付影响已实现。**G6**：正常与强制退出、源路径变化、SQLite/文件部分失败、备份恢复。**G7**：最小改动、不弱化 CI/安全；越权/错误 DTO、私密路径/日志/备份泄露检查；交付证据与律师操作验收分开。

### 追踪矩阵

| 用户功能 | UI 页面/状态              | Command/Query                                  | 对象/版本                          | Port/Adapter   | 事件/Outbox                  | 失败恢复                           | 自动测试             | 实施 Issue |
| -------- | ------------------------- | ---------------------------------------------- | ---------------------------------- | -------------- | ---------------------------- | ---------------------------------- | -------------------- | ---------- |
| 创建事项 | 列表空态→概况→本地保存    | CreateMatter/ListMatters/GetMatter             | Matter v1                          | local-db       | MatterCreated + 必要 Outbox  | 重复/事务失败/重启                 | 单元+IPC+SQLite+桌面 | 下节草案   |
| 锁定合同 | 文件选择→确认→ready       | SelectAndStagePdf/ImportSourceVersion          | AssetVersion/SourceVersion v1      | files+local-db | SourceImported + 必要 Outbox | 源变更/中断/孤儿清理               | 文件+事务+打包       | 下节草案   |
| 原文定位 | PDF 选择→保存→回跳/待复核 | GetSourceVersionPdf/CreateAnchor/ResolveAnchor | Anchor→SourceVersion v1            | pdf+local-db   | AnchorCreated + 必要 Outbox  | 同文多处/失配/重启                 | PDF+IPC+桌面+恢复    | 下节草案   |
| 阅读恢复 | 文件→上次位置             | GetReadingPosition                             | Device/Matter/SourceVersion/Anchor | local-db+files | 本地位置事件（如需要）       | 位置缺失回到文件、文件缺失进入恢复 | 重启+备份恢复        | 下节草案   |

## 7. 正式开发 Issue 草案（**未在 Linear 创建**）

建议标题：**首个本地事项与合同原文定位：保存并重启回到同一版本位置**。只有本合同获律师确认且 [DEV-1564](https://linear.app/logixy-ai/issue/DEV-1564) 端到端预演通过后，才把草案建成执行队列。若一次 PR 无法形成独立可演示结果，可在不改变最终用户结果的前提下拆成 3–5 个依赖明确的小 Issue，逐个授权。

1. **用户结果**：无账号离线创建 Matter，锁定一份合同 PDF，选择并保存原文位置，重启后回到同一锁定版本的同一位置。
2. **输入与样本**：本合同、现行 v2.2 三 Resource、ADR-001/002/004、DEV-1566/1567/1568/1570 证据；仅使用上表合成 PDF 与空/上一版本测试库。无需真实案件或 Key。
3. **本次输出**：五栏目中的最小 Matter/文件界面、受控 PDF 选择和锁定、副本阅读/Anchor/恢复；必要的 Domain/Application/Contracts/IPC/Files/PDF/SQLite 代码、迁移、最小备份/恢复说明与可运行演示。不新增空包。
4. **输入 Schema**：使用第 4 节命令字段；Zod 严格校验、协议版本、工作区/Matter 范围、幂等键、并发版本、文件大小/类型限制；选择器不接受 renderer 提供的路径。
5. **输出 Schema**：成功返回稳定 ID、版本、`saved-locally`、事件和警告；空列表/无位置有显式空态；错误包括可理解原因、可否重试、恢复动作和诊断 ID，不含 SQL/绝对路径/堆栈。
6. **UI 与状态**：第 1 节逐屏流程；loading/empty/ready/saving/saved/failed/recovery，离线仍可用；文件不可读和锚点失配单独显示。云端同步/律师审核与本地保存分开。
7. **失败与边界**：至少覆盖取消、缺失/无权/损坏/超限文件、源改名/变更、重复导入、同文跨页/同页、DB/文件部分失败、强制退出、备份恢复；所有旧版本和已提交数据保全。
8. **代码范围**：可修改 `apps/desktop/src/{renderer,preload,main}`、`packages/{contracts,application,local-db}`，按需要新增最小 `packages/{domain,files,pdf}` 和测试/迁移/文档；不可引入第二 ORM、打包器、同步服务、Tiptap/Yjs、AI/OCR/MCP 或通用文件 API。
9. **数据与权限不变量**：稳定本地 ID，路径不作身份，哈希不作真实性；SourceVersion 与 AssetVersion/Anchor 精确绑定；main/Application 权限和范围校验；Matter/Outbox 同事务；文件先可验证再 ready；无网络外发；公开仓库无真实资料。
10. **测试与验收**：局部领域/合同/IPC/SQLite/文件/PDF/迁移负向测试；`pnpm security:baseline`、`pnpm check:quick`、`pnpm test:integration`；本机 `pnpm test:full` 含联网审计、许可证、打包及真实桌面路径；Linux `pnpm ci`；人工断网、重启、v1/v2、扫描及备份恢复演示。未运行逐项标注。
11. **证据**：分支/提交/锁文件、实际命令与退出结果、迁移版本、样本 SHA-256、Matter/SourceVersion/Anchor 的匿名 ID 与哈希、重启回跳录屏/截图、失败与恢复记录、未验证项及回退。不得提交真实资料、用户数据库、备份或可识别路径。
12. **非目标与开工门禁**：不做法律分析、正式引用支持判断、AI、OCR、Yjs、同步、MCP、知识库或跨设备。须先确认下节体验问题、完成 DEV-1564 预演，且与 DEV-1577/1576/1579 的具体设计无冲突；迁移/备份的破坏性操作另经人工授权。

回退：合并前撤回开发分支；合并后若尚无真实用户数据，可恢复此前应用构建。若已有数据，只能保持旧库/文件及迁移前一致性备份，以兼容旧版或前进式修复恢复；**禁止直接回滚迁移、删除库或删文件**。本设计草案自身无迁移和用户数据，撤销文档提交即可回退。

## 8. 律师体验确认

1. **锁定时机与提示**：选择 PDF 后先展示文件名、大小和“将保留独立副本”，由律师点击“锁定并添加”；确认前取消不留下资料。
2. **扫描件的首片边界**：扫描 PDF 可以阅读，但无文字层时不能保存精确文字位置，明确提示 OCR 将在后续加入；首片验收只用文字 PDF 完成原文定位。
3. **失配时的行为**：保存的片段无法唯一核验时停在旧版本原页，展示原句并提示重新定位；绝不自动跳到看似相同的另一处。

律师于 2026-11-01 在当前会话回复“接受，按草案继续”，接受以上三项及文档中的整体操作流程。其余字段、事务、内部路径、哈希、限额和测试技术选择由开发在上述不变量内落实。这是**设计体验确认**，不是已经完成产品操作验收；正式开发 Issue 仍待 DEV-1564 预演后创建。

## 9. 现有证据与下一步

- [DEV-1567 SQLite/Drizzle](../adr/ADR-002-local-sqlite-drizzle-and-transaction-boundary.md)：原生模块、迁移、事务、打包读写探针已验证；正式领域表和生产备份尚未实现。
- [DEV-1568 PDF 打包](../architecture/DEV-1568-pdf-offline-spike.md)：固定合成 PDF、本地 Worker、文字层/扫描显示通过；正式导入与 Anchor 未实现。
- [DEV-1566 离线联动](../architecture/DEV-1566-offline-integration.md)：同一打包程序中的 PDF、测试用 IPC、SQLite、重启和故障路径已验证；正式 Matter/SourceVersion/Anchor 仍未持久化。
- [DEV-1570](../architecture/DEV-1570-editor-admission.md)：Tiptap/Yjs 延后到首个富文本用户结果；本切片无需安装。
- [DEV-1559](../TESTING.md)：G0 快速/完整门禁与证据格式已有；正式切片须当次重跑，不能借用旧日志。

下一步执行 DEV-1564 的全新 LLM 端到端预演，检查本合同是否仍迫使开发者猜测；预演也经律师接受后，才创建最近 3–5 个正式开发 Issue。任何法律/产品含义冲突以 Linear 现行资源及律师决定为准。
