# 论文阅读器（DSH 插件）

在 DSH 右侧栏新增「论文」标签页读 PDF 论文：目录、页内搜索、连续滚动、多色高亮与边注；选中的原文可引用到对话、让 agent 解释或翻译。agent 通过四个只读工具按页读当前论文。也支持 arXiv 链接/ID 与关键词搜索打开论文。

> 状态：本地 PDF、arXiv、阅读层、标注、对话动作、agent 工具已完成。**扫描版 PDF 的 OCR 尚未接入**（当前扫描页只显示、无文本层，`paper_*` 工具会如实报告该页没有文本）。

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
pnpm build        # -> client.js + client.pdf.js + lib/host.js + lib/pdf.worker.mjs
pnpm typecheck    # tsc -p tsconfig.json
```

产物：

| 文件 | 作用 |
|---|---|
| `client.js` | 常驻客户端半：tab 注册、空状态、标注存储、对话动作 |
| `client.pdf.js` | 懒加载 chunk：PDF.js 渲染、目录、搜索、高亮绘制（`require.async` 拉取） |
| `lib/host.js` | Host 半：存储路由、arXiv 抓取、agent 工具（内置 PDF.js 做文本抽取） |
| `lib/pdf.worker.mjs` | Host 侧 PDF.js 伪 worker，必须与 `lib/host.js` 同目录 |

注意：DSH 的文件沙箱不允许生命周期脚本所需的管道式 spawn，所以 `pnpm-workspace.yaml` 把 esbuild 的构建脚本设为 `false`，并显式固定 `@esbuild/win32-x64`（Windows devDependency）。客户端类型来自真实 DSH 包（devDependencies），契约漂移会变成类型错误。

## 数据落点

全部在 DSH home 下（`$DSH_HOME` 或 `~/.dsh`），不碰用户工作区：

```
paper-reader/papers/<sha1>.pdf          论文字节（供 paper_* 工具与后续 OCR 使用）
paper-reader/papers/<sha1>.text.json    抽取出的逐页文本缓存
paper-reader/annotations/<sha1>.json    高亮与边注
```

论文的 `sha1` 来自它的 key：本地文件是绝对路径，拖拽是 `drop:<name>:<size>:<mtime>`，arXiv 是 `arxiv:<id>`。

## 结构

```
src/client/index.tsx       tab 类型、body、标题、引导页入口的注册
src/client/PapersBody.tsx  空状态（路径/拖拽/arXiv 搜索）、标注存储接线、对话动作
src/client/annotations.ts  按论文的标注 store（防抖写、离开时 flush）
src/client/pdf/chunk.tsx   阅读层：渲染窗口、目录、全文搜索、选区工具条、笔记
src/client/pdf/marks.ts    按“页 + 文本片段”把高亮画回重建后的文本层
src/host/index.ts          Host 半入口：/paper-reader/api/* 路由、工具注册
src/host/{arxiv,store,text,tools}.ts  arXiv 抓取、落盘、文本抽取、四个只读工具
```

## 设计约束

- agent 工具只读，默认作用于当前会话里打开的论文（客户端把字节与 key 推给 Host）。
- 内置 PDF 预览不暴露选区/高亮 API，所以本插件自建 PDF.js 渲染层并打包进 Client chunk。
- 除抓取 arXiv 外全程离线；页面不直连外网，所有网络请求都走 Host 路由。
- 扫描版 PDF 未做 OCR：目前只能看页图，没有可搜索/可翻译/可交给 agent 的文本（计划后续接入文本级 OCR）。

## 已知限制

- 每篇论文默认用第 1 页尺寸做占位，横版页在渲染前会跳一下。
- 高亮按“页 + 文本片段”锚定；跨页选区会被拒绝，同一段重复文本只标记第一处。
- 论文文件被移动/改名后，本地路径类 key 的标注不会自动跟随。
- OCR 未接入（见上）。
