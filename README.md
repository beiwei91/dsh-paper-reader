# 论文阅读器 · Paper Reader（DSH 插件）

在 DeepSeek Harness（DSH）右侧栏新增一个「论文」标签页，把 PDF 论文当作可读、可标注、可对话的对象：**连续滚动阅读、目录跳转、全文搜索、记忆阅读位置；四色高亮 + 边注；选中原文可引用到对话、让 agent 解释或翻译**。也支持 arXiv 链接/ID 与关键词搜索直接打开论文；agent 通过四个**只读**工具（`paper_info`、`paper_outline`、`paper_read`、`paper_search`）读取当前会话里打开的那篇论文。扫描版 PDF 会在阅读器空闲时做**文本级 OCR**，识别文本进入逐页文本缓存，因此页内搜索、翻译和 `paper_*` 工具同样可用。

![论文阅读器示意（功能示意图，非真实截图）](docs/preview.svg)

- 运行环境：在 DSH **0.2.2-rc.3** 上开发与验证；本轮不声明 `engines.dsh`，也没有 npm 发布。
- 命名：包名 / loader id = **`dsh-paper-reader`**（来自 `package.json.name`），GitHub 仓库 = **`https://github.com/beiwei91/dsh-paper-reader`**。
- 分发：**只走 GitHub**（仓库 + `v0.1.0` tag + Release tarball）。npm 发布为未来可选项（unscoped 名 `dsh-paper-reader` 已被无关项目占用）。
- 许可证：MIT；内置 PDF.js（Apache-2.0）的第三方许可见 [`THIRD-PARTY-LICENSES.md`](THIRD-PARTY-LICENSES.md)。

---

## 功能

### 打开论文

- **本地 PDF**：把文件拖进「论文」面板，或粘贴本机绝对路径（经 DSH 的工作区文件读取；单文件上限 32 MiB）。
- **arXiv 链接 / ID**：支持 `https://arxiv.org/abs/…`、`https://arxiv.org/pdf/…`、裸 ID（如 `1706.03762`）与版本后缀（`v2`），也支持旧式 ID（如 `cond-mat.mes-hall/0601001`）。
- **arXiv 关键词搜索**：输入关键词，列出标题、arXiv ID 与发布日期，点一条即可打开（单次最多 10 条）。
- **多标签**：右侧栏可以同时打开多篇论文，每个标签各自记住自己打开的那篇。切换到右栏其它标签时标签页保持打开；隐藏约 1.5 秒后释放 PDF worker / 文档 / 画布，切回来再从字节重载（页面与缩放沿用记忆位置）。

### 阅读

- 连续滚动，按需渲染当前页及邻近页的位图，远离当前页的页面会释放，长论文也不至于吃满内存。
- **目录**：解析 PDF 书签，缩进显示层级与页码；有页码的条目可点击跳转。
- **全文搜索**：逐页搜索并显示命中次数与上下文片段，点击结果跳转并高亮；单次最多返回 60 页命中。
- **阅读位置记忆**：按论文记住页码与缩放比例，下次打开自动回到上次位置。
- 工具栏：目录 / 搜索 / 笔记 / 缩小 / 放大 / 适宽、当前页码指示，以及扫描页 OCR 进度。
- 缩放下限 25%、上限 400%；首屏会自动按面板宽度适配。

### 高亮与边注

- 选中文字后出现工具条，可选 **黄、绿、蓝、粉** 四种颜色创建高亮。
- 点击已画出的高亮可打开边注编辑器，写、改、删边注；「笔记」面板集中列出本篇的所有高亮与边注，点击可跳回原文对应页。
- 高亮按「页 + 选中文本」锚定，缩放、重建文本层后仍会重新画回原文位置；标注按论文保存在本地，关掉再打开仍在。

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
- OCR **只做文本**：OCR 页不生成文本层，**扫描页上不支持选中/高亮**。
- 中文识别结果会把汉字之间 Tesseract 插入的空格去掉（`注 意 力` → `注意力`），否则多字词搜不到。

### agent 工具（只读）

四个工具只作用于**当前会话里「论文」标签页打开的那篇论文**，模型不需要路径：

| 工具 | 作用 |
|---|---|
| `paper_info` | 标题、页数、有文本层的页数、OCR 页数（及已识别页码）、目录项数、已存高亮数 |
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

本仓库是一个标准 DSH bundle（`package.json` 里声明 `dsh.bundle.patch`）。**本轮只通过 GitHub 分发**（仓库 `https://github.com/beiwei91/dsh-paper-reader`，tag `v0.1.0`）；npm 发布为未来可选项，见下方「npm（计划中）」。

包名 / loader 名与 GitHub 仓库同名（`dsh-paper-reader`，来自 `package.json.name`）。

### 方式一：从 GitHub 安装（推荐：固定 40 位 commit）

需要本机 `git` 与 GitHub 网络。固定完整 40 位 commit 的 git 安装才可能被 `plugin_manager` 视为**可更新**安装：

```powershell
# <40-hex> 来自：git rev-list -n1 v0.1.0
dsh plugin --profile <profile> add 'git+https://github.com/beiwei91/dsh-paper-reader.git#<40-hex>'
```

### 方式二：tag 形式

```powershell
dsh plugin --profile <profile> add 'github:beiwei91/dsh-paper-reader#v0.1.0'
```

- 建议用引号包住 spec，避免 PowerShell 把 `#` 当注释。
- tag / branch 形式可以安装，但**不参与自动更新**；升级要重装新 tag。
- 仓库里已提交构建产物，安装时**不需要本地构建**，也没有安装脚本需要审批。
- 安装后 bundle 默认启用；替换已安装版本需要重启 DSH。
- 让 agent 安装时，调用 `plugin_manager` 的 `install_bundle`，target 填上面同一个 spec（例如 `git+https://github.com/beiwei91/dsh-paper-reader.git#<40-hex>`）。
- **DSH Desktop** 的 `desktop` profile 由桌面端管理，请用 Desktop 的 Plugins 设置或 agent 的 `plugin_manager`。

### 方式三：GitHub Release tarball（备选）

```powershell
dsh plugin --profile <profile> add 'https://github.com/beiwei91/dsh-paper-reader/releases/download/v0.1.0/dsh-paper-reader-0.1.0.tgz'
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
paper-reader/papers/<sha1>.pdf          论文字节（供 paper_* 工具与 OCR 使用）
paper-reader/papers/<sha1>.text.json    逐页文本缓存（OCR 文本也合并在这里，并记 ocrPages 标记）
paper-reader/annotations/<sha1>.json    高亮与边注（{ key, highlights }）
```

> 目录名沿用实现命名空间 `paper-reader`（历史原因），与包名 / loader 名 `dsh-paper-reader` 无关。

`<sha1>` 是论文 key 的 SHA-1：

- 本地文件：绝对路径；
- 拖拽文件：`drop:<文件名>:<大小>:<修改时间>`；
- arXiv：`arxiv:<arXiv ID>`。

浏览器本地（localStorage）只保存两样小数据：`dsh.paper-reader.tab.<tabId>`（当前标签页打开的是哪篇）与 `dsh.paper-reader.pos.<key>`（页码与缩放）。目前**没有界面内的数据清理入口**，需要时手动删除 `$DSH_HOME/paper-reader/`。

### 网络行为

- **唯一的出站请求**：打开 / 搜索 arXiv 时，Host 端访问 `https://export.arxiv.org/api/query`（元数据 / 检索）与 `https://arxiv.org/pdf/<id>`（PDF 下载）；请求带固定 `User-Agent`，PDF 抓取超时 45 秒，PDF 上限 32 MiB。
- **OCR 完全本地离线**：tesseract.js、WASM core 与 `eng`/`chi_sim` 语言数据随 bundle 分发，识别时不联网、不加载 CDN。
- 浏览器端只访问 DSH 同源的 `/paper-reader/api/*`，不加载 CDN、字体、统计脚本或任何第三方资源。
- 本地 PDF 完全在本地处理；论文文件、OCR 位图、识别文本与标注不会上传到任何服务器。
- `/paper-reader/api/*` 只接受回环地址（`127.0.0.1` / `localhost` / `[::1]`），写操作还要求同源 `Origin`；其它来源返回 403。
- **无遥测、无分析、无外部上报**。
- 提醒：使用 arXiv 功能时，arXiv.org 能看到你检索 / 打开的 arXiv ID；本地 PDF 不产生任何网络请求。

---

## 已知限制

- 首屏以第 1 页的尺寸占位；横向页在真正渲染前会有一次尺寸跳动。
- 高亮锚定「页 + 文本片段」：**跨页选区会被拒绝**；同一页里完全重复的文本只会标记第一处；论文文件被移动 / 改名（本地路径 key 变化）后，旧标注不会自动跟随。
- 文本层按需构建：有高亮或搜索命中的页、以及开始选择的页才会建文本层。在尚未建层的页面上第一次拖动选择，约一两百毫秒后工具条才出现（选区会自动补全，不需要重拖）；之后再选即时。
- 切换到右侧栏其它标签时，论文标签页保持打开；隐藏约 1.5 秒后会释放 PDF worker / 文档 / 画布与文本层，切回来再从 Host 保存的字节重载（页码 / 缩放沿用记忆位置），所以大 PDF 切回会有一小段载入时间。整页刷新或重启 DSH 后，用 localStorage 指针 + Host 保存的字节恢复（本地路径打开的论文还会回读原文件）；都取不到时该标签回到空状态。
- **OCR 是文本级、离线、尽力而为**：每次最多排队当前页附近约 30 页（`OCR_QUEUE_LIMIT`），滚动 / 跳页会按新的当前页继续排队，不会主动扫全篇；识别质量取决于扫描质量，双栏、倾斜、低分辨率可能漏字或错字；OCR 页不参与高亮锚定，**扫描页上不能选中或高亮**；首次识别某页时 Host 可能要先整篇抽取一次文本，大文档会多等几秒。
- 文件上限 32 MiB（本地与 arXiv 一致）；arXiv PDF 抓取 45 秒超时；关键词搜索单次最多 10 条结果。
- agent 工具只认「当前会话、当前标签页」打开的那篇论文；同一篇论文在多个标签打开时以最后打开 / 恢复的为准。
- 高亮 / 笔记没有导入导出；删除 `$DSH_HOME/paper-reader/annotations/` 中的文件即等于删除对应论文的标注。
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
| `client.js` | 常驻客户端半：标签页注册、空状态、arXiv 入口、标注存储接线、对话动作 |
| `client.pdf.js` | 懒加载 chunk：PDF.js 渲染、目录、全文搜索、高亮绘制、扫描页 OCR 队列（`require.async` 拉取） |
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
src/client/PapersBody.tsx   空状态（路径/拖拽/arXiv 搜索）、按标签页恢复论文、标注与对话动作接线
src/client/annotations.ts   按论文的标注 store（防抖写、离开时 flush）
src/client/pdf/chunk.tsx    阅读层：渲染窗口、目录、全文搜索、选区工具条、笔记、OCR 队列接线
src/client/pdf/marks.ts     按「页 + 文本片段」把高亮画回重建后的文本层
src/client/ocr/queue.ts     扫描页 OCR 队列（空闲时逐页、当前页优先、有界、可取消）
src/client/ocr/raster.ts    扫描页栅格化与「页是否有文本层」的探测
src/host/index.ts           Host 入口：/paper-reader/api/*（含 OCR）、工具注册
src/host/{arxiv,store,text,tools}.ts  arXiv 抓取、落盘、文本抽取与 OCR 合并、四个只读工具
src/host/ocr/*              OCR 引擎（串行 worker、超时、空闲回收）与构建期 worker 入口
scripts/ocr-{fixture.py,check.mjs}  无浏览器的 OCR 复现自查
```

## 参与贡献与许可证

- 提 issue 前请先在「已知限制」里确认不是已知问题；请附 DSH 版本、操作系统、安装方式与复现步骤，**不要上传受版权保护的论文 PDF**。
- 安全问题请按 [`SECURITY.md`](.github/SECURITY.md) 的渠道私密报告。
- 许可证：MIT（见 [`LICENSE`](LICENSE)）；随包分发的 PDF.js 为 Apache-2.0，第三方许可证与修改声明见 [`THIRD-PARTY-LICENSES.md`](THIRD-PARTY-LICENSES.md)。

---

## English summary

**Paper Reader** adds a **Papers** tab to the DSH right sidebar. Open local PDFs by drag-and-drop or absolute path, an arXiv link/ID, or arXiv keyword search; read with continuous scrolling, outline jumps, whole-paper search and a remembered position; keep multi-colour highlights with margin notes per paper; quote a selection into the conversation or ask the agent to explain/translate it. Four read-only agent tools (`paper_info`, `paper_outline`, `paper_read`, `paper_search`) read the paper currently open in the session — no path needed.

Scanned PDFs get **text-level OCR**: pages without a text layer are rasterised in the reader when it is idle, recognised on the Host with a bundled, fully offline tesseract.js (`eng+chi_sim`), and merged into the same per-page text cache, so in-document search, translation and the agent tools work. OCR pages get no text layer, so they cannot be selected or highlighted. A rolling queue of about 30 pages is filled around the current page per session, results are cached per page, and measurement showed roughly 1.4–2.4 s per page.

Data lives under `$DSH_HOME/paper-reader/` (paper bytes, extracted-text cache including OCR text, annotations), plus a small localStorage pointer for the open paper and reading position per tab. The only outbound network traffic is the Host fetching from arXiv (`export.arxiv.org`, `arxiv.org`); OCR is fully local. The browser talks only to the loopback-only, same-origin `/paper-reader/api/*` routes. No telemetry.

**Known limitations:** page 1's size is used as a placeholder before a page renders; cross-page selections are rejected; duplicated text on a page is highlighted at its first occurrence only; moving/renaming a local PDF detaches its annotations; switching right-sidebar tabs releases the PDF after about 1.5 s and reloads it from the Host's stored bytes; a 32 MiB file cap; the first selection drag on a page builds its text layer and takes a moment; scanned pages cannot be selected or highlighted, OCR quality depends on the scan, and the rolling queue never scans a whole document automatically.

Install from GitHub: `dsh plugin --profile <profile> add 'git+https://github.com/beiwei91/dsh-paper-reader.git#<40-hex>'` (pin the commit for updatable installs; `github:beiwei91/dsh-paper-reader#v0.1.0` also installs, and a local directory can be linked for development). The package/loader name and the GitHub repository are both `dsh-paper-reader`. An npm release is not possible under this unscoped name (already taken); a scoped package may follow. Development: `pnpm install && node build.mjs && pnpm typecheck`. License: MIT; bundled PDF.js is Apache-2.0 (see `THIRD-PARTY-LICENSES.md`). Repository: `https://github.com/beiwei91/dsh-paper-reader`.
