# DEV-1579｜单PDF固定来源合同

设计消费者：DEV-1609／1610／1611／1615—1621、1649；依据现行02／03的固定Owner与失败边界。可执行最低DTO位于contracts/source.ts。本卡只冻结合同及合成负例，没有注册文件IPC、建表或实现PDF导入／定位；不以DTO测试冒充源文件或OCR产品验收。

## 身份、字节与读写

AssetVersion由文件Owner持有稳定UUID、不可变字节／SHA256／大小／MIME和ready。原始路径不是身份，也不进入Renderer合同。SourceVersion在明确Task内登记已ready的AssetVersion与hash；可选项目归组不自动扩大读取范围。来源升级新建版本，旧引用不跟随“最新版本”。同名不覆盖，初期允许同内容不同身份。

单文件仅用SelectAndStageAsset→CommitStagedAsset→ImportSourceVersion语义。取消选择无新对象；大文件复制／hash／PDF验证在短SQLite事务外。落位前中断、落位但未提交、ready提交后回执丢失分别恢复或保守识别孤立产物；不能将不可读／hash不符字节标ready。相同业务幂等键先核对原输入并查询回执，不因超时另造副本。原件清理只删除可证明无引用且无备份依赖的产物。

## 文字、页与几何

PDFPage.page_index为0基物理页；display_label仅展示，可为罗马数字或自定义页码。Anchor存固定SourceVersion、locator_version=1、物理页和原句／上下文／quads。持久坐标为PDF未旋转的默认用户空间，x向右、y向上；原点不假定是CropBox左下，保留PDF.js page.view的实际边界。user_unit单独保存，不预乘入坐标；rotation只记页面固有旋转。quad的8数顺序固定为选区阅读方向的左上、右上、左下、右下各(x,y)，由Viewer逆变换映射到该用户空间；旋转后不强制x或y大小关系，但退化／交叉四边形拒绝。屏幕缩放、DPR、滚动及显示页号不写入定位身份。Viewer使用同一PageViewport正逆变换，必须用0/90/180/270旋转及非零CropBox样本验证；DTO能解析不证明映射正确。

原quote保留本次选区文字，不做模型摘要替代。提取适配器保存原文及可核查范围；换行统一、空白／连字／Unicode规范化只能用于比对投影并保留到原选区的映射，不直接覆写quote。跨行、多栏、表格、中文标点和同页重复句按S08／S09样本冻结。最低一条Anchor只覆盖一个物理页；跨页选区拆为多条明确引用或提示尚不支持，不伪造一页包含全部。

ResolveAnchor先校验当前授权及固定来源字节、格式、物理页，再核对几何处原句。重复原句而位置不足返回AMBIGUOUS；版本／几何／原句冲突返回明确失败，禁止跳到第一个相似文本或新版本。SOURCE_MISSING、VERSION_MISMATCH、FORMAT_UNSUPPORTED、PAGE_MISSING、QUOTE_MISMATCH、AMBIGUOUS、FORBIDDEN、OCR_REQUIRED逐项显示可恢复原因，失败保留旧引用。

## 标注、引用和扫描件

Annotation拥有高亮身份、AnchorRef、样式和标注修订；备注绑定公共Yjs正文，不另建可编辑字符串真源。查询返回已保存标注／备注修订；未保存或回执未知不供后续操作假装引用。删除高亮不级联破坏仍被引用的Anchor。

SourceRef只是source_version_id＋anchor_id稳定引用值，不默认增加source_refs表。AppendExcerpt由Document公开能力保存quote＋SourceRef与单独note，quote须与固定Anchor核对；改写或AI输出不能冒充原文。来源标签显示可读材料标题／物理页，外部文档保留文本说明，不输出本机秘密路径。法律支持关系和专业Citation不由本合同建立。

扫描件由DEV-1649单独接入本地Vision：派生文字绑定固定来源、物理页／可信区域、引擎及渲染配置。locator_granularity显式分text／region／page：可靠PDF文字层用text；当前ocr_candidate只准page或region，必须带固定text_derivation_id，页级无quads，区域级必须有可信框。resolved只表示按声明粒度定位，不表示候选文字已人工核对或支持法律结论。人工核对后精确文字引用由1649追加可追溯核对记录与合同验证，不能改标pdf_text伪装识别来源。重跑不覆盖旧Anchor和人工备注。本变体承诺扫描件，OCR未过不能用“无文字层”提示替代总验收。MinerU等云备用需另确认Key、页范围和费用，不自动外发。

## 消费者验收与回退

合同负例覆盖ready／非法路径、物理页／显示号、坐标有限性与CropBox、重复原句两处、未知定位格式、OCR派生引用及失配结果。固定PDF样本复用case-materials/manifest.json中的文字v1/v2、双页重复、扫描和损坏文件，不改已接受金标准。实际读取字节、复制失败／权限／磁盘满、重启回跳、旋转缩放、OCR取消恢复尚由消费者真实运行。

基础图片／DOCX外部打开只交独立工作副本（非硬链／软链），源hash不变，修改不自动回写；本卡不接入Office引擎。合同回退可撤回DTO和本说明，未新建用户数据；后续格式升级需保留旧二进制、原件和定位版本，不静默改写。
