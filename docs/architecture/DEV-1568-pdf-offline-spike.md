# DEV-1568｜PDF 离线兼容测试记录

## 范围与版本

- 目标：用合成 PDF 验证 Electron 桌面阅读依赖、Worker 与 macOS 打包路径。
- 固定版本：`react-pdf@11.0.0`、`pdfjs-dist@6.3.289`、`@electron-forge/maker-zip@8.0.1`；Electron `45.1.0`、Forge `8.0.1`。准确版本仍以本分支锁文件为准。
- 输入：`tests/fixtures/case-materials/` 的合同文字版、扫描版、双页重复文字及损坏 PDF；全部为公开合成数据。
- 使用唯一 Forge/Webpack 主链与 macOS ZIP maker。ZIP 未签名、未公证，不用于公开分发。

## 测试页边界

应用首页的“打开 PDF 测试页”只展示编入应用的固定样本。它有页码、缩放、文字层选择和安全错误提示；不读取任意文件路径，不保存 Matter、Anchor、OCR 或客户文件。扫描件没有文字层，损坏 PDF 应显示错误。双页重复句子只证明两页可分别显示与翻页，不代表正式锚点定位已实现。

Worker、CMaps、标准字体、WASM 和文字层 CSS 由 Webpack 放进 renderer 的本地资源目录。开发态与打包态使用相同相对路径，不依赖 CDN。`pnpm test:packaged-pdf` 在应用内禁止 HTTP(S) 请求后，通过真实 Chromium renderer 验证文字 PDF 的文字层和画布、扫描 PDF 的画布与无文字层、双页翻页及第二页标记；不会打开调试端口或放宽 Electron Fuses。

PDF.js 文字层需要动态样式属性，因此 CSP 单独允许 `style-src-attr 'unsafe-inline'`。打包应用从 `file://` 运行时，PDF.js 会用本地 Blob 包装模块 Worker，所以 `worker-src` 只允许同源及 `blob:`；脚本不开放 `blob:`，连接仅允许同源，图片仅允许同源及明确的内存资源。正式文件导入前须重新审查这一 CSP 与资源身份边界。

## 验证状态与人工检查

- `pnpm typecheck`、`pnpm check:quick`、`pnpm package`、`pnpm make`：记录每次真实结果。
- `pnpm test:packaged-pdf`：2026-10-31 已在开发者 macOS 终端返回 `Packaged offline PDF smoke test passed.`，包括 PDF.js 原生 Worker 检查。自动化环境的 `SIGABRT` 不作产品故障结论；后续代码变化仍须重跑。
- 人工检查：2026-10-31 开发者通过截图确认开发态窗口启动、文字版 PDF 显示与可选择文字、扫描版 PDF 显示。打包态的双页翻页由自动检查通过；开发态的双页翻页、缩放、损坏 PDF 提示、完全离线人工冷启动和关闭后重开尚未人工检查。开发者随后要求结束测试，并接受已记录的验证范围。
- 大文件：当前没有合成大文件夹具，未测内存、卡顿、超时或失败提示；不能据此承诺大文件可用。需要在正式阅读器 Issue 中补做带大小上限的验证。
- 尚未覆盖：超大文件、加密 PDF、签名/公证、正式 SourceVersion/Anchor、OCR 与任意文件导入。后续问题应归入相应 Issue，不把本测试页当作产品能力。

## 回退

在未合并时撤回本分支即可移除 PDF 依赖、测试页、Worker 静态资源和 ZIP maker；不会修改现有用户数据。构建产物可通过 `pnpm clean` 清理。
