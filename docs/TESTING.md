# CaseLite｜测试策略与交付证据

- **性质**：测试基线草案，执行标准最终以真实项目测试脚本、CI 与律师确认的样本为准。
- **来源**：现行05／06和当前消费卡，固定入口见 [SOURCES](SOURCES.md)；历史v2.2仅追溯。
- **覆盖边界**：当前有真实Task／Yjs、目录及Run存储测试和独立桌面演示；工程PDF／IPC／SQLite探针与产品UI验收分开。受管来源／Anchor、扫描OCR、真实BYOK、同快照双格式、完整备份／同步和人工产品接收仍需对应消费者实测。不得用本页替代当次结果。

## 1. 质量门禁

| 层级 | 主要目标 | 合格的证明 |
| --- | --- | --- |
| G0 工程基线 | 干净安装、格式/类型/lint、单元/合同检查、桌面构建、安全配置 | 真实命令与 CI 输出，锁文件/提交可对应 |
| G1 来源与原文 | 文件版本、读取、Anchor 定位及引用语义 | 固定合成文件、页码/片段金标准、失配测试 |
| G2 版本影响 | v1/v2 合同更改，依赖影响与历史版本保全 | 人工确认受影响/不受影响预期 |
| G3 本地 AI | BYOK、WorkRun、Provider/OCR 错误、费用和人工确认 | 真实 Provider 联调与离线模拟分开标记 |
| G4 协作同步 | Outbox/Delta、Yjs、附件、权限及灾难恢复 | 两客户端/真实服务测试和故障注入记录 |
| G5 外部连接与知识 | MCP 来源、片段/位置、权限、分页、断连和候选写回 | 可核查外部来源及用户确认记录 |
| G6 本地恢复 | 数据库/文件备份、重启、源文件变化和恢复 | 实际损坏/失败演练且原数据未丢失 |
| G7 安全/交付 | IPC、Key、越权、敏感日志、公开仓库泄密、回滚 | 自动检查＋人工审阅及剩余风险 |

> 上表为各门槛的简要索引，不替代现行05和当前消费卡的完整验收矩阵。各次实际执行记录见 artifacts/evidence 和对应 Linear Issue；不以本文静态文字代替当次结果。

## 2. 当前 G0 命令与证据

所有命令从仓库根目录运行。它们只使用公开工程资料，不读取客户文件、真实 Key 或个人数据库。

| 命令 | 作用 | 当前结果含义 |
| --- | --- | --- |
| `pnpm format:check` | 检查受版本控制的工程文件格式 | 格式错误会失败 |
| `pnpm lint` | ESLint 静态检查 | 警告也会失败 |
| `pnpm architecture:check` | 解析 apps/packages 源码的静态、动态与 require 导入，检查进程/包边界、入口、循环与空包 | 含故意违规夹具的自检 |
| `pnpm test:integrity` | 扫描共置与跨包测试，阻止 skip/only/todo、each 链及条件跳过 | 含故意违规夹具的自检 |
| `pnpm security:baseline` | 公开仓库、Electron 设置、日志与 Secretlint 秘密扫描 | 含临时生成假令牌的自检；不扫描或保存真实凭据 |
| `pnpm typecheck` | 检查桌面进程的 TypeScript | 不等同于运行时安全校验 |
| `pnpm test:unit` | Vitest + React Testing Library 的最小用户可见界面测试 | 单元测试与源码共置，覆盖现有React交互和纯逻辑 |
| `pnpm test:contracts` | 架构、IPC 与质量门禁负向合同测试 | 严格DTO及质量门禁负例；持久化由实际集成另验 |
| `pnpm coverage` | 生成当前测试覆盖率报告 | 用于发现缺口，不以百分比定义完成 |
| `pnpm check:quick` | 快速执行格式、lint、边界、完整性、安全、类型、单元和合同检查 | 生成可忽略的本地证据文件 |
| `pnpm test:full` / `pnpm verify` | 在本机执行检查、审计、许可证、集成、覆盖率、打包和真实桌面测试 | 适用于本机完整回归 |
| `pnpm run ci` | Linux CI 的相同代码检查入口 | 明确不打包 macOS 应用 |

`pnpm test:integration` 已运行 SQLite 与 DEV-1566 固定合成记录的受控 IPC/重启测试；它已覆盖当前Task、正文、目录与Run的实际存储，但不证明任意文件导入或完整法律任务。`pnpm test:e2e` 调用已有的真实打包态 PDF＋IPC＋SQLite 测试（自有 Electron harness），不冒充 Playwright。Playwright Electron 仍延期：其 inspect 参数与当前安全 Fuse 冲突。Linux CI 将桌面测试明确记为未运行，本机完整链在打包后实际运行。`pnpm test:packaged-integration` 在可启动桌面程序的 macOS Apple Silicon 终端运行真实打包态离线冒烟，并由本机 `pnpm test:full` 在打包后调用。Linux CI 不运行 macOS 图形程序。

每次 `check:quick`、`ci` 或 `test:full` 会在被忽略的 `artifacts/evidence/` 下生成 JSON，记录提交、工作树和锁文件摘要、是否有未提交改动、Node/pnpm 版本、全部计划命令、耗时、退出码/信号、结果、未运行项和恢复方式。前一步失败后的命令逐项记为 not-run，不能从另一次执行借用通过结果。失败也会尽量保留该记录；它不包含绝对路径、客户资料或秘密。

GitHub Actions 使用干净的 Linux runner、锁定的 Node 24.22.2 和 `pnpm install --frozen-lockfile`，运行含覆盖率的 `pnpm run ci`。根据人工选择，它不在云端打包 macOS 应用；macOS 打包必须由开发机执行 `pnpm test:full` 并在交付记录中附上真实结果。

## 3. 当前适用的工程与桌面检查

- 对纯函数/领域规则写单元测试；对 SQLite 迁移、事务/回执、IPC 参数和错误写合同/集成测试。
- 对 Electron 打包态执行至少一个**真实**桌面冒烟，开发服务器停止后再次验证；外置盘不等于产品运行目录。
- DEV-1568 的 `pnpm test:packaged-pdf` 只用仓库合成样本，并在测试模式阻断 HTTP(S)。它需在可启动 macOS 图形程序的本机终端运行；构建成功、包内资源存在或自动化环境的启动失败，都不能冒充该命令已通过。
- DEV-1566 的 `pnpm test:packaged-integration` 在**同一个**打包程序内检查 PDF Worker/文字层、固定合成记录的 renderer→preload→IPC→Application→SQLite 写入与两次重启读回。它还验证非法 DTO、损坏及缺失 PDF、中文与空格的应用资源路径；临时数据自动删除。测试会在应用会话内拦截 HTTP(S)，但不能代替人工断开物理网络的检查。报告写入被忽略的 `artifacts/evidence/dev-1566-packaged-integration.json`。
- DEV-1578 在同一打包测试的正常阶段额外检查 CreateMatter、CreateAnchor 的真实 IPC 路径、重复请求、旧协议及非法输入；两项结果均为 `not-persisted`，不能把这一结果视为 Matter/Anchor 写库或 Outbox 事务通过。
- 运行版本一致的测试命令，CI 从干净环境重现；不得为“绿色”结果删除失败断言、放宽安全检查或批量跳过。
- 测试库、临时文件、进程使用独立临时目录，并在正常/失败退出后清理；不得使用真实案件数据。
- 每次合并或交付记录测试分层：未运行、失败、通过、不适用，不允许把模拟与真实联调混为一谈。

## 4. 合成样本与金标准

CaseLite 专用、许可明确、体积合理的测试文件原则上放在仓库 `tests/fixtures/`，与代码版本共同更新。需要共享的大型/非敏感语料才考虑 CASDEV 顶层 `fixtures/`；CI 不得依赖其绝对路径。

DEV-1560 已提供合成合同 v1/v2、扫描副本、重复文字、日期/金额/否定词变化和损坏 PDF 样本；人工金标准已由律师确认。详细清单、哈希及预期见 `tests/fixtures/case-materials/`。测试输入、预期及其版本仍须分离，避免模型自评替代事实核验。

## 5. 未来同步的条件故障用例

- 重复 `mutation_id`、服务端提交成功但 ACK 丢失、WebSocket 通知丢失、游标过期后恢复 Snapshot。
- 客户端 Pending 在崩溃后保留，重建后不丢并遵守权限重放；旧客户端版本不支持时安全拒绝或升级。
- Yjs Update 数据库提交前/后故障、Snapshot 压缩失败、Redis 全部丢失，验证不会丢失持久化正文。
- 附件上传中断、对象与元数据部分成功、哈希失败、ready 前禁止读取/分享。
- Matter/对象撤权与跨 API、WebSocket、Yjs、对象存储的一致鉴权。

这些是测试计划，**不表示服务端已经部署或通过**。

## 6. 每次 Issue 证据格式

```text
Issue：DEV-____
分支/提交：____
目标用户结果：____
样本版本/来源：____
运行环境/锁文件：____
实际命令：____
测试结果（通过/失败/未执行）：____
复现步骤与截图/日志位置（不含客户资料或秘密）：____
异常与恢复验证：____
仍未验证：____
回退方式：____
人工审阅结论：待确认 / 接受 / 退回
```

测试完成不等于律师已接受产品体验或法律结果。当前真实执行依据由 `package.json`、CI 配置和测试目录决定。


## DEV-1559 验收修复的边界

- `pnpm review:changes` 对照 `QUALITY_BASE_REF`（本机默认 origin/main；CI 为 PR base 或 push before）检查差异。删除既有测试、关闭 PR 检查、移除/替换必要脚本、降低字面量覆盖率阈值会失败。所有受保护文件改动生成 `quality-change-review.json`，必须在合并前审阅精确差异；输出 REVIEW REQUIRED 不等于已获批准。
- 脚本无法证明审阅人的身份，也不能阻止有写权限的人同时修改工作流和检查器。GitHub 的必需检查、分支保护及审阅规则由仓库管理员管理，本次不声称已配置。脚本不替代这些平台权限。
- `architecture-graph.json` 提供实际文件依赖图和 workspace 清单。检查覆盖字面量模块导入；非字面量动态加载要求审查并失败。它不是对恶意 JavaScript 的安全证明；Electron 运行时隔离仍须保持。
- 许可证报告按实际 workspace 身份区分本仓库自有代码与第三方生产依赖，不为 CaseLite 指定许可证。第三方只允许当前明确准入的 MIT、Apache-2.0；其他表达式、UNKNOWN、AGPL 与商业许可必须先审阅并修改准入政策，默认失败。报告仅涵盖本机已安装的依赖，未安装的其他平台可选包单独列明。
- 覆盖率统计全部当前生产源码，包含未命中的进程入口；数值较旧报告降低可能来自统计范围扩大，不能删除未覆盖文件使报告变绿。主进程的真实桌面验证以打包测试证据为准，不算入 Vitest 覆盖率。
- 现有test:e2e只验证工程合成路径。Task演示另由check-task-body-demo.mjs验证；来源／Anchor和未来同步仍由各能力Issue实施。Yjs已进入真实本地正文测试，不等于双端同步通过。

## Task 与 Agent 桌面证据

打包后，在固定Node/pnpm环境执行 `node scripts/check-task-body-demo.mjs`：真实UI创建、正文与任务内容保存、A/B切换、确认后SIGKILL和重开，并检查项目／目录操作与界面几何。userData和sessionData在宿主确认的临时根，isolation.json记录真实路径；原件未启用记N/A。合成Key加解密及设置测试不调用真实Provider，不证明系统Keychain全局隔离。

`node scripts/check-agent-demo.mjs`验证合成SDK流、停止、同Run与重启中断历史；其MOCK_ONLY Provider与真实SQLite／Electron断言分列。不得把2条脚本、工程探针或截图拼成完整DEV-1657验收。

脚本每阶段有进程超时和失败现场；观察超时先核实原进程是否仍活，不能仅凭等候过期重复启动。确认终止后才依据新证据重试，所有失败与最终通过均保留。Task保存冲突对照、迟到ACK、真正OS中文IME、物理断网／断电、磁盘满、客户材料及人工接收必须按消费卡逐项说明，演示未覆盖不得写通过。
