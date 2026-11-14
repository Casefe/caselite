# ADR-038｜本地默认目录与个人材料入口（DEV-1855）

状态：按2026-11-13用户授权、现行02/03及主控准入实施；生产接线与业务验收待实际证据，不以仓外v4通过替代。

现行02修订2026-11-13T04:18:34.093Z，03修订2026-11-13T04:18:36.727Z。基线9f0d703及859批准源，保留现有dirty/index与4项未采用WIP。只实现默认目录、按需浏览、项目子目录投影及固定来源只读预览；不新增正文、Runtime、外发或隐藏Task。

SQLite/material_sources仍唯一来源Owner，新增task/personal互斥。旧Task/home/批次/创建草稿及旧非空Task DTO保持。个人来源不能进入旧Material、AI/联系人/Review/固定Snapshot消费者。新映射是组织投影，当前来源变更只追加固定行，不覆盖旧原件/正文/引用。

默认引用、Main私有locator及配置回执在同SQLite事务。Main内部Application通过宿主私有Port/Store编排定位记录，不声称token-only resolver；不向Domain、公开DTO/SDK、Renderer、模型、普通日志、通用preferences.set、命令回执或交付快照传播路径。只记显式默认目录定位，不记逐文件外部绝对路径；不改模型Key或引入书签依赖。

普通Electron45包不采用MAS securityScopedBookmarks。正常重启由当前合法窗口读取私有locator，逐级核profile、祖先和根dev/ino/birthtime、符号链接与实际访问，再发新会话能力；旧window/frame/epoch授权不复活。缺失/替换/权限失效时重选，不接管同名新对象。重选原根不改变其绑定修订；主动更改默认根则增加修订。项目目录必须同workspace、未归档且在默认根内，绑定时保存完整身份链，新grant前和每次效果核对。

配置locator仅定位/重验，生产root/entry/reader由folder-root-files一个Owner持有；不保留仓外配置候选的独立grant Map。复用现有window-capabilities真实主frame、撤权和同事件代次；Main folder IPC仅新增消费者，不另建全局权限/epoch平台。每个await效果之前/之后校验当前caller及本操作冻结的权威default/project版本，finally只关闭句柄。

配置与捕获用显式kind/operation命名空间。个人捕获reserved→snapshot_planned→staged→placed→ready，capture token/计划source/asset身份耐久；同次外部字节快照先经原MaterialFiles暂存/落位/sync，再同SQLite提交source/派生/映射/原键结果。未知ACK只查原键，确认成功后刷新失败不重提。未ready撤权/取消保留已知产物和原请求，ready取消不删来源。未知stage kind/version不误收、不覆盖。

0033_local_folder_workspace为本次正式追加消费者，旧33项字节/tag/when/hash不变；不是旧研究spike SQL身份。回退停新入口并保留追加表、locator、来源/原件、旧正文/回执，不使用旧App降库或旧备份覆盖后来数据。

验收须分开：真实格式processor/预算；新旧库及失败恢复；Task0个人捕获；真实typed IPC/chooser/每await权限；旧Task/知识库/编辑回执/交付回归；准确Mac包真实操作截图和律师接收。仓外v4只证明配置定位局部。生产独立Sol High和规则/权限对应三场景回归未齐，不宣称完成。Git commit/push/merge未获授权，打包/GUI另按主控时段。
