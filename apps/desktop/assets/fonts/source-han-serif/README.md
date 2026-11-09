# 思源宋体本地文档字体

消费者：DEV-1624 本次用户授权的正文显示增量。仅用于可编辑文档/草稿，不替换原始 PDF 字体，不参与 Yjs 正文持久化。

- 来源：[Adobe Source Han Serif](https://github.com/adobe-fonts/source-han-serif)，官方 `release` 提交 `7889f11bf31170b5d092a083b357c8c8130f89e0`。
- 原文件：`Variable/WOFF2/OTF/SourceHanSerifSC-VF.otf.woff2`，未修改、未裁剪。
- 字节：19,747,252；SHA-256 `3b9451444b4a3554ab061a43cb79dc11c72c0dbc381f148c56c542dca9c0a7e3`。
- 许可：SIL OFL 1.1，原发布目录 LICENSE.txt 逐字节保留，SHA-256 `9ff5bb567e1b92c801fc1069e5fbf992ff8efccacb9db94e5959a5b3ba9bb903`，随同字体发射到安装包。
- 不通过 CDN 加载；只使用现有 Webpack 本地资源入口及 `font-src self`。本字体不含 U+20000；第二辅助平面的字使用相邻 jigmo 目录说明的 CC0 字库，其余缺字仍有系统后备，不承诺覆盖所有 Unicode。
- 回退：移除本资源发射和正文样式即可；不删除或迁移用户正文，不修改 PDF 原件。
