# ADR-004｜PDF Worker、附件元数据与不可变文件版本边界

- 状态：提议；DEV-1560 样本已冻结，DEV-1568 打包资源已构建，运行态与 P1 文件/Anchor 合同仍待验证
- 日期：2026-10-30
- Linear Issue：[DEV-1558](https://linear.app/logixy-ai/issue/DEV-1558)、[DEV-1568](https://linear.app/logixy-ai/issue/DEV-1568)
- 影响模块：未来 `files`、`pdf`、`local-db`、`application`
- 代码位置：`apps/desktop/src/renderer/PdfSpike.tsx` 和 Webpack/Forge 配置；仅为合成样本兼容测试，不含案件文件

## 背景与问题

法律文件必须保留原件版本、派生文本和引用定位的区别。PDF.js 负责解析和渲染，不应成为业务真相；附件内容不能在原对象上覆盖。

## 必须满足的不变量

- 每份文件有稳定 Asset/AssetVersion 身份；新内容产生新版本，不覆盖旧对象。
- 文件先处于受控状态，完整性/哈希验证通过后才可标为可用；未来共享时再发布可用事件。
- PDF worker、viewer、选择/Anchor 和业务元数据分离；路径和原始文件不直接交给 renderer。

## 候选方案

| 方案                                            | 结论 | 原因/证据                                                                                                          |
| ----------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------ |
| `react-pdf` + `pdfjs-dist` 仅用于受控阅读与定位 | 提议 | [PDF.js](https://mozilla.github.io/pdf.js/)是基于 Web 标准的 PDF 解析/渲染平台；仍需 DEV-1568 实测 worker 与打包。 |
| 覆盖原文件或把 PDF 页面文本当作唯一原件         | 放弃 | 破坏版本、来源与 Anchor 可核查性。                                                                                 |
| 将客户文件放入仓库或 `desktop/resources`        | 放弃 | 公开仓库与构建静态资源边界不允许。                                                                                 |

## 验证与交付

- DEV-1560 先提供公开、合成的合同 v1/v2 和扫描副本。
- DEV-1568 验证离线 package、worker 资源、页码和失败路径；P1 再验证 SourceVersion/Anchor。
- DEV-1568 测试页将固定合成 PDF 编入 renderer，并将 Worker、CMaps、标准字体与 WASM 编入本地打包资源；不开放任意路径或客户文件。PDF.js 在 `file://` 无同源标识时以本地 Blob 包装模块 Worker，因此 CSP 的 `worker-src` 仅放行同源及 `blob:`；文字层所需的样式属性单独放行，脚本仍只允许同源。此策略需在正式文件接入时重新审查。
- macOS 首发兼容测试只生成 Forge ZIP；当前未签名、未公证，不能当作可分发安装包。自动化构建成功不等于图形运行验收通过。
- 回退：失败文件保持不可用状态；不覆盖最后一个完整版本。

## 后果与重新评估条件

改变文件版本状态机、哈希算法、对象位置、OCR 派生物关系或 PDF worker 打包策略时，需新的 ADR 与迁移/回退计划。

## DEV-1863 有界增量｜解析宿主与固定来源｜2026-11-16

- 状态：提议。只覆盖隐藏解析窗口，不是前台阅读验收。
- 问题：不可信 PDF 的解析窗口若复用持久 Session、业务 preload 或任意 file URL，页码和选区就无法保持在打开时的那一份字节上。
- 决定：`pdf-view` 不授予 business、appearance、consent、probe。解析窗口不设置 preload，每份文档使用 `caselite-pdf-view-<nonce>` 内存 Session（无 `persist:`，`cache: false`），权限与下载拒绝，弹窗和导航拒绝。资源只允许该固定 file 入口、其所在打包资源根、`blob:` 与 `data:`；http(s) 与资源根以外的 file 取消。页码脚本只拼入安全整数和布尔字面量。页码与选区通过打开时的 SHA-256 及可选 SourceVersion 绑定，哈希或版本不符、越页、空选区或超长选区拒绝。
- 放弃：放宽 pdf-worker CSP；把工作台 preload 装进解析窗口；新增 HTML 浏览器或第二 Runtime；把选区写成第二份来源真源。
- 未完成：`PdfReader` 仍在工作台 renderer 内阅读，本增量没有把前台阅读移出业务 preload。真实 Electron 图形路径、扫描件/坏页/超大 PDF 与外链图片零外发仍待该宿主的运行证据。
- 回退：撤回解析窗口接线与 `pdf-view` 角色，恢复原隐藏窗口；不改原件、旧版本或 CSP 放宽。撤回会去掉本增量的分区、资源根和来源绑定。
