<!--
本文件是公开发布用的 README 草稿，用于替换仓库根目录的 README.md。
发布前把 `<OWNER>` 全部替换为真实 GitHub 用户/组织名（见 docs/PUBLISHING.md §15）。
相对链接以仓库根目录为基准；`docs/PUBLISHING.md` 是内部发布清单，不属于对外文档，但留在仓库里。
-->

# 论文阅读器 · Paper Reader（DSH 插件）

在 DeepSeek Harness（DSH）右侧栏新增一个「论文」标签页，把 PDF 论文当作可读、可标注、可对话的对象：**连续滚动阅读、目录跳转、全文搜索、记忆阅读位置；四色高亮 + 边注；选中原文可引用到对话、让 agent 解释或翻译**。也支持 arXiv 链接/ID 与关键词搜索直接打开论文；agent 通过四个**只读**工具（`paper_info`、`paper_outline`、`paper_read`、`paper_search`）读取当前会话里打开的那篇论文。

> **状态**：本地 PDF、arXiv、阅读层、标注、对话动作、agent 工具均已完成。
> **扫描版 PDF 的 OCR 尚未接入**（扫描页目前只显示页图，没有文本层，搜索/翻译/`paper_*` 工具无法读取其文字）。
>
> <!-- TODO(OCR): 接入文本级 OCR 后，更新本节、功能列表与「已知限制」，并删除本 TODO 标记。 -->

![论文阅读器示意（功能示意，非真实截图）](docs/preview.svg)

- 运行环境：DSH **0.2.2-rc.3** 上开发与验证（`engines.dsh` 计划声明为 `>=0.2.2-rc.3 <0.3.0-0`，见 `docs/PUBLISHING.md`）。
- 包名与仓库名：**`paper-reader`**（仓库 `https://github.com/<OWNER>/paper-reader`）；首发只走 **GitHub**（tag `v0.1.0`），npm 发布为未来可选项。
- 许可证：MIT；内置 PDF.js（Apache-2.0）的第三方许可见 `THIRD-PARTY-LICENSES.md`。

---

## 功能

### 打开论文

- **本地 PDF**：把文件拖进「论文」面板，或粘贴本机绝对路径（经由 DSH 的工作区文件读取，单文件上限 32 MiB）。
- **arXiv 链接 / ID**：支持 `https://arxiv.org/abs/…`、`https://arxiv.org/pdf/…`、裸 ID（如 `1706.03762`）与带版本号后缀；也支持旧式 ID（如 `cond-mat.mes-hall/0601001`）。
- **arXiv 关键词搜索**：输入关键词，列出标题、arXiv ID 与发布日期，点一条即可打开。
- **多标签**：右栏可以同时打开多篇论文，每个标签各自记住自己打开的那篇；切换到右栏其它标签再切回来时，会从 Host 保存的字节重新载入同一篇论文（页面与缩放恢复）。

### 阅读

- 连续滚动，按需渲染当前页及邻近页的位图，远离当前页的页面会释放，长论文也不至于吃满内存。
- **目录**：解析 PDF 书签，缩进显示层级与页码；有页码的条目可点击跳转。
- **全文搜索**：逐页搜索并显示每页命中次数与上下文片段，点击结果跳转并高亮；单次最多返回 60 页命中。
- **阅读位置记忆**：按论文记住页码与缩放比例，下次打开自动回到上次位置。
- 工具栏：目录 / 搜索 / 笔记 / 缩小 / 放大 / 适宽，以及当前页码指示。
- 缩放下限 25%、上限 400%；首屏会自动按面板宽度适配。

### 高亮与边注

- 选中文字后出现工具条，可选 **黄、绿、蓝、粉** 四种颜色创建高亮。
- 点击已画出的高亮可打开边注编辑器，写、改、删边注；「笔记」面板集中列出本篇的所有高亮与边注，点击可跳回原文对应页。
- 高亮按「页 + 选中文本」锚定，缩放、重建文本层后仍会重新画回原文位置；标注按论文保存在本地，关掉再打开仍在。

### 引用 / 解释 / 翻译

选中原文后的工具条提供：

- **引用**：把选中文字和「论文名 + 页码」插入对话输入框（不自动发送）。
- **解释**：插入引用并附带「请解释这段。」，立即发送给 agent。
- **翻译**：插入引用并附带「请把这段翻译成中文。」，立即发送给 agent（翻译目标固定为中文）。
- **复制**：复制选中文字。

### agent 工具（只读）

四个工具只作用于**当前会话里的「论文」标签页打开的那篇论文**，模型不需要路径：

| 工具 | 作用 |
|---|---|
| `paper_info` | 标题、页数、有文本层的页数、目录项数、已保存高亮数 |
| `paper_outline` | 按层级缩进列出目录与页码，便于决定读哪几页 |
| `paper_read` | 读取指定页范围的逐页文本；`pages` 支持 `"3"`、`"3-7"`、`"all"`，默认前 3 页；`maxChars` 默认 12000、上限 30000 |
| `paper_search` | 在全文里搜关键词/短语，返回每页命中次数与上下文片段；`maxResults` 默认 20、上限 50 |

示例提问：

```text
先用 paper_outline 看这篇论文的目录，再用 paper_read 读 1–3 页，用中文总结它要解决什么问题。
用 paper_search 找一下 "attention"，告诉我在哪一页、上下文是什么。
读第 5–7 页，提炼实验设置（数据集、baseline、指标）。
用 paper_info 看一下这篇论文有多少页、文本层是否完整。
```

注意：

- 论文必须先在**本会话**的「论文」标签页打开；否则工具会提示先打开论文。
- 工具只读，不会修改论文或标注；输出里的页码提示与固定文案为中文。
- 首次调用会解析 PDF 文本并缓存，数百页的论文第一次可能等几秒；同一篇后续调用直接读缓存。
- 扫描版 PDF 没有文本层：工具会如实报告这些页「没有文本」。

---

## 安装

本仓库是一个标准 DSH bundle（`package.json` 里声明 `dsh.bundle.patch`）。**首发只通过 GitHub 分发**（仓库 `https://github.com/<OWNER>/paper-reader`，tag `v0.1.0`）；npm 包 `paper-reader` 只是未来的可选项。

### 方式一：GitHub tag（推荐）

需要本机 `git` 与 GitHub 网络。把 `<OWNER>`、`<profile>` 换成实际值：

```powershell
dsh plugin --profile <profile> add 'github:<OWNER>/paper-reader#v0.1.0'
```

等价写法：

```powershell
dsh plugin --profile <profile> add 'git+https://github.com/<OWNER>/paper-reader.git#v0.1.0'
```

- 建议用引号包住 spec，避免 PowerShell 把 `#` 当注释。
- 仓库里已提交构建产物，安装时**不需要本地构建**，也没有安装脚本需要审批。
- 安装后 bundle 默认启用；替换已安装版本需要重启 DSH。
- 让 agent 安装时，`plugin_manager` 的 `install_bundle` target 填同一个 spec。
- **DSH Desktop** 的 `desktop` profile 由桌面端管理，请用 Desktop 的 Plugins 设置或 agent 的 `plugin_manager`。

### 方式二：GitHub Release tarball（备选）

```powershell
dsh plugin --profile <profile> add 'https://github.com/<OWNER>/paper-reader/releases/download/v0.1.0/paper-reader-0.1.0.tgz'
```

> 注意：pnpm 11.0–11.8 配合 DSH profile 的 hoisted 布局安装裸 Release 资产 URL 时可能报 `ERR_PNPM_MISSING_TARBALL_INTEGRITY`（11.9+ 正常）。优先用上面的 tag 安装。

### 方式三：本地目录（开发/离线）

- DSH 的 Plugins 设置里 **Add plugin / 添加本地目录**，选择本仓库目录；或
- 让 agent 调 `plugin_manager` 的 `install_bundle`，target 填本仓库绝对路径。

本地目录是链接安装：修改源码后需要重新构建并重新加载插件条目（关掉再打开该插件）。

### 方式四：npm 包 `paper-reader`（计划中，尚未发布）

```powershell
dsh plugin --profile <profile> add paper-reader   # 仅在 npm 发布后才可用
```

> 目前 npm 上还没有这个包；安装方式以 GitHub 的 tag 为准。`<OWNER>` 待填。

安装后：打开右侧栏 → 在引导页点「论文阅读器」卡片 → 打开「论文」标签页。

---

## 数据与隐私

### 数据落点

所有持久数据都在 DSH home（`$DSH_HOME`，通常是 `~/.dsh`）下，**不写入用户工作区**：

```
paper-reader/papers/<sha1>.pdf          论文字节（供 paper_* 工具读取）
paper-reader/papers/<sha1>.text.json    逐页文本缓存（首次工具调用时生成）
paper-reader/annotations/<sha1>.json    高亮与边注（{ key, highlights }）
```

`<sha1>` 是论文 key 的 SHA-1：

- 本地文件：绝对路径；
- 拖拽文件：`drop:<文件名>:<大小>:<修改时间>`；
- arXiv：`arxiv:<arXiv ID>`。

浏览器本地（localStorage）只保存两样小数据：`dsh.paper-reader.tab.<tabId>`（当前标签页打开的是哪篇）与 `dsh.paper-reader.pos.<key>`（页码与缩放）。目前**没有界面内的数据清理入口**，需要时手动删除 `$DSH_HOME/paper-reader/`。

### 网络行为

- **唯一的出站请求**：打开/搜索 arXiv 时，Host 端访问 `https://export.arxiv.org/api/query`（元数据/检索）与 `https://arxiv.org/pdf/<id>`（PDF 下载），请求带固定 `User-Agent`，超时 45 秒，PDF 上限 32 MiB。
- 浏览器端只访问 DSH 同源的 `/paper-reader/api/*`，不加载 CDN、字体、统计脚本或任何第三方资源。
- 本地 PDF 完全在本地处理；论文文件与标注不会上传到任何服务器。
- `/paper-reader/api/*` 只接受回环地址（`127.0.0.1`/`localhost`/`[::1]`），写操作还要求同源 `Origin`；其它来源返回 403。
- **无遥测、无分析、无外部上报**。
- 提醒：使用 arXiv 功能时，arXiv.org 能看到你检索/打开的 arXiv ID；本地 PDF 不产生任何网络请求。

---

## 已知限制

- **OCR 未接入**：扫描版 PDF 只有页图，没有文本层，全文搜索/翻译/`paper_*` 都读不到内容。
- 首屏以第 1 页的尺寸占位；横向页在真正渲染前会有一次尺寸跳动。
- 高亮锚定「页 + 文本片段」：**跨页选区会被拒绝**；同一页里完全重复的文本只会标记第一处；论文文件被移动/改名（本地路径 key 变化）后，旧标注不会自动跟随。
- 文本层按需构建：有高亮或搜索命中的页、以及开始选择的页才会建文本层。在尚未建层的页面上第一次拖动选择，约一两百毫秒后工具条才出现（选区会自动补全，不需要重拖）；之后再选即时。
- 切换到右侧栏其它标签再切回时，阅读层会卸载并从 Host 重新载入同一篇论文（页码/缩放按记忆恢复）。若 Host 已重启且没有该论文的字节，标签会回到空状态。
- 文件上限 32 MiB（本地与 arXiv 一致）；arXiv 抓取 45 秒超时；关键词搜索单次最多 10 条结果。
- agent 工具只认「当前会话、当前标签页」打开的那篇论文；同一篇论文在多个标签打开时以最后打开/恢复的为准。
- 高亮/笔记没有导入导出；删除 `$DSH_HOME/paper-reader/annotations/` 中的文件即等于删除对应论文的标注。
- 多标签同时打开很多长篇论文仍会占用较多内存（每篇一个 PDF worker），建议按需关闭标签。

---

## 开发

要求：Node.js（DSH 自身要求 ≥ 24.9）与 pnpm。

```powershell
pnpm install
pnpm build        # -> client.js + client.pdf.js + lib/host.js + lib/pdf.worker.mjs
pnpm typecheck    # tsc -p tsconfig.json
```

产物：

| 文件 | 作用 |
|---|---|
| `client.js` | 常驻客户端半：标签页注册、空状态、arXiv 入口、标注存储接线、对话动作 |
| `client.pdf.js` | 懒加载 chunk：PDF.js 渲染、目录、全文搜索、高亮绘制（`require.async` 拉取） |
| `lib/host.js` | Host 半：`/paper-reader/api/*` 路由、arXiv 抓取、四个只读工具（内置 PDF.js 做文本抽取） |
| `lib/pdf.worker.mjs` | Host 侧 PDF.js 伪 worker，必须与 `lib/host.js` 同目录 |

说明：

- 构建产物是**提交进仓库**的（包内没有 `prepack`/`prepare`，从 git 安装与 npm tarball 都需要现成的 JS）。
- 客户端与宿主类型来自真实 DSH 包（`devDependencies` 固定到 `0.2.2-rc.3`），DSH 契约变化会直接变成类型错误。
- 当前构建在 Windows 上验证（`@esbuild/win32-x64` 被显式固定）；其它平台构建前请先确认 `devDependencies`。
- 发布流程见 `docs/PUBLISHING.md`（内部文档）。

## 项目结构

```
src/client/index.tsx        tab 类型、body、标题、引导页入口注册
src/client/PapersBody.tsx   空状态（路径/拖拽/arXiv 搜索）、按标签页恢复论文、标注与对话动作接线
src/client/annotations.ts   按论文的标注 store（防抖写、离开时 flush）
src/client/pdf/chunk.tsx    阅读层：渲染窗口、目录、全文搜索、选区工具条、笔记
src/client/pdf/marks.ts     按「页 + 文本片段」把高亮画回重建后的文本层
src/host/index.ts           Host 入口：/paper-reader/api/*、工具注册
src/host/{arxiv,store,text,tools}.ts  arXiv 抓取、落盘、文本抽取、四个只读工具
```

## 参与贡献

- 提 issue 前请先在「已知限制」里确认不是已知问题；请附 DSH 版本、操作系统、安装方式与复现步骤，**不要上传受版权保护的论文 PDF**。
- 安全问题请按 `SECURITY.md` 的渠道私密报告。
- 许可证：MIT（见 `LICENSE`）；随包分发的 PDF.js 为 Apache-2.0，第三方许可证与修改声明见 `THIRD-PARTY-LICENSES.md`。

---

## English summary

**Paper Reader** adds a **Papers** tab to the DSH right sidebar. Open local PDFs by drag-and-drop or absolute path, an arXiv link/ID, or arXiv keyword search; read with continuous scrolling, outline jumps, whole-paper search and a remembered position; keep multi-colour highlights with margin notes per paper; quote a selection into the conversation or ask the agent to explain/translate it. Four read-only agent tools (`paper_info`, `paper_outline`, `paper_read`, `paper_search`) read the paper currently open in the session — no path needed.

Data lives under `$DSH_HOME/paper-reader/` (paper bytes, extracted-text cache, annotations), plus a small localStorage pointer for the open paper and reading position per tab. The only outbound network traffic is the Host fetching from arXiv (`export.arxiv.org`, `arxiv.org`); the browser talks only to the loopback-only, same-origin `/paper-reader/api/*` routes. No telemetry.

**Known limitations:** scanned PDFs have no text layer (OCR is a work in progress — see the marked TODO above); cross-page selections are rejected; duplicated text on a page is highlighted at its first occurrence only; moving/renaming a local PDF detaches its annotations; a 32 MiB file cap; the first selection drag on a page builds its text layer and takes a moment.

Install from the GitHub tag: `dsh plugin --profile <profile> add 'github:<OWNER>/paper-reader#v0.1.0'` (or the Release tarball URL); a local directory can be linked for development. An npm package `paper-reader` is planned, not published yet. Development: `pnpm install && pnpm build && pnpm typecheck`. License: MIT; bundled PDF.js is Apache-2.0 (see `THIRD-PARTY-LICENSES.md`). Repository: `https://github.com/<OWNER>/paper-reader` (owner placeholder — to be filled in before publication).
