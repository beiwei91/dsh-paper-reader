# 论文阅读器 · Paper Reader（DSH 插件）

在 DeepSeek Harness（DSH）右侧栏新增一个「论文」标签页，把 PDF 论文当作可读、可标注、可对话的对象：**连续滚动阅读、目录跳转、全文搜索、记忆阅读位置、Ctrl/Cmd + 滚轮缩放；八色高亮、下划线、页面文本框与边注徽标；一键生成结构化摘要提示词；把当前论文的批注导出为新的 PDF 副本；选中原文可引用到对话、让 agent 解释或翻译**。也支持 arXiv 链接/ID 与关键词搜索直接打开论文；agent 通过四个**只读**工具（`paper_info`、`paper_outline`、`paper_read`、`paper_search`）读取当前会话里打开的那篇论文。扫描版 PDF 会在阅读器空闲时做**文本级 OCR**，识别文本进入逐页文本缓存，因此页内搜索、翻译和 `paper_*` 工具同样可用。

![论文阅读器示意（功能示意图，非真实截图）](docs/preview.svg)

- 运行环境：在 DSH **0.2.2-rc.3** 上开发与验证；本轮不声明 `engines.dsh`，也没有 npm 发布。
- 命名：包名 / 模块 loader 名 = **`dsh-paper-reader`**（来自 `package.json.name`，也是 bundle patch 的 `name` 字段）；cordis 插件行 id = **`paper-reader`**（`cordis.patch.yml` 的 `id`）；GitHub 仓库 = **`https://github.com/beiwei91/dsh-paper-reader`**。
- 分发：**只走 GitHub**（仓库 + tag + Release）。**当前发布版本为 `v0.2.0`**（本仓库树包含八色标注、下划线、文本框、页边距徽标、摘要提示词、批注 PDF 导出、最近打开、Ctrl/Cmd + 滚轮缩放等）；更早的 `v0.1.0` 是已发布的预发布版本，其 tag/Release 保留、不再移动。npm 发布为未来可选项（unscoped 名 `dsh-paper-reader` 已被无关项目占用）。
- 许可证：MIT；内置 PDF.js（Apache-2.0）、OCR 组件（`tesseract.js`、`tesseract.js-core`、语言数据等）与批注导出用的 `pdf-lib` 栈（MIT）的第三方许可见 [`THIRD-PARTY-LICENSES.md`](THIRD-PARTY-LICENSES.md)。

---

## 功能

### 打开论文

- **本地 PDF**：把文件拖进「论文」面板，或粘贴本机绝对路径（经 DSH 的工作区文件读取；单文件上限 32 MiB）。
- **arXiv 链接 / ID**：支持 `https://arxiv.org/abs/…`、`https://arxiv.org/pdf/…`、裸 ID（如 `1706.03762`）与版本后缀（`v2`），也支持旧式 ID（如 `cond-mat.mes-hall/0601001`）。
- **arXiv 关键词搜索**：输入关键词，列出标题、arXiv ID 与发布日期，点一条即可打开（单次最多 10 条）。
- **最近打开**：空状态里列出本浏览器最近打开的论文（**最多 12 篇，最新在前，按论文 key 去重**）。点一条即可重新打开：优先使用 Host 已保存的字节；Host 找不到时回退到重读原来的本地路径。鼠标悬停到某一行时行尾出现 **×**，可把该条目从列表移除；重开失败时错误会显示出来，且**不会**自动删掉这条记录。
- **多标签**：右侧栏可以同时打开多篇论文，每个标签各自记住自己打开的那篇。切换到右栏其它标签时标签页保持打开；隐藏约 1.5 秒后释放 PDF worker / 文档 / 画布，切回来再从字节重载（页面与缩放沿用记忆位置）。

### 阅读

- 连续滚动，按需渲染当前页及邻近页的位图，远离当前页的页面会释放，长论文也不至于吃满内存。
- **目录**：解析 PDF 书签，缩进显示层级与页码；有页码的条目可点击跳转。
- **全文搜索**：逐页搜索并显示命中次数与上下文片段，点击结果跳转并高亮；单次最多返回 60 页命中。
- **阅读位置记忆**：按论文记住页码与缩放比例，下次打开自动回到上次位置。
- **Ctrl/Cmd + 鼠标滚轮缩放**：以光标所在的页内位置为锚点缩放（缩放后光标下的内容不会跳走），范围 **25%–400%**；普通滚轮仍然滚动页面，不会被吃掉；工具栏的 − / + 按钮也保留。
- **高倍缩放时的横向滚动**：页面比面板窄时保持居中；页面比面板宽时页面区域可**水平滚动**，不会再把宽页裁掉或卡住。
- 工具栏：目录 / 搜索 / 笔记 / 下划线 / 文本框 / 摘要 / 导出 / 缩小 / 当前页码 / 放大 / 适宽，以及扫描页 OCR 进度。
- 缩放下限 25%、上限 400%；首屏会自动按面板宽度适配。

### 标注：高亮、下划线、文本框与边注

- 选中文字后出现工具条：**八色调色板**（4×2 排列）、引用、解释、翻译、复制。
- 调色板（Client 与 Host 共用同一份颜色白名单，旧的四色保持原有渲染）：

  | 颜色 | 色板 | 高亮填充 | 下划线 / 笔记徽标 |
  |---|---|---|---|
  | `yellow` 黄 | `#ffd400` | `rgba(255,214,0,.35)` | `#c9a100` |
  | `green` 绿 | `#3cc878` | `rgba(56,200,120,.35)` | `#27995a` |
  | `blue` 蓝 | `#5b9dff` | `rgba(80,150,255,.32)` | `#3b7bd8` |
  | `pink` 粉 | `#ff7ab4` | `rgba(255,120,180,.35)` | `#d4568c` |
  | `orange` 橙 | `#ff9f2e` | `rgba(255,160,40,.35)` | `#d97a12` |
  | `purple` 紫 | `#a07aff` | `rgba(168,120,255,.35)` | `#7c53d6` |
  | `cyan` 青 | `#2fc8dc` | `rgba(60,200,220,.35)` | `#1596a8` |
  | `red` 红 | `#f04646` | `rgba(240,80,80,.32)` | `#c92b2b` |

- **下划线工具**（工具栏「下划线 / Underline」）：开启后选中文字即直接加下划线（不弹工具条）；画成 **2 px 底线、无填充**，和同一页+同一段引文锚定，点击可打开边注编辑器；工具栏下方有独立的八色选择条；Esc 退出该工具。
- **文本框工具**（工具栏「文本框 / Text box」）：开启后点击页面空白处即放置文本框并直接进入编辑；位置按**页面宽高的比例**（`xPct` / `yPct`）锚定，所以任何缩放级别下都停在同一位置、且不依赖文本层。**Escape 或失焦即提交**，内容为空则删除该文本框；靠近页面边缘时向页面内部生长。
- **文本框不可拖动**（有意设计）：页面上的拖拽是选文字手势，拖动会与选择冲突；要换位置请删除后重新放置。
- **边注徽标**：有边注的高亮/下划线会在页面右侧页边距显示一个**小圆点**（颜色随标注），位置固定在该标注最后一行之外，不压住字形；点击圆点直接打开该边注。徽标随标注一起重画/移除。
- 高亮/下划线按「页 + 选中文本」锚定，绘制是**字符级**的：只覆盖真正选中的字符，而不是整行文本 run；高亮矩形在垂直方向做了内缩，相邻行的色块不会糊成一片（点击命中仍按实际绘制框）。下划线的点击热区是整行未裁剪的文本框（2 px 线本身太细）。
- 点击已画出的高亮/下划线可打开边注编辑器，写、改、删边注；文本框点击则编辑其内容。
- **笔记面板**：每行按类型标注（`高亮 · p.N · 摘要文字 — 边注`、`下划线 · …`、`文本框 · …`）。点击一行会**滚到该标注本身附近并打开编辑器**（不是只跳到页顶），高倍缩放下同样成立；若缓存已失效、引文暂时定位不到，会等文本层重建，超时后才退化为跳到该页顶部。
- 标注按论文保存在本地，关掉再打开仍在。
- **存储模型**：文件仍是 `{ key, highlights: [...] }`（字段名与 `/paper-reader/api/annotations` 路由为兼容旧数据而保留），每个条目的 `kind` 为 `'highlight' | 'underline' | 'text'`。**缺少 `kind` 或值未知的旧数据按 `highlight` 读取**，旧标注因此自动沿用，不需要迁移步骤；未知颜色回退为黄色。高亮/下划线必须有 `quote`，文本框必须有 `xPct`/`yPct` 与非空 `text`。

### 摘要提示词（Digest）

工具栏的「摘要 / Digest」按钮会从阅读器已经知道的信息拼出一条**结构化摘要提示词**：

- 论文事实：标题、总页数、目录章节（最多 30 个标题）和「扫描页是否有 OCR 文本」。
- 明确要求 agent 先用 `paper_info`、`paper_outline`、`paper_read`、`paper_search` 读取论文，先看摘要/结论/目录，再按需精读。
- 固定输出小节：问题与动机、方法与技术路线、主要贡献、实验与结果（数据集、指标、关键数字）、局限与风险、可复现性（代码、数据、超参、算力）、阅读顺序建议；没有依据的写「未提及」，不要编造，并尽量标注页码/章节。

提示词**一次性写入对话输入框**（单次编辑器写入，不自动发送），由用户确认后自行发送。输入框不可用时回退到剪贴板，并用工具栏提示说明结果。

### 导出批注 PDF（Export）

工具栏的「导出 / Export」把**当前论文的全部标注**画到原 PDF 的副本上并**触发浏览器下载**：

- 输出文件名 `<论文名>.annotated.pdf`（论文名为空时为 `annotated.pdf`；非法路径字符会被替换）。
- 高亮画成半透明矩形；下划线画成 2 pt 线段；文本框在浏览器里按阅读界面字体（含中文回退）栅格化成 3× 超采样 PNG 后嵌入，因此中英文都能正确显示。
- 旋转页面（90°/180°/270°）按页面旋转矩阵换算坐标，标注位置与阅读器一致。
- **原文件永远不会被修改**：字节只读进内存中的副本，结果作为浏览器下载交给用户；不写 Host、不发网络请求。
- **边注正文故意不写入 PDF**：`.annotated.pdf` 只含高亮/下划线/文本框的可见图形，边注仍只保存在插件的标注数据里。
- 导出是**手动、一次性**操作；没有标注或文档尚未就绪时按钮禁用。加密 PDF 会被明确拒绝（无法写入副本），文本层里定位不到的引文会被跳过并在控制台留下警告（标注本身仍保留在笔记列表里）。逐页处理并显示进度提示。
- 导出代码（`src/client/pdf/exportPdf.ts`）在按下按钮时才 `import()`，`pdf-lib` 及其依赖只在真正导出时执行；它们是 `devDependencies`，构建期被打进懒加载的 `client.pdf.js`，**不新增任何 tarball 文件**（`pnpm pack` 仍是 21 个文件），第三方许可证已相应更新。

### 引用 / 解释 / 翻译

选中原文后的工具条提供：

- **引用**：把选中文字和「论文名 + 页码」插入对话输入框（不自动发送）。
- **解释**：把引用和明确的指令（`请解释这段：`）作为**同一条消息**写入输入框并立即发送。
- **翻译**：把引用和明确的指令（`请把这段翻译成中文：`）作为**同一条消息**写入输入框并立即发送（翻译目标固定为中文）。
- **复制**：复制选中文字。

解释 / 翻译的引用块与指令是在**同一次输入框写入**里完成的，所以发送出去的消息始终同时包含「引用 + 出处 + 明确指令」，不会再出现只发引用、让 agent 自行猜测要解释还是翻译的情况。

### 扫描版 PDF 的文本级 OCR

扫描页没有文本层，原本页内搜索、翻译和 `paper_*` 工具都读不到内容。现在：

- 阅读器**空闲时**（滚动/缩放停止约 700 ms）把**没有文本层**的页栅格化成 PNG，交给 Host 识别；当前页优先，同一时间只跑一页。
- Host 用内置、随 bundle 分发的 **tesseract.js**（`eng+chi_sim`）识别，**完全离线**，运行时不需要任何 npm 依赖、也不访问网络。
- 识别文本**合并进逐页文本缓存**（同一份 `papers/<sha1>.text.json`，记录 `ocrPages`），所以页内搜索、翻译和四个 `paper_*` 工具都能读到；`paper_info` 会报告 OCR 页数，`paper_read` 会在页头标注 `[第 N 页 · OCR]`。
- 工具栏显示 `OCR n/m` 进度；识别过的页按页缓存，重开论文不会重复识别。实测约 **1.4–2.4 秒/页**（本机、`eng+chi_sim`；取决于页面分辨率与机器）。
- OCR **只做文本**：OCR 页不生成文本层，**扫描页上不支持选中/高亮/下划线/文本框**。
- 中文识别结果会把汉字之间 Tesseract 插入的空格去掉（`注 意 力` → `注意力`），否则多字词搜不到。

### agent 工具（只读）

四个工具只作用于**当前会话里「论文」标签页打开的那篇论文**，模型不需要路径：

| 工具 | 作用 |
|---|---|
| `paper_info` | 标题、页数、有文本层的页数、OCR 页数（及已识别页码）、目录项数、已存标注数（含高亮/下划线/文本框；输出标签沿用「已存高亮」） |
| `paper_outline` | 按层级缩进列出目录与页码，便于决定读哪几页 |
| `paper_read` | 读取指定页范围的逐页文本；`pages` 支持 `"3"`、`"3-7"`、`"all"`，默认前 3 页；`maxChars` 默认 12000、上限 30000；OCR 页标注为 `[第 N 页 · OCR]` |
| `paper_search` | 在全文里搜关键词/短语，返回每页命中次数与上下文片段；`maxResults` 默认 20、上限 50 |

示例提问：

```text
先用 paper_outline 看这篇论文的目录，再用 paper_read 读 1–3 页，用中文总结它要解决什么问题。
用 paper_search 找一下 "attention"，告诉我在哪一页、上下文是什么。
读第 5–7 页，提炼实验设置（数据集、baseline、指标）。
用 paper_info 看一下这篇论文有多少页、文本层是否完整、扫描页识别了多少页。
```

注意：

- 论文必须先在**本会话**的「论文」标签页打开；否则工具会提示先打开论文。
- 工具只读，不会修改论文或标注；页码提示与固定文案为中文。
- 首次调用会解析 PDF 文本并缓存，数百页的论文第一次可能要等几秒；同一篇后续调用直接读缓存。
- 扫描页的 OCR 文本同样可被工具读取；尚未识别完的页会如实提示，而不是假装有内容。

---

## 安装

本仓库是一个标准 DSH bundle（`package.json` 里声明 `dsh.bundle.patch`）。**只通过 GitHub 分发**（仓库 `https://github.com/beiwei91/dsh-paper-reader`，当前发布版本是 `v0.2.0`）；npm 发布为未来可选项，见下方「npm（计划中）」。

> **版本说明**：当前公开发布版本是 **`v0.2.0`**（`package.json.version` 同为 `0.2.0`）；本文档描述的八色标注、下划线、文本框、页边距徽标、摘要提示词、批注导出、最近打开、Ctrl/Cmd + 滚轮缩放等功能都包含在该版本中，按下面的 commit / tag 方式安装即可。

包名 / loader 名与 GitHub 仓库同名（`dsh-paper-reader`，来自 `package.json.name`）。

### 方式一：从 GitHub 安装（推荐：固定 40 位 commit）

需要本机 `git` 与 GitHub 网络。固定完整 40 位 commit 的 git 安装才可能被 `plugin_manager` 视为**可更新**安装：

```powershell
# <40-hex> 来自：git rev-list -n1 v0.2.0
dsh plugin --profile <profile> add 'git+https://github.com/beiwei91/dsh-paper-reader.git#<40-hex>'
```

### 方式二：tag 形式

```powershell
dsh plugin --profile <profile> add 'github:beiwei91/dsh-paper-reader#v0.2.0'
```

- 建议用引号包住 spec，避免 PowerShell 把 `#` 当注释。
- tag / branch 形式可以安装，但**不参与自动更新**；升级要重装新 tag。
- 仓库里已提交构建产物，安装时**不需要本地构建**，也没有安装脚本需要审批。
- 安装后 bundle 默认启用；替换已安装版本需要重启 DSH。
- 让 agent 安装时，调用 `plugin_manager` 的 `install_bundle`，target 填上面同一个 spec（例如 `git+https://github.com/beiwei91/dsh-paper-reader.git#<40-hex>`）。
- **DSH Desktop** 的 `desktop` profile 由桌面端管理，请用 Desktop 的 Plugins 设置或 agent 的 `plugin_manager`。

### 方式三：GitHub Release tarball（备选）

```powershell
dsh plugin --profile <profile> add 'https://github.com/beiwei91/dsh-paper-reader/releases/download/v0.2.0/dsh-paper-reader-0.2.0.tgz'
```

> 注意：pnpm 11.0–11.8 配合 DSH profile 的 hoisted 布局安装裸 Release 资产 URL 时可能报 `ERR_PNPM_MISSING_TARBALL_INTEGRITY`（11.9+ 正常）。优先用上面的 commit / tag 安装。

### 方式四：本地目录（开发 / 离线）

- DSH 的 Plugins 设置里 **Add plugin / 添加本地目录**，选择本仓库目录；或
- 让 agent 调 `plugin_manager` 的 `install_bundle`，target 填本仓库绝对路径。

本地目录是链接安装：修改源码后需要重新构建并重新加载插件条目（关掉再打开该插件）。

### npm（计划中，尚未发布）

`dsh-paper-reader` 这个 unscoped 名在 npm 上已被无关项目占用（rantz 1.5.0），所以现在**没有**可以直接 `add` 的 npm 包。未来若发布 npm，会改用 scope 名（如 `@beiwei91/dsh-paper-reader`）或另选未占用名字；在此之前请用上面的 GitHub 方式安装。

### 安装后

打开右侧栏 → 在引导页点「论文阅读器」卡片 → 打开「论文」标签页。

- 本地 PDF：拖进面板，或粘贴绝对路径。
- arXiv：粘贴链接/ID，或在下方搜索框搜关键词。
- 宿主侧代码改动后需要重新加载插件（关掉再打开该插件条目），客户端 bundle 走 HMR。

---

## 数据与隐私

### 数据落点

所有持久数据都在 DSH home（`$DSH_HOME`，通常是 `~/.dsh`）下，**不写入用户工作区**：

```
paper-reader/papers/<sha1>.pdf          论文字节（供 paper_* 工具、OCR 与重新打开使用）
paper-reader/papers/<sha1>.text.json    逐页文本缓存（OCR 文本也合并在这里，并记 ocrPages 标记）
paper-reader/annotations/<sha1>.json    标注（{ key, highlights }：高亮、下划线、文本框与边注）
```

> 目录名沿用实现命名空间 `paper-reader`（历史原因），与包名 / loader 名 `dsh-paper-reader` 无关。

`<sha1>` 是论文 key 的 SHA-1：

- 本地文件：绝对路径；
- 拖拽文件：`drop:<文件名>:<大小>:<修改时间>`；
- arXiv：`arxiv:<arXiv ID>`。

浏览器本地（localStorage）只保存三样小数据：`dsh.paper-reader.tab.<tabId>`（当前标签页打开的是哪篇）、`dsh.paper-reader.pos.<key>`（页码与缩放）与 `dsh.paper-reader.recent`（空状态里的最近打开列表，最多 12 条，只含 key/名称/可选路径/来源/打开时间）。目前**没有界面内的数据清理入口**，需要时手动删除 `$DSH_HOME/paper-reader/` 或对应 localStorage 键。

### 网络行为

- **唯一的出站请求**：打开 / 搜索 arXiv 时，Host 端访问 `https://export.arxiv.org/api/query`（元数据 / 检索）与 `https://arxiv.org/pdf/<id>`（PDF 下载）；请求带固定 `User-Agent`，PDF 抓取超时 45 秒，PDF 上限 32 MiB。
- **OCR 完全本地离线**：tesseract.js、WASM core 与 `eng`/`chi_sim` 语言数据随 bundle 分发，识别时不联网、不加载 CDN。
- **批注导出完全本地**：在浏览器内存里复制并改写 PDF，再作为下载交给浏览器；不写 Host、不发请求。
- 浏览器端只访问 DSH 同源的 `/paper-reader/api/*`，不加载 CDN、字体、统计脚本或任何第三方资源。
- 本地 PDF 完全在本地处理；论文文件、OCR 位图、识别文本与标注不会上传到任何服务器。
- `/paper-reader/api/*` 只接受回环地址（`127.0.0.1` / `localhost` / `[::1]`）；写操作要求 `Origin` 是回环来源，Renderer 不带 `Origin`（或 `Origin: null`）时按回环 `Host` 放行，跨站 `Origin` 返回 403。
- **无遥测、无分析、无外部上报**。
- 提醒：使用 arXiv 功能时，arXiv.org 能看到你检索 / 打开的 arXiv ID；本地 PDF 不产生任何网络请求。

---

## 已知限制

- 首屏以第 1 页的尺寸占位；横向页在真正渲染前会有一次尺寸跳动。
- 高亮/下划线锚定「页 + 文本片段」：**跨页选区会被拒绝**；同一页里完全重复的文本只会标记第一处；论文文件被移动 / 改名（本地路径 key 变化）后，旧标注不会自动跟随。
- **文本框不能拖动**（拖拽与选文字手势冲突，属有意设计）；靠边放置时会向页面内部生长；已有高亮/下划线不能改颜色或移动，只能删除后重画；没有自由手绘 / 画笔工具。
- 高亮色块做了垂直内缩以避免相邻行重叠（纯视觉处理）；下划线的点击热区是整行文本框，不是那条 2 px 线本身。
- 文本层按需构建：有高亮/下划线或搜索命中的页、以及开始选择的页才会建文本层。在尚未建层的页面上第一次拖动选择，约一两百毫秒后工具条才出现（选区会自动补全，不需要重拖）；之后再选即时。
- 笔记列表的「跳到标注」依赖该页的文本层几何：正常会自动补建并等待（最多约 1.2 秒），仍定位不到时退化为跳到页面顶部并打开编辑器。
- 切换到右侧栏其它标签时，论文标签页保持打开；隐藏约 1.5 秒后会释放 PDF worker / 文档 / 画布与文本层，切回来再从 Host 保存的字节重载（页码 / 缩放沿用记忆位置），所以大 PDF 切回会有一小段载入时间。整页刷新或重启 DSH 后，用 localStorage 指针 + Host 保存的字节恢复（本地路径打开的论文还会回读原文件）；都取不到时该标签回到空状态。
- **OCR 是文本级、离线、尽力而为**：每次最多排队当前页附近约 30 页（`OCR_QUEUE_LIMIT`），滚动 / 跳页会按新的当前页继续排队，不会主动扫全篇；识别质量取决于扫描质量，双栏、倾斜、低分辨率可能漏字或错字；OCR 页不参与标注锚定，**扫描页上不能选中、高亮、加下划线或放文本框**；首次识别某页时 Host 可能要先整篇抽取一次文本，大文档会多等几秒。
- **导出是单向的**：能导出 `.annotated.pdf`，但**不能把批注从 PDF 导回插件**；PDF 里只画高亮/下划线/文本框，**边注正文不写入**；加密 PDF 拒绝导出；引文在页文本层里定位不到时该条会被跳过（控制台警告，标注仍保留）；没有标注时按钮禁用，无法导出一份「空批注」副本。
- **最近打开列表只在本浏览器的 localStorage 里**，最多 12 条；移除条目不会删除 Host 上的论文字节或标注；Host 找不到字节时会尝试回读原路径，失败则保留条目并提示，不会静默丢历史。
- 文件上限 32 MiB（本地与 arXiv 一致）；arXiv PDF 抓取 45 秒超时；关键词搜索单次最多 10 条结果。
- agent 工具只认「当前会话、当前标签页」打开的那篇论文；同一篇论文在多个标签打开时以最后打开 / 恢复的为准。
- 删除 `$DSH_HOME/paper-reader/annotations/` 中的文件即等于删除对应论文的标注。
- 多标签同时打开很多长篇论文仍会占用较多内存（每篇一个 PDF worker），建议按需关闭标签。
- `docs/PUBLISHING.md`、`docs/README.draft.md`、`docs/OCR-VERIFICATION.md` 是**维护者文档**：只留在 GitHub 仓库（源码归档可见），**不随安装包 / Release tarball 分发**，普通使用不需要它们。

---

## 开发

要求：Node.js（DSH 自身要求 ≥ 24.9）与 pnpm。

```powershell
pnpm install
node build.mjs    # -> client.js + client.pdf.js + lib/host.js + lib/pdf.worker.mjs + lib/ocr/*
pnpm typecheck    # tsc -p tsconfig.json
```

产物：

| 文件 | 作用 |
|---|---|
| `client.js` | 常驻客户端半：标签页注册、空状态（含最近打开）、arXiv 入口、标注存储接线、摘要提示词接线、对话动作 |
| `client.pdf.js` | 懒加载 chunk：PDF.js 渲染、目录、全文搜索、高亮/下划线绘制、文本框层、笔记徽标、Ctrl/Cmd + 滚轮缩放、扫描页 OCR 队列，以及按需 `import()` 的批注导出（`pdf-lib` 在按下「导出」时才执行） |
| `lib/host.js` | Host 半：`/paper-reader/api/*` 路由、arXiv 抓取、OCR 路由、四个只读工具（内置 PDF.js 做文本抽取） |
| `lib/pdf.worker.mjs` | Host 侧 PDF.js 伪 worker，必须与 `lib/host.js` 同目录 |
| `lib/ocr/engine.cjs` | OCR 引擎入口（tesseract.js worker 工厂，bundle） |
| `lib/ocr/worker.cjs` | OCR worker 线程脚本（bundle，含 core 加载器） |
| `lib/ocr/engine-impl.cjs` | 运行时引擎：串行化、超时、空闲回收、中文空格归一化 |
| `lib/ocr/tesseract-core-simd-lstm.wasm`、`lib/ocr/tesseract-core-lstm.wasm` | LSTM-only WASM core（SIMD / 无 SIMD 回退） |
| `lib/ocr/lang/eng.traineddata.gz`、`lib/ocr/lang/chi_sim.traineddata.gz` | `best_int` 英文 / 简体中文语言数据 |

说明：

- 构建产物是**提交进仓库**的（包内没有 `prepack` / `prepare`，从 git 安装与 Release tarball 都需要现成的 JS，安装方不需要本地构建）。
- OCR 资源在构建期从 `devDependencies`（`tesseract.js`、`tesseract.js-core`、`@tesseract.js-data/eng`、`@tesseract.js-data/chi_sim`）复制 / 打包进 `lib/ocr/`，所以 `pnpm install` 后 `node build.mjs` 会一并产出；**运行时零 npm 依赖、不联网**。
- 批注导出模块是 `src/client/pdf/exportPdf.ts`；`pdf-lib` 是 `devDependencies`，`build.mjs` 在构建懒加载 chunk 时把它及其传递依赖打进 `client.pdf.js`，运行时同样零 npm 依赖、不联网。它**不新增 tarball 文件**：`pnpm pack --dry-run` 仍是 **21 个文件**；第三方许可证见 [`THIRD-PARTY-LICENSES.md`](THIRD-PARTY-LICENSES.md)。
- 客户端与宿主类型来自真实 DSH 包（`devDependencies` 固定到 `0.2.2-rc.3`），DSH 契约变化会直接变成类型错误。
- DSH 的文件沙箱不允许生命周期脚本所需的管道式 spawn，所以 `pnpm-workspace.yaml` 把 esbuild 的构建脚本设为 `false`，并显式固定 `@esbuild/win32-x64`（Windows devDependency）；当前构建在 Windows 上验证，其它平台构建前请先确认 `devDependencies`。
- 不开浏览器也能自查 OCR：

  ```powershell
  python scripts/ocr-fixture.py .build/ocr-fixture
  node scripts/ocr-check.mjs .build/ocr-fixture/scan.png .build/ocr-fixture/scan.pdf
  ```

  设计、实测耗时与资源体积见 [`docs/OCR-VERIFICATION.md`](docs/OCR-VERIFICATION.md)。

## 项目结构

```
src/client/index.tsx        tab 类型、body、标题、引导页入口注册
src/client/PapersBody.tsx   空状态（路径/拖拽/arXiv 搜索/最近打开）、按标签页恢复论文、摘要提示词接线、标注与对话动作接线
src/client/annotations.ts   按论文的标注 store（单飞队列写、失败可见可重试、离开时 keepalive flush）
src/client/annotationQueue.ts  标注保存队列：单飞、合并、有界重试、teardown keepalive（可无浏览器测试）
src/client/pdf/chunk.tsx    阅读层：渲染窗口、目录、全文搜索、选区工具条、下划线/文本框工具、笔记、徽标、缩放、导出入口、OCR 队列接线
src/client/pdf/marks.ts     按「页 + 文本片段」把高亮/下划线画回重建后的文本层（字符级、行间内缩）
src/client/pdf/exportPdf.ts 批注导出：测量页面、把标注画进 PDF 副本、栅格化文本框、触发浏览器下载（pdf-lib 懒加载）
src/client/ocr/queue.ts     扫描页 OCR 队列（空闲时逐页、当前页优先、有界、可取消）
src/client/ocr/raster.ts    扫描页栅格化与「页是否有文本层」的探测
src/host/index.ts           Host 入口：/paper-reader/api/*（含 OCR）、工具注册
src/host/{arxiv,store,text,tools}.ts  arXiv 抓取、落盘、文本抽取与 OCR 合并、四个只读工具
src/host/ocr/*              OCR 引擎（串行 worker、超时、空闲回收）与构建期 worker 入口
src/shared/annotationModel.ts  标注 `kind` / 八色白名单与两侧共用的规范化（旧数据迁移点）
scripts/ocr-{fixture.py,check.mjs}  无浏览器的 OCR 复现自查
scripts/annotation-save-test.cjs    无浏览器的标注保存队列自查
```

## 参与贡献与许可证

- 提 issue 前请先在「已知限制」里确认不是已知问题；请附 DSH 版本、操作系统、安装方式与复现步骤，**不要上传受版权保护的论文 PDF**。
- 安全问题请按 [`SECURITY.md`](.github/SECURITY.md) 的渠道私密报告。
- 许可证：MIT（见 [`LICENSE`](LICENSE)）；随包分发的 PDF.js 为 Apache-2.0，批注导出所用的 `pdf-lib` 栈为 MIT，第三方许可证与修改声明见 [`THIRD-PARTY-LICENSES.md`](THIRD-PARTY-LICENSES.md)。

---

## English summary

**Paper Reader** adds a **Papers** tab to the DSH right sidebar. Open local PDFs by drag-and-drop or absolute path, an arXiv link/ID, or arXiv keyword search; a recently-opened list in the empty state reopens up to 12 papers from the Host's stored bytes (falling back to the original path). Read with continuous scrolling, outline jumps, whole-paper search, a remembered position, **Ctrl/Cmd + wheel zoom anchored at the cursor (0.25–4×, plain wheel still scrolls)** and horizontal scrolling for zoomed-in wide pages. Annotate with **eight highlight colours**, an **underline tool** (2 px bottom stroke, no fill) and **text boxes** (fraction-of-page anchoring, stay put at any zoom); margin badge dots mark annotations with notes, the notes list labels each row by kind, and jumping to an annotation scrolls to the mark itself. The toolbar's **Digest** button builds a structured digest prompt (paper facts + instructions to use `paper_info/paper_outline/paper_read/paper_search`, with problem/method/contributions/experiments/limitations/reproducibility sections) and writes it into the composer as one draft — never auto-sent, with a clipboard fallback. The **Export** button writes every annotation into a **new annotated PDF copy** (`<name>.annotated.pdf`) and downloads it: highlights as translucent rectangles, underlines as 2 pt lines, text boxes rasterised CJK-safely and embedded, rotated pages handled. The original PDF is never modified, and margin-note bodies are deliberately not written into the PDF. Quote a selection into the conversation or ask the agent to explain/translate it. Four read-only agent tools (`paper_info`, `paper_outline`, `paper_read`, `paper_search`) read the paper currently open in the session — no path needed.

Scanned PDFs get **text-level OCR**: pages without a text layer are rasterised in the reader when it is idle, recognised on the Host with a bundled, fully offline tesseract.js (`eng+chi_sim`), and merged into the same per-page text cache, so in-document search, translation and the agent tools work. OCR pages get no text layer, so they cannot be selected or annotated. A rolling queue of about 30 pages is filled around the current page per session, results are cached per page, and measurement showed roughly 1.4–2.4 s per page.

Data lives under `$DSH_HOME/paper-reader/` (paper bytes, extracted-text cache including OCR text, annotations as `{ key, highlights }` with per-entry `kind`), plus small localStorage pointers for the open paper, reading position and the recent-papers list. The only outbound network traffic is the Host fetching from arXiv (`export.arxiv.org`, `arxiv.org`); OCR and the annotated-PDF export are fully local. The browser talks only to the loopback-only, same-origin `/paper-reader/api/*` routes. No telemetry.

**Known limitations:** page 1's size is used as a placeholder before a page renders; highlights/underlines are anchored by page + text and cross-page selections are rejected; duplicated text on a page is marked at its first occurrence only; moving/renaming a local PDF detaches its annotations; text boxes cannot be dragged (by design), existing marks cannot be recoloured or moved, and there is no freehand pen; switching right-sidebar tabs releases the PDF after about 1.5 s and reloads it from the Host's stored bytes; a 32 MiB file cap; the first selection drag on a page builds its text layer and takes a moment; scanned pages cannot be selected or annotated, OCR quality depends on the scan, and the rolling queue never scans a whole document automatically; export is one-way (no importing annotations back), margin notes are not embedded in the PDF, encrypted PDFs are refused, and unlocatable marks are skipped.

Install from GitHub: `dsh plugin --profile <profile> add 'git+https://github.com/beiwei91/dsh-paper-reader.git#<40-hex>'` (pin the commit for updatable installs; `github:beiwei91/dsh-paper-reader#v0.2.0` also installs, and a local directory can be linked for development). `v0.2.0` is the current release. The package/loader name and the GitHub repository are both `dsh-paper-reader`. An npm release is not possible under this unscoped name (already taken); a scoped package may follow. Development: `pnpm install && node build.mjs && pnpm typecheck`. License: MIT; bundled PDF.js is Apache-2.0 and the export's `pdf-lib` stack is MIT (see `THIRD-PARTY-LICENSES.md`). Repository: `https://github.com/beiwei91/dsh-paper-reader`.
