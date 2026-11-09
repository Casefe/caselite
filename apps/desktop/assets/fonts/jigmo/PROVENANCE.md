# Jigmo2 扩展汉字补充字体

消费者：DEV-1624 本轮用户授权的中文/生僻字显示验证。思源宋体不含 U+20000；本文件补充第二辅助平面汉字，普通中文仍使用思源宋体。不用于替换原始 PDF 的字体。

- 官方来源：https://kamichikoichi.github.io/jigmo/ ，发布 2025-09-12。
- 固定来源：`kamichikoichi/jigmo` 提交 `a6893b2278e39747fc3476465f7fcacf0126bca8` 的 `docs/Jigmo-20250912.zip`。
- ZIP：35,559,738 字节，SHA-256 `5744c7386d129475d87607ca66d043c8793c65448adeaedc921b6931890e5d0b`。
- 原始 `Jigmo2.ttf`：35,661,996 字节，SHA-256 `5da3582efe77e22073b86b3b86b556d7111148a76b957cfb53318a91da2efff0`。
- 仅用 FontTools 4.60.1 / Brotli 将完整 TTF 转为 WOFF2（`TTFont(...); font.flavor='woff2'; font.save(...)`），没有裁剪、重画字形或改名。工具为临时验证环境，不增加产品依赖。
- `Jigmo2.woff2`：12,976,152 字节，SHA-256 `1197aee2e358acfb41b4a654922a14dbd664a59b10f2e31f5a6f70e7d5956a33`。
- 字体许可：CC0 1.0；原始 ZIP 中的 LICENSE.txt、README.txt、THANKS.txt 未修改并随安装包分发。构建工具仓库的 MIT 不代替字体的 CC0 许可。
- 使用 `unicode-range: U+20000-2FFFF`，覆盖发布说明列出的 Ext.B/C/D/E/F/I 与兼容补充。保留完整 SIP 字库；未按验收样本裁成几个字。未引入 Jigmo3，不承诺第三辅助平面或所有异体字。
- 验证：固定样本检查 cmap 非零、轮廓非空且不同于 `.notdef`、实际 Chromium 使用 Jigmo2、保存重开及截图；这不等于所有 Unicode 或字形设计逐字人工验收。
- 回退：移除补充字体、CSS 与资源发射，不更改用户 Unicode、Yjs 或 PDF 原件。
