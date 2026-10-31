# CaseLite 合成合同样本

这些文件专为 DEV-1560、后续 PDF/Anchor 测试和人工演练制作，全部为虚构内容；不得替换为真实案件资料、客户合同、个人信息或密钥。

## 目录

- `development/`：开发期间可见的 v1、v2、扫描副本、跨页重复定位样本和故意损坏文件；
- `regression/`：独立 Matter 的采购合同，不得用开发合同的事实、金额、条款或结论污染它；
- `source/`：可审阅的 UTF-8 文本源文件；其中 v1/v2 除第二条第 2 款的付款期限外完全相同。跨页样本的 `[[PAGE_BREAK]]` 在生成 PDF 时转换为换页符；
- `manifest.json`：每个二进制样本的 SHA-256、文本源 SHA-256、用途和文本层预期；
- `golden-standard.md`：律师已确认的业务预期，以及供后续验收的技术映射。

## 生成与校验

日常核对固定样本（macOS 和 Linux 均可运行，**不会改写 PDF 或清单**）：

```bash
pnpm fixtures:case-materials
pnpm test:contracts
```

只有经审阅修改源文本或生成程序时，才在 macOS 开发机运行 `pnpm fixtures:case-materials --refresh`，然后逐个检查 PDF、`manifest.json` 的变化，并重新进行律师确认。更新过程使用 macOS 自带 CUPS 创建文本 PDF，再用 `sips` 栅格化产生扫描副本；不安装新的项目依赖。CUPS 写入生成时间和文件 ID，且二进制布局可能随环境变化，因此**重新生成的 PDF 不保证与已提交文件逐字节相同**。已提交的 PDF 和哈希清单是固定验收输入；日常命令只验证它们及其文本源。CI 不在 Linux 上伪造 macOS PDF 生成。

## 人工确认状态

律师已于 2026-10-31 在 [DEV-1560 实施记录](https://linear.app/logixy-ai/issue/DEV-1560) 中确认原有人工金标准的业务预期。该确认适用于原有合同样本和业务判断；同日已人工查看新增跨页样本的两页内容。技术映射仍待代码审阅。以后修改 PDF、文本源或业务预期，须重新核对并确认。
