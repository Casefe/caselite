# ADR-018｜项目关系图的只读投影

状态：首版验证中。实施范围见 [DEV-1802](https://linear.app/logixy-ai/issue/DEV-1802)。

采用 [React Flow](https://github.com/xyflow/xyflow) 发布包 `@xyflow/react@12.12.1`（MIT，React 19 满足 peer 范围）。它提供画布、缩放和键盘聚焦。CaseLite 自行决定节点、可点击目标和关系。与手写 SVG 相比，可复用缩放、定位及焦点行为。自动布局和可编辑图谱留待真实需求明确。

项目、任务、文档仍由原 Application/SQLite 负责。图仅消费当前项目已读数据，既不存储节点，也不写关系。禁止拖动节点、连线、删除和关系推断。样式通过已有打包入口发射，沿用现行 CSP。

撤销 DEV-1802 提交可回到原占位栏，无需迁移。跨项目、证据关系、权限和大图规模均需重新验证。

已核对 d3 系列锁定安装包的 ISC/BSD-3-Clause 全文，逐包精确准入并随安装包提供 THIRD-PARTY-GRAPH-NOTICES。Zustand 为 React Flow 的内部传递依赖，CaseLite 页面不直接使用。
