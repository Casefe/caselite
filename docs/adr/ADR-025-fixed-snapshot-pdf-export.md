# ADR-025｜同一固定快照的本地 PDF 导出

- Issue：DEV-1629；2026-11-08用户授权本地PDF出口、双格式同快照/去重/实际打开验收。
- 基线：02b6c17；实施为本对话，独立只读复核snapshot_review，律师接收另记。
- 本轮回读现行02/03/05/06更新时间：2026-11-08T12:01:15.982Z、12:01:18.958Z、12:01:27.705Z、12:01:30.085Z。
- 状态：实现与验证中。

沿task:v1/受控Application/同一SQLite，不改正文或快照格式、不新增数据库迁移。原delivery_exports以snapshot/format/converter唯一；保留docx-9.15.3-v1及全部旧回执，新PDF使用electron-45.1.0-pdf-v1。查询省略format时仍读取docx，旧客户端/回执保持兼容；新增格式与转换器成对校验。

PDF只从read_snapshot已校验的固定Yjs状态构建受控静态HTML；沿现有正文节点白名单、文字标记、标题/列表/表格及来源边界。未准入SourceRef仍为空。它是一次性打印投影，不从当前编辑器DOM读取、不成为第二正文真源。当前没有已准入static-renderer；复用已有Yjs校验及节点语义写最小静态映射，不为PDF增加完整编辑器或转换服务器依赖。未知节点拒绝。

使用现有Electron webContents.printToPDF公开API，单独隐藏BrowserWindow，sandbox=true、contextIsolation=true、nodeIntegration=false、无preload。隔离非持久session，拒绝网络/权限/下载/新窗口/外部导航，HTML转义所有用户内容，CSP无脚本、仅nonce样式与本地字体。打印窗口限时、成功/失败/取消均关闭。用本地字体FontFace加载确认中文字体，不以静默fallback掩盖缺失。导出标草稿，输出hash/正文修订与snapshot可核对；双格式不要求相同分页或字节hash。

复用既有预留→生成→文件fsync/不覆盖落位→ready/活动/回执同事务机制。原键核对和重放规则不变。按请求scope+原键取消运行，不绕过对象校验；中断可能留下pending身份/受管中间产物，不能误报成功，后续恢复同一身份。新格式不会覆盖已有Word或PDF。

打开仍使用独立工作副本，PDF注释/Word编辑不回写受管文件。另存副本由宿主原生对话框选择目标，renderer不得传路径；拒绝受保护userData内目标、符号链接和现有同名文件，不覆盖原件。另存失败/取消与已生成产物状态分开，不为了另存失败重新生成。该文件副本不冒称发送/定稿或新交付版本。

验证双格式同snapshot、旧版/新版隔离、旧Word兼容、重复与并发、跨scope/非法格式、取消/字体/打印/文件和事务故障、重启/最终落位恢复，实际PDF文字回读、表格/长表分页及macOS阅读器打开。安全基线/精确diff和独立审查保持。回退可关闭PDF入口，但保留PDF格式读取、原文件/回执，禁止就地删行或降级丢产物；Word原有读取和hash不变。

原生首测发现以家族名Songti SC写local()不能保证命中实际字体；按系统字体name表核对，改为Regular/Bold的完整字体名与PostScript名，并分别等待字体加载。CSP与禁网保持，不用放开外部字体规避失败。来源：https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@font-face/src 。
