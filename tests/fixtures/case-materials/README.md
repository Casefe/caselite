# CaseLite 合成合同样本

这些文件专为 DEV-1560、后续 PDF/Anchor 测试和人工演练制作，全部为虚构内容；不得替换为真实案件资料、客户合同、个人信息或密钥。

## 目录

- `development/`：开发期间可见的 v1、v2、扫描副本和故意损坏文件；
- `regression/`：独立 Matter 的采购合同，不得用开发合同的事实、金额、条款或结论污染它；
- `source/`：可审阅的 UTF-8 文本源文件；其中 v1/v2 除第二条第 2 款的付款期限外完全相同；
- `manifest.json`：每个二进制样本的 SHA-256、用途和文本层预期；
- `golden-standard.md`：律师确认前的人工预期草案和后续合同映射。

## 生成与校验

在 macOS 开发机运行：

```bash
pnpm fixtures:case-materials
pnpm test:contracts
```

生成过程使用 macOS 自带 CUPS 创建文本 PDF，再用 `sips` 栅格化产生扫描副本；不安装新的项目依赖。首次运行后的 PDF 和 `manifest.json` 应纳入版本控制。CI 只校验已提交文件和哈希，不在 Linux 上伪造 macOS PDF 生成。

## 人工确认状态

本目录提供的是**待律师确认的测试预期**。在 DEV-1560 标记完成前，律师应确认：付款期限由 10 日变为 30 日是唯一实质变更；金标准中的“受影响/不受影响”判断适合后续功能验收；以及所有材料均为合成公开内容。
