# DEV-1767｜PLH-12：Pi-law 差异验收与退出证据索引

> 隔离试做（分支 `cursor/trial-dev-1767-sonnet`，基线 `d5307fc`）。本文只索引证据位置与状态，不是产品合同、Issue 队列或验收结论；Linear 状态、依赖和优先级以实时数据为准。

## 范围与非目标

- 唯一结果：为 PLH-01—PLH-11 与原卡的差异证据、退出条件提供**一处只读索引**，使验收者知道每项证据应在哪里找、当前是什么状态。
- 不修改代码、规则、CI、依赖，不新增 Runtime、数据表或第二真源；不重复演示；不等待 Main（DEV-1766）、Skills、MCP 或所有候选。
- DEV-1657 保留产品总验收，DEV-1655/DEV-1788 保留各自接受语义。本索引不代替它们，也不使任何卡完成。
- 本文所有「Pi-law 差异」项均为 `NOT_RUN`：本卡未安装/运行任何新候选、未调用真实模型、未做律师验收。

## 状态词

`PASS_REAL`、`MOCK_ONLY`、`NOT_RUN`、`BLOCKED`、`FAIL`。下表「当前状态」只写本卡能核实的事实；仓库内已有测试文件的存在不等于对应整卡通过。

## 差异证据索引

| PLH 卡 | 复用的原卡 | 本卡需要的差异/退出证据 | 仓库内已有可复用位置（仅定位） | 当前状态 |
| --- | --- | --- | --- | --- |
| DEV-1756 PLH-01 | DEV-1580 | 法律任务定义与宿主接口差异合同 | `docs/plans/agent-input-candidate-contract.md`、`packages/contracts/src/agent-input.ts`、`tests/contracts/agent-input-contract.test.ts` | NOT_RUN |
| DEV-1757 PLH-02 | DEV-1586 / DEV-1654 | 能力授权差异与威胁模型 | `tests/contracts/agent-material-boundary.test.ts` | NOT_RUN |
| DEV-1758 PLH-03 | DEV-1651 | Manifest 与 EvidenceRef 兼容检查 | `packages/application/src/agent-input-budget.ts`、`tests/contracts/chat-material-preparation.test.ts` | NOT_RUN |
| DEV-1759 PLH-04 | DEV-1652 / DEV-1654 | 派发屏障负向回归 | `tests/integration/pi-runtime.test.ts`、`tests/integration/pi-runtime.transport.test.ts` | NOT_RUN |
| DEV-1760 PLH-05 | DEV-1586 | 调用预算与续跑政策差异 | `packages/application/src/agent-input-budget.ts` | NOT_RUN |
| DEV-1761 PLH-06 | DEV-1655 | 候选合同与接受幂等兼容检查 | `docs/plans/agent-input-candidate-contract.md`（候选段）、`tests/integration/document-review-actions.test.ts` | NOT_RUN |
| DEV-1762 PLH-07 | DEV-1653 | 事件检查点与恢复回归 | `tests/integration/agent-history.test.ts`、`tests/integration/document-review-reopen.test.ts` | NOT_RUN |
| DEV-1763 PLH-08 | DEV-1706 / DEV-1687 | Skill 版本与记忆边界差异 | `tests/integration/skills-import-preview.test.ts`（仅导入预览） | NOT_RUN |
| DEV-1764 PLH-09 | DEV-1581 | 连接器能力合同一致性检查 | 未发现对应仓库位置 | NOT_RUN |
| DEV-1765 PLH-10 | 既有样本 | 法律任务评测基线与返工指标 | `tests/contracts/case-material-fixtures.test.ts`（合成材料夹具） | NOT_RUN |
| DEV-1766 PLH-11 | 条件候选 | 仅在 Core 出现真实缺口后才有 Main 最小改造对照；非主线前置 | 无 | NOT_RUN（条件项） |

「已有可复用位置」是文件定位，不是对应差异证据已产出，也不表示这些测试在本卡运行过。

## 退出条件（索引项，不自行判定）

1. **无 Core 缺口则继续 Pi**：须由 PLH-01—PLH-10 的差异证据支撑；当前未确认 Pi 内核缺陷，但差异证据尚未产出，故结论为 `NOT_RUN`，不是「已证明无缺口」。
2. **移除候选后数据可读**：移除 harness 适配/能力注册后，Task、Run、Yjs 正文、来源与旧修订仍可读；需在冻结构建上执行，当前 `NOT_RUN`。
3. **同页闭环**：合成 UI → 真实固定材料 → 真实 BYOK 授权生成 → 回源 → 拒绝/接受新稿 → 重启；无 Key 人工路径保留。其原型阶段只能标 `MOCK_ONLY`，真实接线与律师接收由宿主及人工验收，当前 `NOT_RUN`。
4. **同构建 SHA 证据**：正常/失败/取消/重启与输入、来源修订记录须绑定同一构建 SHA；本卡不产生。

## 分项记录规则

设计完成、隔离工程检查、产品功能、律师验收分别记录，互不替代。每条差异证据交付时附：来源/合同、固定版本与许可、准确 Diff、命令与退出码、失败路径、未测项、独立审查、人工接收。回退：撤销适配/能力注册，保留原宿主数据与旧修订，不删除业务记录。

## 本文引用与未确认事项

- 依赖/阻塞（PLH-06、07、10、11）及各卡状态来自 `docs/当前交接快照.md` 的 Linear 快照（均为「待排期」），可能已过期。
- 未核实 DEV-1657/1655/1788 的当前实现完整度；未读取其 Linear 全文。
