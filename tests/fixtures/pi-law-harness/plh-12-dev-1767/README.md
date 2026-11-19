# DEV-1767｜PLH-12 Pi-law 差异验收与退出证据索引（Composer 隔离试做）

索引 ID：`PLH-12-DEV-1767-TRIAL-001`；版本：`0.1.0-trial`；基线提交：`d5307fcb704c194a3698c2e35e85aa8b1af1417d`。

## 唯一结果（试做范围）

在不动产品 Runtime 的前提下，交付可审阅的**差异验收路径**与**退出证据槽位索引**，供 [DEV-1657](https://linear.app/logixy-ai/issue/DEV-1657) 总验收与 PLH-06—11 差异卡消费。本目录为隔离试做产物，**不等同**产品功能完成或律师接收。

## 文件

| 文件                                                     | 用途                                                   |
| -------------------------------------------------------- | ------------------------------------------------------ |
| [exit-evidence-index.json](exit-evidence-index.json)     | PLH-12 退出条件、上游 PLH 依赖、证据槽位与 R1 用例映射 |
| [difference-acceptance.json](difference-acceptance.json) | 同页法律任务六步环路与 CaseLite Owner 对照             |
| 合同测试 `tests/contracts/pi-law-exit-evidence.test.ts`  | 冻结 JSON 结构与引用路径                               |

## 消费规则

1. **产品总验收**仍由 DEV-1657 Owner；本索引只汇总差异与退出证据，不重复完整演示。
2. **代表样本**固定引用 `tests/fixtures/case-materials/representative-task/baseline.json`（DEV-1682），不另建评测平台。
3. **结果词汇**仅使用：`PASS_REAL`、`MOCK_ONLY`、`NOT_RUN`、`BLOCKED`、`FAIL`。
4. **回退**：删除本目录与合同测试即可；不改 representative-task 字节与历史验收记录。

## 当前状态

全部产品路径与律师接收为 `NOT_RUN`；本试做索引与合同测试为 `MOCK_ONLY`/`PASS_REAL`（以试做报告为准）。
