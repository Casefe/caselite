# DEV-1767｜Pi-law差异验收与退出证据索引

本文件只汇总 Pi-law harness 研究退出条件与既有差异证据的去向，不是产品验收、律师接收或换内核决定。DEV-1657 保留 CaseLite 总体产品验收，DEV-1655/1788 保留各自接受语义；本卡不新增 Runtime、输入装配、运行或候选真源，不修改代码、规则、CI 或依赖。

基线：`origin/main` `d5307fcb704c194a3698c2e35e85aa8b1af1417d`。研究来源：Linear《研究报告｜CaseLite Agent Harness》2026-11-15 版（H01—H12、G01—G13、S6）。结果标记沿 AGENTS：`PASS_REAL/MOCK_ONLY/NOT_RUN/BLOCKED/FAIL`。

## 1. 退出判据

| 编号 | 判据（研究原意） | 当前判定 | 依据 |
| --- | --- | --- | --- |
| E1 | 没有经归因确认的 Core 内核缺口则保留 Pi，退出选型 | 暂按保留 Pi；未形成整卡结论 | 已确认 C 类缺陷 0 项，只表示暂无归因证据；1765 对照未运行 |
| E2 | 候选不能关闭自动重试/默认工具、制造第二状态权威、污染来源或不可回退则淘汰 | NOT_RUN | 无候选对照获准；1766 保持条件队列，不是本卡前置 |
| E3 | 全部硬边界通过、专业质量不劣且实测收益覆盖迁移成本才提迁移申请 | NOT_RUN | 性能/成本门槛须由 Owner 在实验前冻结 |
| H12 | 拆掉候选适配后原 Task/Run/Yjs/来源仍可读；同 SHA 流式/停止/回源/重开可由律师验证 | 静态部分 PASS_REAL；运行移除对照与律师验证 NOT_RUN | 见第 3 节 |

## 2. 前置证据状态

本卡硬依赖均未产出准确候选证据，因此差异汇总整体为 BLOCKED。依赖完成后，只把各卡同 SHA 的结论、命令/退出码与失败路径链接到此表，不复制其实现或演示。

| 依赖 | 应提供的差异证据 | Linear 状态（2026-11-16 读） | 本索引判定 |
| --- | --- | --- | --- |
| [DEV-1758](https://linear.app/logixy-ai/issue/DEV-1758) | 1651 真实 payload/冻结清单与 EvidenceRef 兼容断言 | 待排期 | BLOCKED |
| [DEV-1759](https://linear.app/logixy-ai/issue/DEV-1759) | 取消/越界/迟到的派发屏障负向回归 | 待排期 | BLOCKED |
| [DEV-1761](https://linear.app/logixy-ai/issue/DEV-1761) | CandidateEnvelope 与既有候选/Document 命令兼容、接受幂等 | 待排期 | BLOCKED |
| [DEV-1762](https://linear.app/logixy-ai/issue/DEV-1762) | 事件检查点、partial/重复/乱序/保存失败恢复回归 | 待排期 | BLOCKED |
| [DEV-1765](https://linear.app/logixy-ai/issue/DEV-1765) | 复用 1560 样本与人工金标准的评测基线及返工指标 | 待排期 | BLOCKED |

## 3. 本轮可复用的既有工程证据

以下均在上述基线、Node 24.22.2、pnpm 11.0.9 下实际运行，只证明列出的断言；Provider 为合成流，不代表真实 BYOK、Electron 打包态或律师接收。

| 证据 | 命令 | 结果 |
| --- | --- | --- |
| Pi Core＋合成流单次派发、无工具、取消、迟到丢弃、超时边界；受控 HTTP transport；Run 持久化、中断恢复不重派、跨任务/工作区隔离；Agent 合同与输入合同 | `pnpm exec vitest run tests/contracts/agent-contract.test.ts tests/contracts/agent-input-contract.test.ts tests/integration/agent-history.test.ts tests/integration/pi-runtime.adoption.test.ts tests/integration/pi-runtime.test.ts tests/integration/pi-runtime.transport.test.ts packages/application/src/active-agents.test.ts packages/application/src/agent-copy.test.ts` | 8 文件 109 断言通过，exit 0；工程断言 PASS_REAL，Provider MOCK_ONLY |
| H12 静态边界：Pi SDK 仅由桌面主进程适配与演示入口导入，`packages/application`、`packages/contracts`、`packages/local-db` 无引用；Application 只经 `AgentRuntimePort` 调用；Run 由 local-db `agent_runs` 唯一持有（ADR-011） | `rg -l "@earendil-works/pi-" apps packages scripts`；`rg -n "earendil\|pi-agent\|pi-ai" packages/local-db packages/application packages/domain` | 第一条仅命中 `apps/desktop`（`src/main/adapters/pi-runtime.ts`、`agent-demo.ts`、`agent-real-demo.ts`、`customer-demo.ts`、`important-date-mock.ts` 及 package.json）与准入脚本；第二条无命中。PASS_REAL（静态） |

静态边界只说明移除 Pi 适配不需要迁移 SQLite/Yjs/来源数据格式；“实际删除适配后构建并读回原数据”的对照未运行（NOT_RUN），不能据此宣称 H12 全部通过。架构门禁当前仅禁止 Renderer/Preload 导入 Pi，packages 层不导入 Pi 由依赖准入与现状保持，未有专门断言。

## 4. G01—G13 归属索引

本卡只汇总，不承接修复。归因 A=配置/安全策略，B=Application/消费者未接线，C=内核缺陷（当前均未成立）。

| 缺口 | 归因 | 主责原卡 | 本索引待收证据 |
| --- | --- | --- | --- |
| G01 单次派发、0 重试 | A | 1586/1652（1760 补差异） | 已有：上节 pi-runtime 单次派发断言 |
| G02 工具默认拒绝 | A＋B | 1654→1652 | 已有：未知工具拒绝无后续请求；正向白名单待 1654 |
| G03 无历史消息批次 | A＋B | 1699/1651/1652 | 待 1699 版本化消息 Query |
| G04 Manifest/payload hash 绑定不完整 | B | 1651/1652/1653 | 待 1758 |
| G05 4000/32000 上限不一致 | B | 1580/1651 | 待 1758 |
| G06 包装分支 hash 不统一 | B | 1651/1652 | 待 1758 |
| G07 2048 输出/60 秒/推理关闭 | A | 1652/1586 | 已有：60 秒边界断言；调整须另批 |
| G08 output_incomplete 消费者未检查 | B（待复现） | 1788 | 待 1788 合成 length 复现 |
| G09 普通候选另存与来源绑定 | B | 1655 | 待 1761 |
| G10 用量/费用投影窄 | A＋B | 1652→1653→1650 | 未知费用保持 UNKNOWN |
| G11 恢复仅 running→interrupted | A | 1653/1762 | 已有：中断不重派断言；回归待 1762 |
| G12 Port 仅 onText/onEnd | A | 1652/1653 | 有获准多步骤消费者时再扩 |
| G13 已锁 SDK 故障场景未重跑 | 验证缺口 | 1586/1691/1762 | 本轮 pi-runtime 合成流已重跑；真实故障注入待 1762 |

## 5. 结论与回退

当前无 C 类缺口证据，按研究继续保留 Pi Core＋pi-ai/AgentRuntimePort，1766 不启动。本卡整卡未完成：依赖证据 BLOCKED，H12 运行对照、真实 Provider、Electron 打包态与律师接收 NOT_RUN。回退仅删除本文件，不涉及代码、数据或依赖。
