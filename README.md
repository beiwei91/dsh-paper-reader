# 论文阅读器（DSH 插件）

在 DSH 右侧栏新增「论文」标签页读 PDF 论文：目录、页内搜索、连续滚动、多色高亮与边注；选中的原文可引用到对话、让 agent 解释或翻译。agent 通过四个只读工具按页读当前论文。也支持 arXiv 链接/ID 与关键词搜索打开论文。

> 状态：本地 PDF、arXiv、阅读层、标注、对话动作、agent 工具、**扫描页文本级 OCR** 已完成。没有文本层的扫描页会在阅读器空闲时后台识别，识别文本进入逐页文本缓存，因此可被页内搜索、翻译和 `paper_*` 工具使用；OCR 页不生成文本层，**扫描页上不支持选中/高亮**。

## 安装

本仓库是一个标准 DSH bundle，以**本地目录**方式装进 profile（链接安装，改完重新构建即可生效）：

- 在 DSH 的 插件/Plugins 设置里添加本地目录 `D:\CODE\dsh-paper-reader`；或
- 让 agent 执行 `plugin_manager` 的 `install_bundle`，目标填仓库绝对路径。

装好后打开右侧栏，在引导页点「论文阅读器」卡片即可打开「论文」标签页。

- 本地 PDF：拖进面板，或粘贴绝对路径。
- arXiv：粘贴链接/ID，或在下方搜索框搜关键词。
- 宿主侧代码改动后需要重新加载插件（关掉再打开该插件条目），客户端 bundle 走 HMR。

## 开发

```powershell
pnpm install
pnpm build        # -> client.js + client.pdf.js + lib/host.js + lib/pdf.worker.mjs + lib/ocr/*
pnpm typecheck    # tsc -p tsconfig.json
```

产物：

| 文件 | 作用 |
|---|---|
| `client.js` | 常驻客户端半：tab 注册、空状态、标注存储、对话动作 |
| `client.pdf.js` | 懒加载 chunk：PDF.js 渲染、目录、搜索、高亮绘制、扫描页 OCR 队列（`require.async` 拉取） |
| `lib/host.js` | Host 半：存储路由、arXiv 抓取、OCR 路由、agent 工具（内置 PDF.js 做文本抽取） |
| `lib/pdf.worker.mjs` | Host 侧 PDF.js 伪 worker，必须与 `lib/host.js` 同目录 |
| `lib/ocr/` | OCR 运行资源：tesseract worker 与引擎（bundle）、LSTM-only WASM core、eng/chi_sim 训练数据。构建期从 devDependencies vendoring，**运行时零 npm 依赖、不联网** |

注意：DSH 的文件沙箱不允许生命周期脚本所需的管道式 spawn，所以 `pnpm-workspace.yaml` 把 esbuild 的构建脚本设为 `false`，并显式固定 `@esbuild/win32-x64`（Windows devDependency）。客户端类型来自真实 DSH 包（devDependencies），契约漂移会变成类型错误。

OCR 资源在构建期从 devDependencies（`tesseract.js`、`tesseract.js-core`、`@tesseract.js-data/eng`、`@tesseract.js-data/chi_sim`）复制/打包进 `lib/ocr/`，所以 `pnpm install` 后 `pnpm build` 会一并产出。不开浏览器也能自查：

```powershell
python scripts/ocr-fixture.py .build/ocr-fixture
node scripts/ocr-check.mjs .build/ocr-fixture/scan.png .build/ocr-fixture/scan.pdf
```

设计、实测耗时与资源体积见 `docs/OCR-VERIFICATION.md`。

## 数据落点

全部在 DSH home 下（`$DSH_HOME` 或 `~/.dsh`），不碰用户工作区：

```
paper-reader/papers/<sha1>.pdf          论文字节（供 paper_* 工具与 OCR 使用）
paper-reader/papers/<sha1>.text.json    抽取出的逐页文本缓存（OCR 文本也合并在这里，并记 ocrPages 标记）
paper-reader/annotations/<sha1>.json    高亮与边注
```

论文的 `sha1` 来自它的 key：本地文件是绝对路径，拖拽是 `drop:<name>:<size>:<mtime>`，arXiv 是 `arxiv:<id>`。

## 结构

```
src/client/index.tsx       tab 类型、body、标题、引导页入口的注册
src/client/PapersBody.tsx  空状态（路径/拖拽/arXiv 搜索）、按 tab 记住已打开的论文、标注存储接线、对话动作
src/client/annotations.ts  按论文的标注 store（防抖写、离开时 flush）
src/client/pdf/chunk.tsx   阅读层：渲染窗口、目录、全文搜索、选区工具条、笔记、OCR 队列接线
src/client/pdf/marks.ts    按“页 + 文本片段”把高亮画回重建后的文本层
src/client/ocr/queue.ts    扫描页 OCR 队列（空闲时逐页、当前页优先、有界、可取消）
src/client/ocr/raster.ts   扫描页栅格化与“页是否有文本层”的探测
src/host/index.ts          Host 半入口：/paper-reader/api/* 路由（含 OCR）、工具注册
src/host/{arxiv,store,text,tools}.ts  arXiv 抓取、落盘、文本抽取与 OCR 合并、四个只读工具
src/host/ocr/*             OCR 引擎（串行 worker、超时、空闲回收）与构建期 worker 入口
scripts/ocr-{fixture.py,check.mjs}  无浏览器的 OCR 复现自查
```

## 设计约束

- agent 工具只读，默认作用于当前会话里打开的论文（客户端把字节与 key 推给 Host）。
- 内置 PDF 预览不暴露选区/高亮 API，所以本插件自建 PDF.js 渲染层并打包进 Client chunk。
- 除抓取 arXiv 外全程离线；页面不直连外网，所有网络请求都走 Host 路由。
- 扫描版 PDF 做**文本级** OCR：客户端在阅读器空闲时把无文本层的页栅格化成 PNG，Host 用 tesseract.js（`eng+chi_sim`，资源随 bundle 分发，全离线）识别后合并进逐页文本缓存；OCR 页不建文本层，只供页内搜索、翻译和 agent 工具使用，**不能选中或高亮**。

## 已知限制

- 每篇论文默认用第 1 页尺寸做占位，横版页在渲染前会跳一下。
- 高亮按“页 + 文本片段”锚定；跨页选区会被拒绝，同一段重复文本只标记第一处。
- 论文文件被移动/改名后，本地路径类 key 的标注不会自动跟随。
- 文本层按需构建（有高亮/搜索命中、或开始选择时才建）：在还没建层的页面上第一次拖动选择会先建层，选区工具条约一两百毫秒后才出现（选区会自动补上，不用重拖）；之后拖动即时生效。
- 右侧栏切到别的标签时，论文标签页保持打开：约 1.5 秒后释放 PDF worker/文档/画布，切回来再从内存中的字节重载（页面/缩放沿用记忆位置），所以大 PDF 切回会有一小段载入时间。整页刷新或重启 DSH 后，用 localStorage 里的指针 + Host 保存的字节（本地路径打开的论文还会回读原文件）恢复；都取不到时该标签重置为空状态。
- OCR 是文本级、离线、尽力而为：一次最多排队当前页附近约 30 页（`src/client/ocr/queue.ts` 的 `OCR_QUEUE_LIMIT`），滚动/跳页会按新的当前页继续排队，不会主动扫全篇；识别质量取决于扫描质量，双栏、倾斜、低分辨率可能漏字或错字；OCR 页不参与高亮锚定；首次识别某页时 Host 可能要先整篇抽取一次文本，大文档会多等几秒。已识别的页按页缓存，重开不会重复识别。
