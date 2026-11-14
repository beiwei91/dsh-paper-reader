# 发布清单（dsh-papers）

本文是发布准备产物，**不执行任何发布动作**：不 `npm publish`、不创建 GitHub 仓库、不 `git push`、不安装/卸载当前 profile 里的插件。
所有命令都在仓库根目录 `D:\CODE\dsh-paper-reader` 下执行。

核对时间：2026-11-14。核对基线：本地 `HEAD = 533c6a7`、工作区无未提交改动；运行环境为 DSH **0.2.2-rc.3**（Desktop，profile `desktop`，Electron `app.asar`）、pnpm 11.24.0、Node 24.16.0、`pdfjs-dist` 6.3.289。

已由用户决定的项（2026-11-14）：发布包名 **`dsh-papers`**（unscoped）、仓库地址使用占位 `https://github.com/<OWNER>/dsh-papers`。`dsh-paper-reader` 已被他人占用（见 §0.1），因此改用 `dsh-papers`；**改名延后到发布前最后一步**，现在仓库保持 `@local/dsh-paper-reader` 不动，保证用户当前安装的插件继续可用（§3）。

---

## 0. 发布前阻断项与决策记录

### 0.1 决策记录：发布名定为 `dsh-papers`（2026-11-14）

- `dsh-paper-reader` 已被他人占用，不可发布。证据（2026-11-14，npm 公共 registry）：
  ```
  pnpm view dsh-paper-reader --json --registry https://registry.npmjs.org/
  → name: dsh-paper-reader, version: 1.5.0, license: MIT
    description: 英文文献精读插件：注册 paper_ingest 工具 …（另一个项目，维护者 rantz）
    versions: 1.3.0, 1.4.0, 1.4.1, 1.4.2, 1.4.3, 1.5.0
  ```
- **2026-11-14 决定：公开发布名使用 `dsh-papers`**。当天查询 `pnpm view dsh-papers version --registry https://registry.npmjs.org/` 返回 404（当时未被占用）。
- 发布当天必须再查一次：`pnpm view dsh-papers version --registry https://registry.npmjs.org/` 必须仍是 404；404 不构成保留，若已被占用则回到 scope 方案 `@<npm 用户>/dsh-papers`（首次发布即创建该用户 scope）。
- `@local/*` 是本地插件约定，不能作为公共发布名（该 scope 不属于本仓库）；`@deepseek-ai/*` 属于官方，禁止使用。
- 社区目录按 npm 包名去重/匹配更新，若名字最终无法发布，后续上架也无从谈起。

### 0.2 PDF.js 是 Apache-2.0：许可证文本已补齐，发布时需加入 `files`

`pdfjs-dist@6.3.289` 的许可证是 **Apache-2.0**（`node_modules/pdfjs-dist/package.json`；全文见 `node_modules/pdfjs-dist/LICENSE`，177 行）。它被分进三个随包分发的产物：

| 产物 | 来源 | 说明 |
|---|---|---|
| `lib/host.js` | `pdfjs-dist/legacy/build/pdf.mjs` 经 esbuild 打包 | 生成产物；本项目未改动 PDF.js 源码 |
| `lib/pdf.worker.mjs` | `pdfjs-dist/legacy/build/pdf.worker.mjs` 原样复制 | 与上游一致 |
| `client.pdf.js` | `pdfjs-dist` 浏览器构建打包，并内联 worker 源码 | 生成产物；本项目未改动 PDF.js 源码 |

- **已新增** 仓库根 `THIRD-PARTY-LICENSES.md`：说明 PDF.js 以未修改的形式再分发（以 bundle 形式 embedded in generated `lib/host.js` / `client.pdf.js`，并以 `lib/pdf.worker.mjs` 原样复制），逐字收录 `node_modules/pdfjs-dist/LICENSE` 的 Apache-2.0 全文与 Mozilla 版权行。
- **发布时**必须把 `THIRD-PARTY-LICENSES.md` 加入 `package.json.files`（见 §2 diff；本次按用户要求尚未改 `package.json`）。
- MIT `LICENSE` 只覆盖本项目自己的代码；PDF.js 仍归 Mozilla/贡献者，按 Apache-2.0 分发。
- 注意：依赖由并发 agent 改动/重装，`node_modules/pdfjs-dist` 可能被更新。发布前确认版本仍是 **6.3.289**（`node -p "require('pdfjs-dist/package.json').version"`）；若版本变化，应按新的 `node_modules/pdfjs-dist/LICENSE` 重新生成 `THIRD-PARTY-LICENSES.md`（本文件的许可证全文是在版本 6.3.289 时逐字复制的）。

### 0.3 其它非阻断但必须处理的项

| 项 | 现状 | 处理 |
|---|---|---|
| `"private": true` | 存在 | 删除（或改为 `false`）；否则 npm/pnpm 拒绝发布 |
| `"name": "@local/…"` | 存在（**现在故意不改**，保证用户当前安装的插件继续可用） | 发布前最后一步改成 `dsh-papers`（§3） |
| 缺 `license` / `repository` / `homepage` / `bugs` / `keywords` / `engines.dsh` / `publishConfig` | 缺失 | 见 §2 diff |
| `README.md` 含本机绝对路径 `D:\CODE\dsh-paper-reader` | 第 11–12 行 | 用 `docs/README.draft.md` 替换（本次不改 `README.md`） |
| 图标/示意图的作者与授权 | `icon.svg`、`docs/preview.svg` 为仓库内原创文件 | 所有者确认可再分发（`host-plugin.md` 的显示资源要求） |
| `.gitignore` 未忽略 `*.tgz` | `pnpm pack` 会在仓库根生成 tarball | 建议补 `*.tgz`（不在本次写入范围内） |
| 示例路径 `D:\papers\attention-is-all-you-need.pdf` 出现在 `src/client/locale.ts` 与生成的 `client.js` | Windows-only 示例 | 非阻断；公开发布前建议换成平台中立的示例（需改 source 并重建，属并发 agent 的范围） |
| 开发依赖 `@esbuild/win32-x64` | 只在 Windows 上验证过构建 | 不进入 tarball，不影响发布；跨平台贡献/CI 需先确认构建（见 §10） |
| `testdata/attention.pdf`（2.2 MB） | 已被 `.gitignore` 忽略、未跟踪 | 保持不提交（论文 PDF 不应再分发） |
| `.pnpm-store/`、`.build/`、`node_modules/` | 均已忽略、未跟踪 | 不进入 tarball |

泄露扫描结论：仓库内没有 `.env`、密钥、token 或个人路径写入运行时数据。grep 命中的 `password`/`token` 字样全部来自 `lib/host.js`、`lib/pdf.worker.mjs`、`client.pdf.js` 中内联的 PDF.js 实现；唯一的本地路径是 UI 示例占位符（上表）。`git remote -v` 为空（尚未关联远端）。

---

## 1. 已验证的发布规则与来源

以下结论都读自**本机安装的 DSH 0.2.2-rc.3**，不是凭记忆。路径前缀记为
`<dsh> = D:\Program Files\dsh\resources\app.asar\dsh\node_modules`。

| 规则 | 来源（路径 · 章节） |
|---|---|
| bundle = `package.json` 声明 `dsh.bundle.patch` 的包；patch 用 Loader YAML 插入插件行；包名与行名要唯一 | `<dsh>/@deepseek-ai/dsh-agent-preset/skills/dsh-doc/references/host-plugin.md` · “Manifest” |
| 展示元数据来自导出的 locale JSON 的 `meta.title`/`meta.description`；图标来自导出的 `./icon`（或根 `package.json.icon`，优先）；图标限 SVG/PNG/JPEG/WebP、≤256 KiB、必须在包内；`files` 必须包含 patch、locale、详情文档、图标和全部运行时文件；发布包要核对实际打包清单 | 同上 · “Display metadata, detail document, and icon” |
| 详情页文档由 `meta.detail` 指定，文档内**恰好一张**特性图；图片与文档同目录；`docs` 必须在 `files`；缺文件会报错而不是回退 README | `…/references/plugin-details.md` · “Declare the document”“Compose the image” |
| 详情页只渲染 Markdown，原始 HTML 被省略、相对链接显示为纯文本；`detailMaxBytes` 默认 1 MiB、`detailImageMaxBytes` 默认 5 MiB | `<dsh>/@deepseek-ai/dsh-plugin-manager/README.md` · “Bundle detail documents”“Configuration” |
| Client 半：artifact 注册的 lazy factory **id 必须等于包名**；`dsh.client` 声明 `platform`/`immediately`/`inject`；非基线运行时导入写 `dsh.client.external` | `…/references/ui-plugin.md` · “Client module” |
| 安装走 `plugin_manager` `install_bundle`（本地目录 / registry spec / git / tarball）；安装成功默认启用新 bundle；替换已安装包要重启才能加载新的 JS 模块代 | `…/references/host-plugin.md` · “Install, enable, and observe”；`<dsh>/@deepseek-ai/dsh-plugin-manager/README.md` · “Use this package” |
| 面向用户的安装命令：`dsh plugin --profile <name> <pnpm args>`（在 profile 目录里转发给 pnpm）；`dsh web` 等 profile 由各自模板初始化 | `<dsh>/@deepseek-ai/dsh/README.md` · “Entry modes”“Profiles” |
| Desktop 的 `desktop` profile 由 Electron shell 拥有，npm CLI 拒绝管理它；Desktop 的包操作归 Desktop shell | `<dsh>/@deepseek-ai/dsh/README.md` · “Entry modes”；`<dsh>/@deepseek-ai/dsh-plugin-manager/README.md` · “Known Limitations and Deferred Work” |
| DSH 兼容性：安装与 profile 启动都会校验声明的 `engines.dsh` 范围；未声明时改用 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` 的 peer 范围；不兼容需要显式“精确版本豁免” | `<dsh>/@deepseek-ai/dsh/README.md` · “Profiles”；`<dsh>/@deepseek-ai/dsh-plugin-manager/README.md` · “Version compatibility and exemptions” |
| 语义细节：声明了 `engines.dsh` 时**只看它**、忽略 peer；预发布版本参与范围匹配；空/非法范围（含 `workspace:`）视为不兼容；拒绝会点名 `engines.dsh` 或 peer 包名；豁免按精确 `name@version` 存在 profile 的 `compatibility.json`，插件升级与 DSH 升级都不继承 | `<dsh>/@deepseek-ai/dsh-app-boot/README.md` · “Profiles” |
| `engines.dsh` 字段定义：与 `engines.node` 并列、可省略；`dsh.manifestVersion`（格式 1）与 `dsh.bundle.platforms`、`dsh.bundle.listedByDefault` 均为可选 | `<dsh>/@deepseek-ai/dsh-package-manifest/README.md` · “Use this package” |
| 更新：registry 来源的 bundle 以精确版本保存，可 `listVersions`/`updateBundle`；更新前先校验目标的 `engines.dsh`/DSH peers，不兼容则停在 `step: 'check'` 且 profile 不变；拒绝降级 | `<dsh>/@deepseek-ai/dsh-plugin-manager/README.md` · “Use this package” |
| 社区目录（dshmarket）：本仓库是 market app，不是目录；上架要向 **awesome-dsh-plugin/awesome-dsh-plugin** 提 PR（一条 entry），站点与 market 自动收录 | `<profile>/node_modules/dshmarket/README.md` · “Submit your plugin”（安装版本 1.73.19） |
| dshmarket 的目录也有 format-1 index 形态，源地址：`https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json`（GitHub Pages 的副本可能超过 15 s 抓取超时） | 同上 · 文首提示块 |
| DSH 自带 Discover / `plugin_market` 读取用户配置的 format-1 index（`indexes` 配置项），安装仍走 `pluginManager.installBundle` | `<dsh>/@deepseek-ai/dsh-plugin-market/README.md` · “Use this package” |
| format-1 index 的**精确**校验规则（`format: 1`、必填字段、类型、URL/commit/版本约束、icon 规则、版本降序） | `<dsh>/@deepseek-ai/dsh-plugin-market-index/src/index.ts`（`parseMarketIndex`，0.2.2-rc.3）；说明见该包 README |
| dshmarket 读取的 `plugins.json`（awesome 目录）运行时结构 | `<profile>/node_modules/dshmarket/lib/types/registry.d.ts`（`Registry` / `RegistryPlugin`） |
| “只能用 UI/浏览器验证”的边界：无浏览器控制时只能核对声明路径、打包资源与图片内容，并如实报告“渲染未验证” | `…/references/verification.md`；`plugin-details.md` · “Verify the detail page” |

> `…/references/…` 指 `<dsh>/@deepseek-ai/dsh-agent-preset/skills/dsh-doc/references/`。其它包路径为 `<dsh>/@deepseek-ai/<包名>/`。

---

## 2. `package.json` 建议改动（diff，未应用）

> **前提**：发布名已定为 `dsh-papers`（§0.1）。**这份 diff 在发布前最后一步才应用**（§3）；现在仓库必须保持 `@local/dsh-paper-reader`，否则用户当前安装的插件会断。
> `THIRD-PARTY-LICENSES.md` 已在仓库根存在（§0.2），发布时随这份 diff 一起加入 `files`。

```diff
 {
-  "name": "@local/dsh-paper-reader",
+  "name": "dsh-papers",
   "version": "0.1.0",
-  "private": true,
   "type": "module",
   "main": "./lib/host.js",
+  "license": "MIT",
+  "repository": {
+    "type": "git",
+    "url": "git+https://github.com/<OWNER>/dsh-papers.git"
+  },
+  "homepage": "https://github.com/<OWNER>/dsh-papers#readme",
+  "bugs": {
+    "url": "https://github.com/<OWNER>/dsh-papers/issues"
+  },
+  "keywords": [
+    "dsh",
+    "deepseek-harness",
+    "dsh-plugin",
+    "pdf",
+    "arxiv",
+    "paper-reader",
+    "pdfjs"
+  ],
+  "engines": {
+    "dsh": ">=0.2.2-rc.3 <0.3.0-0"
+  },
+  "publishConfig": {
+    "access": "public"
+  },
   "scripts": {
     "build": "node build.mjs",
     "typecheck": "tsc -p tsconfig.json"
   },
-  "description": "论文阅读器：在 DSH 右侧栏阅读 PDF 论文（目录、页内搜索、高亮边注、agent 只读工具）",
+  "description": "Paper Reader for DeepSeek Harness: read PDF papers in the right sidebar with outline, in-document search, highlights and margin notes, arXiv open/search, and four read-only paper_* agent tools. 论文阅读器：在 DSH 右侧栏阅读 PDF 论文。",
   "exports": {
     ".": "./lib/host.js",
     "./client": "./client.js",
     "./locale/*.json": "./locale/*.json",
-    "./icon": "./icon.svg"
+    "./icon": "./icon.svg",
+    "./cordis.patch.yml": "./cordis.patch.yml",
+    "./package.json": "./package.json"
   },
   "files": [
     "lib/host.js",
     "lib/pdf.worker.mjs",
     "client.js",
     "client.*.js",
     "cordis.patch.yml",
     "locale/*.json",
-    "docs",
-    "icon.svg"
+    "docs/DETAIL.md",
+    "docs/preview.svg",
+    "icon.svg",
+    "LICENSE",
+    "THIRD-PARTY-LICENSES.md"
   ],
```

说明与取舍：

- **`version` 保持 `0.1.0`**：这是 `dsh-papers` 的首次公开发布；不要为了“看起来成熟”跳到 1.0。npm 上的 `dsh-paper-reader@1.5.0` 属于另一个项目，不能复用其版本历史（这也是选 `dsh-papers` 的原因之一）。
- **`private` 直接删除** 比 `"private": false` 更干净；两者都能发布。
- **`engines.dsh` 是最低 0.2.2-rc.3**：`devDependencies` 的 DSH 客户端/宿主类型都固定在 `0.2.2-rc.3`，类型契约是按该版本验证的；`<0.3.0-0` 是社区常用写法（排除 0.3.0 及之后的预发布）。这是“建议值”，最终必须用真实安装验证一次（见 §6、§12）。空/非法范围、`workspace:` 都会被视为不兼容。
- **不需要 `peerDependencies` / `dependencies`**：`lib/host.js` 已把 PDF.js 等依赖打进去，`client.pdf.js` 也自包含；客户端只把 `react`/`react-dom` 作为宿主 externals（由 DSH 提供），因此运行时没有 npm 依赖需要解析。声明了 `engines.dsh` 后 peer 范围本来也会被忽略；若以后确实要声明 peer，请只写 `@deepseek-ai/dsh`/`@deepseek-ai/dsh-*`。
- **`keywords`**：`plugin_market` 的文本检索会匹配包名、作者、keywords 和 title/description，所以这些词会实际影响可发现性。
- **`description`**：`package.json.description` 是 bundle 详情/目录里的原始描述；英文在前便于 npm/GitHub 检索，中文保留原意。
- **`exports` 新增两项是可选的**：`./cordis.patch.yml` 与 `./package.json` 是官方 bundle 的常见导出（例如 `@deepseek-ai/dsh-base`、`dshmarket`），方便工具读取；bundle 的 patch 本身由 `dsh.bundle.patch` 直接定位，不依赖 export。
- **`files` 新增 `LICENSE`/`THIRD-PARTY-LICENSES.md`**：npm 会自动带上 `LICENSE`/`README`/`package.json`（见 §5 实测），显式列出无害；第三方许可证文件必须显式加入。
- **不要加 `prepack`/`prepare` 构建脚本**：仓库提交了构建产物（§4），且当前构建依赖 Windows 平台二进制；等跨平台构建验证后再考虑。

---

## 3. 改名（延后到发布前最后一步；需要一次 DSH 重启）

**时序决定（2026-11-14）：其它所有工作先完成，改名放在发布前的最后一步。** 现在仓库必须保持 `@local/dsh-paper-reader` —— 用户当前 profile 以 link 依赖安装了这个名字，提前改名会让插件失效。

发布前按下面顺序执行（这些是 `package.json` diff 之外的连带改动）：

1. **改 source 与 patch**：
   - `package.json.name`：`@local/dsh-paper-reader` → `dsh-papers`（完整 diff 见 §2，同时删除 `private`、补齐元数据、精确化 `files`）。
   - `cordis.patch.yml`：`name: '@local/dsh-paper-reader'` → `name: 'dsh-papers'`（行 id `paper-reader` 可不变）。
   - `src/client/index.tsx` 的 `TAB_ID`（当前 `'@local/dsh-paper-reader'`）：改成 `dsh-papers`，保持 tab/标题 slot key 一致；它只是 UI key，不是模块 id，但保留旧字符串会误导。
2. **重新构建**：`build.mjs` 用 `pkg.name` 生成模块加载器 id；当前已提交的产物里写死旧名：
   - `client.js:2` → `window.__ModuleLoader__.load({id:\`@local/dsh-paper-reader\`,…`
   - `client.pdf.js:2` → 同样的 `id` + `chunk`。
   - **loader id 必须等于包名**（ui-plugin.md），所以改名后**必须 `pnpm build` 并提交重建后的 `client.js`、`client.pdf.js`**（以及 `lib/*`）。不要手改产物。
3. **打包核对**：`pnpm typecheck`、`pnpm pack --dry-run`，确认清单是 §5 的 14 个文件、`client.js` 第 2 行的 id 已变为 `dsh-papers`。
4. **提交/打标签/发布**：见 §11；这一步之后 npm 上才有 `dsh-papers`。
5. **更新本地 profile（改名后必须做；这一步需要一次 DSH 重启）**：
   当前 `C:\Users\gzy\.dsh\profiles\desktop\package.json`：
   ```json
   "dependencies": { "@local/dsh-paper-reader": "link:D:/CODE/dsh-paper-reader", … },
   "dsh": { "profile": { "bundles": [ …, "@local/dsh-paper-reader" ] } }
   ```
   顺序：
   a. 确认新产物已构建（`client.js` 第 2 行的 id 是 `dsh-papers`）；
   b. **先移除旧 bundle**（Plugins 页面 Remove，或对允许的 profile 用 `dsh plugin --profile <profile> remove @local/dsh-paper-reader`；Desktop profile 由 Desktop shell 管理）；
   c. 再安装新名字（本地目录，或发布后的 registry 包 `dsh-papers`，见 §6）；
   d. **重启一次 DSH**：改名改变了模块名与模块代，插件必须重新加载；重启后核对 Plugins 里只有一行 `paper-reader`、右栏「论文」标签正常、四个工具可用。
   顺序理由：旧包与新包的 patch 都插入**同一个行 id `paper-reader`**，两者同时安装会出现同一 id 的重复/覆盖行；且旧依赖键在 `package.json.name` 改名后已无法解析，下次 profile 启动会把该 bundle 列为 skipped。
6. **数据不需要迁移**：论文文件、文本缓存、标注都按“论文 key 的 sha1”落盘（`src/host/store.ts`），与包名无关；改名后旧标注仍对应同一篇论文（只要 key 不变：本地绝对路径 / `drop:` / `arxiv:<id>`）。
7. **不要靠改目录名完成改名**：身份来自 `package.json.name`，目录名无关；改目录只会让现有 link 断掉。

---

## 4. 哪些产物必须提交，哪些是生成物

仓库已提交构建产物（`client.js`、`client.pdf.js`、`lib/host.js`、`lib/pdf.worker.mjs`），这是有意为之：包内**没有** `prepack`/`prepare`，从 git 安装（`dsh plugin add github:...`）和 npm tarball 都必须直接拿到可运行的 JS。

| 路径 | 类别 | 处理 |
|---|---|---|
| `src/**`、`build.mjs`、`tsconfig.json`、`package.json`、`pnpm-lock.yaml`、`locale/*.json`、`cordis.patch.yml`、`icon.svg`、`docs/**`、`README.md`、`LICENSE` | 源码/元数据 | 必须提交 |
| `client.js`、`client.pdf.js`、`lib/host.js`、`lib/pdf.worker.mjs` | **构建产物（提交）** | 每次发布前 `pnpm build`，review diff 后提交；`.gitattributes` 已标记 generated |
| `.build/`（esbuild 中间产物、`pdf-worker.txt`） | 生成物（忽略） | 不提交、不发布 |
| `node_modules/`、`.pnpm-store/`、`testdata/`、`*.log` | 本地/测试数据（忽略） | 不提交、不发布 |
| `*.tgz` | `pnpm pack` 产物 | 不提交（建议补进 `.gitignore`） |
| `THIRD-PARTY-LICENSES.md` | 第三方许可证文本（本次已提交到仓库根） | 发布时加入 `files`（§0.2；本次不改 `package.json`） |

发布前固定动作：

```powershell
pnpm install            # 保证 lockfile 与 package.json 一致
pnpm typecheck          # tsc -p tsconfig.json（本次已实测通过，无输出即成功）
pnpm build              # 重建 4 个产物
git status --short      # 只应看到预期的源码/产物/文档改动
git diff --stat -- client.js client.pdf.js lib/
```

---

## 5. 打包验证（read-only）

本次已执行（在 `private: true`、旧包名的状态下也能跑；`pack` 不等于 `publish`）：

```powershell
pnpm pack --dry-run
```

当时输出（12 个文件）：

```
package: @local/dsh-paper-reader@0.1.0
Tarball Contents
client.js
client.pdf.js
cordis.patch.yml
docs/DETAIL.md
docs/preview.svg
icon.svg
lib/host.js
lib/pdf.worker.mjs
locale/en.json
locale/zh.json
package.json
README.md
Tarball Details
local-dsh-paper-reader-0.1.0.tgz
```

### 本次写入 LICENSE 与两份 docs 之后的实测清单（15 个文件，含内部文档）

补完 LICENSE 与本次交付的 `docs/PUBLISHING.md`、`docs/README.draft.md` 后再次实测：

```
package: @local/dsh-paper-reader@0.1.0
client.js
client.pdf.js
cordis.patch.yml
docs/DETAIL.md
docs/preview.svg
docs/PUBLISHING.md      ← 内部流程文档，不应公开分发
docs/README.draft.md    ← 发布后才应变成根 README，不应进包
icon.svg
lib/host.js
lib/pdf.worker.mjs
LICENSE
locale/en.json
locale/zh.json
package.json
README.md
Tarball Details
local-dsh-paper-reader-0.1.0.tgz
```

**问题已由实测确认**：`files` 里的 `"docs"` 会把 `docs/PUBLISHING.md` 与 `docs/README.draft.md` 一并打进包。发布前必须二选一：

1. 把这两份发布文档移出 `docs/`（例如 `publishing/`，并同步改 `files`），或
2. 把 `files` 精确成 `"docs/DETAIL.md"` 与 `"docs/preview.svg"`（推荐，最简单）。

### 改名 + 排除内部文档 + 把第三方许可加入 `files` 后的目标清单（14 个文件）

```
package: dsh-papers@0.1.0
client.js
client.pdf.js
cordis.patch.yml
docs/DETAIL.md
docs/preview.svg
icon.svg
lib/host.js
lib/pdf.worker.mjs
LICENSE
locale/en.json
locale/zh.json
package.json
README.md
THIRD-PARTY-LICENSES.md        ← 文件已在仓库根；加入 files 后才进包
```

- `README.md`、`LICENSE`、`package.json` 由 npm 自动包含，不依赖 `files`（实测 `README.md`/`package.json` 已出现在 dry-run 里）。
- 包内**不应**出现：`src/`、`build.mjs`、`tsconfig.json`、`.npmrc`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`、`node_modules/`、`.build/`、`testdata/`、`*.tgz`、`.git/`、`.github/`（.github 当前已被 `files` 排除，实测未出现）。
- 体积（当前工作区实测）：`client.pdf.js` 1,726,464 B + `lib/pdf.worker.mjs` 2,395,538 B + `lib/host.js` 1,053,307 B + `client.js` 27,668 B ≈ 5.2 MB（未压缩）；npm 会对 tarball 再压缩。
- 建议在 `pnpm build` 后同时跑一次 `npm pack --dry-run` 交叉核对（npm 与 pnpm 对 `files` 的处理一致，但 npm 会额外显示 `LICENSE`）。
- 注意：`THIRD-PARTY-LICENSES.md` 现在**还不会**出现在 dry-run 里，因为 `package.json.files` 尚未更新（按用户要求本次不改 `package.json`）；§2 diff 应用后才会进入清单。
- 如要在本地检查真实 tarball（会写文件，故本次未做）：`pnpm pack` 后 `tar -tzf dsh-papers-0.1.0.tgz`，检查完删除 tgz、不要提交。

---

## 6. 用户如何安装

### 6.1 当前（未发布）：本地目录（link 安装）

- DSH Web/Desktop：Plugins 设置里 **Add plugin / 添加本地目录**，选择仓库目录（例如 `D:\path\to\dsh-paper-reader`）；或
- 让 agent 调 `plugin_manager` 的 `install_bundle`，target 填仓库绝对路径。
- 本地目录是 link 安装：`files` 不过滤、改完源码需重新构建并重新加载插件（关掉再打开插件条目）；Client bundle 走 HMR。

### 6.2 发布之后（registry 包）

- 通用 CLI（适用于 `web` 等 CLI 管理的 profile）：
  ```powershell
  dsh plugin --profile <profile> add dsh-papers@0.1.0
  ```
  这会转发给 pnpm，在 profile 目录安装并把包加入 `dsh.profile.bundles`（安装新 bundle 默认启用）。
- DSH Web：**Plugins** 页面安装/管理已安装的 bundle；Discover 页可浏览用户配置的 index 并一键安装（安装仍走 `pluginManager.installBundle`）。
- **Desktop**：`desktop` profile 由 Electron shell 拥有，npm CLI 会拒绝管理它；请用 Desktop 的 Plugins 设置安装（或让 agent 用 `plugin_manager`，它由 Desktop shell 提供包管理能力）。
- 从 GitHub Release 的预构建 tarball 安装（无需构建脚本）：
  ```powershell
  dsh plugin --profile <profile> add https://github.com/<OWNER>/dsh-papers/releases/download/v0.1.0/dsh-papers-0.1.0.tgz
  ```
  （第三方安装器（如 dshmarket）会优先使用作者提供的 Release tarball；npm 包本身也可直接 `add dsh-papers`。）
- 安装成功后：重启/刷新 → Plugins 出现 `paper-reader` 行（标题「论文阅读器 / Paper Reader」+ 图标 + 详情页）→ 打开右侧栏，点引导页「论文阅读器」卡片打开「论文」标签。

### 6.3 安装前置条件

- 宿主需要 pnpm（或 launcher 提供的包管理器）；否则安装操作失败。
- 目标 DSH 版本必须满足 `engines.dsh`；不满足会在 pnpm 运行前被拒绝，需要精确版本豁免（`version-exemptions` / `allow-version`，需显式接受风险）。
- 构建脚本审批与包安装是两回事：本包没有生命周期脚本，正常安装不需要 `allowBuilds`。

---

## 7. 升级预期

- **版本策略**：`vMAJOR.MINOR.PATCH`；包内 `0.y.z` 阶段允许 minor 内含破坏性变更（README 里注明）。`engines.dsh` 只会在确实用到更新的 DSH API 时收紧。
- **升级方式**：`dsh plugin --profile <profile> add dsh-papers@<new>`；Web/Desktop 的 Plugins 页也可更新（registry 来源以精确版本保存，`listVersions`/`updateBundle` 只接受**更新**的版本，拒绝降级）。
- **兼容性检查**：更新前会先看目标版本的 `engines.dsh`/DSH peers；不兼容就停在检查阶段、profile 不变。
- **生效**：替换已安装 bundle 需要重启，才能加载新的 Host JS 模块代；Client bundle 可能通过 HMR 重载。升级后建议重启一次 DSH 再验证四个 agent 工具与右栏标签。
- **数据**：`$DSH_HOME/paper-reader/**` 跨版本保留。注意当前标注/文本缓存 JSON **没有 schema 版本字段**（`{key, highlights}` / `{numPages, title, pages, outline}`）；以后若改格式，必须写迁移或只清 `*.text.json` 缓存（可重建），不要删除 `annotations/*.json`（用户数据，不可重建）。
- **回滚**：安装回旧版本即可；`engines.dsh` 不会因为回滚而自动放宽，若旧版本要求更高 DSH 会拒绝（此时只能升级 DSH 或使用豁免）。

---

## 8. DSH manifest / 展示资源 checklist（发布前逐项打勾）

- [ ] `dsh.bundle.patch` 指向 `./cordis.patch.yml`，文件在 `files` 中，行 id `paper-reader` 与包名一致（改名后）。
- [ ] patch 里的 `name` 等于包名（改名后必须更新）。
- [ ] `dsh.client.platform = "web"`、`immediately: true`、`inject` 四项与实际运行时依赖一致（当前：`sidebar-right`、`locale`、`api-gateway`、`api-workspace-files`）。
- [ ] Client artifact 的 loader id == 包名（重建后核对 `client.js` 第 2 行）。
- [ ] `exports` 保留 `.`、`./client`、`./locale/*.json`、`./icon`（`./cordis.patch.yml`、`./package.json` 可选）。
- [ ] `locale/zh.json`、`locale/en.json` 都有 `meta.title`、`meta.description`、`meta.detail = "docs/DETAIL.md"`（当前 zh 指向英文文档是允许的：其它 locale 可显式指向英文文档）。
- [ ] `docs/DETAIL.md` 恰好一行图片、相对路径 `preview.svg`、含替代文本。
- [ ] `docs/preview.svg`：自包含、`width="640" height="300"`、无 `text`/`foreignObject`/脚本/外链；≈2 KB。当前是**示意图不是截图**（可以，但别在 README 里说成截图）。
- [ ] `icon.svg`：SVG、≤256 KiB、包内相对路径、无外链；当前 534 B。
- [ ] `files` 覆盖 patch、locale、**精确的 `docs/DETAIL.md` + `docs/preview.svg`**、icon、全部运行时 JS 与 `lib/pdf.worker.mjs`。
- [ ] `files` 包含 `THIRD-PARTY-LICENSES.md`（发布时与 §2 diff 一起加入）。
- [ ] `engines.dsh` 已声明并用真实安装验证（见 §12）。
- [ ] 包内无 `src/`、构建配置、测试数据、内部发布文档（§5 的 `docs` 问题要先处理）。

详情页/图标**实际渲染**未验证（本环境无浏览器控制）。已核对的是文件存在、路径合法、打包资源齐全；按 `verification.md` 要求，发布前需在运行中的 DSH 里打开一次「Plugins → 该 bundle」分别用中文/英文确认标题、描述、图片，并确认无 metadata diagnostic。

---

## 9. GitHub 仓库形态

- 仓库名建议：`<OWNER>/dsh-papers`（与包名一致；本地工作目录仍叫 `dsh-paper-reader` 无妨）。
- 根目录：`README.md`（用 `docs/README.draft.md` 替换；含安装/使用/截图/限制/许可）、`LICENSE`、`SECURITY.md`、`docs/preview.svg`（可选再放真实截图 `docs/screenshot-*.png`）、`docs/DETAIL.md`、`.github/`。
- 标签：`v0.1.0` 注释标签，**必须与 `package.json.version` 一致**（社区安装器/更新检查会按它对齐）。
- Release：写用户可读的变更 + 安装命令；可选把 `pnpm pack` 产物作为 Release asset（第三方安装器优先用作者预构建 tarball，避免用户本地跑构建脚本）。
- README 链接：`https://github.com/<OWNER>/dsh-papers`（`<OWNER>` 全部待填）。
- 建议打开 GitHub 私密漏洞报告（Security → Advisories），与 `.github/SECURITY.md` 一致。
- 不在本仓库里放 CI 之外的“假验证”：CI 只做 install/typecheck/build，不代表插件在 DSH 里可用（`.github/workflows/ci.yml`）。

---

## 10. 社区目录（dshmarket / awesome-dsh-plugin / format-1 index）

### 10.1 已核实的事实

- **dshmarket 只是市场客户端，不是目录**。上架要 PR 到 **`awesome-dsh-plugin/awesome-dsh-plugin`**，一条 entry；站点与 market 自动收录，通常一天内（dshmarket 1.73.19 README “Submit your plugin”）。
- 同一份目录同时以 **format-1 index** 发布：`https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json`（npm 包 `dsh-plugin-catalog`）；DSH 0.2.1+ 可在 **Plugins → Discover → Index sources** 添加它（dshmarket README 文首提示）。
- DSH 的 Discover/`plugin_market` 读取**用户自行配置的** index URL（`@deepseek-ai/dsh-plugin-market` 配置项 `indexes`，默认空），不是内置公共目录；安装仍走 `pluginManager.installBundle`。
- awesome 目录的运行时 JSON 结构（dshmarket 1.73.19 类型）：
  ```ts
  Registry = {
    updated: string
    count: number
    categories: Record<string, Record<string, string>>   // id → 本地化标题
    plugins: RegistryPlugin[]
  }
  RegistryPlugin = {
    name: string        // 包名
    owner: string       // GitHub owner
    url: string         // 仓库 URL
    category: string | string[]   // 至少一个可用 category
    description: Record<string, string>   // { en: ..., zh: ... }
    install: string     // 安装 spec（pnpm 接受）
    added: string
    npm?: string | null
    tarball?: string | null
    version?: string | null
    icon?: string | null
    stars?, downloads?, capabilities?, deprecated?, replacement?, previousNpm? ...
  }
  ```
- DSH 自带 format-1 index 的**精确规则**（实现 `@deepseek-ai/dsh-plugin-market-index@0.2.2-rc.3` 的 `parseMarketIndex`）：
  - 顶层：`format: 1`（必须）、`title`（本地化文本，必须含 `en`）、`description`（可选，本地化）、`metadata`（可选：`categories`/`labels`/`sortKeys` 声明表，每项 `{ title }`，sortKey 另需 `order: "asc"|"desc"`）、`plugins`（数组）。
  - 每个 plugin：`name`（合法 npm 包名）、可选 `title`/`description`（本地化文本或字符串；对象形式必须含 `en`）、`icon`（https 绝对 URL、与 index 同源，或 ≤32 KiB 的 base64 SVG/PNG/JPEG/WebP data URL）、`author`、`homepage`（http(s) 绝对 URL）、`repository`（`{ url, directory? }`）、`metadata`（`category`/`keywords`/`labels`/`sortKeys`，引用必须在顶层声明）、`versions`（非空，版本号唯一、精确 SemVer、按 SemVer 降序）。
  - 每个 version：`version`、`publishTimestamp`（Unix 秒整数，`[0,1e11)`）、`source`（`{ type: "npm", registry? }` 或 `{ type: "git", url: https 仓库, commit: 40 位小写 sha, path? }`）、`engines`（可选 `{ dsh: SemVer range }`，不能是 `workspace:`）。
  - 安装 spec 由 `marketInstallTarget` 生成：npm 为 `name@version`，git 为 `git+<url>.git#<commit>&path:/<dir>`。
  - 一个可直接照抄的最小 index 骨架：
    ```json
    {
      "format": 1,
      "title": { "en": "Paper Reader", "zh": "论文阅读器" },
      "description": { "en": "Read PDF papers in the DSH right sidebar." },
      "metadata": {
        "categories": { "reading": { "title": { "en": "Reading", "zh": "阅读" } } }
      },
      "plugins": [
        {
          "name": "dsh-papers",
          "title": { "en": "Paper Reader", "zh": "论文阅读器" },
          "description": { "en": "PDF / arXiv paper reading in the right sidebar.", "zh": "在右侧栏读 PDF/arXiv 论文。" },
          "author": "<OWNER>",
          "homepage": "https://github.com/<OWNER>/dsh-papers",
          "repository": { "url": "https://github.com/<OWNER>/dsh-papers" },
          "metadata": { "category": "reading", "keywords": ["pdf", "arxiv", "paper"] },
          "versions": [
            {
              "version": "0.1.0",
              "publishTimestamp": 1763164800,
              "source": { "type": "npm" },
              "engines": { "dsh": ">=0.2.2-rc.3 <0.3.0-0" }
            }
          ]
        }
      ]
    }
    ```

### 10.2 上架路径

- 首选：向 `awesome-dsh-plugin/awesome-dsh-plugin` 提 PR（一条 entry，使用上面的字段语义）；被收录后自动进入 dshmarket 与站点，同时出现在 `dsh-plugin-catalog` 的 format-1 index。
- 可选：自己托管一份 format-1 `index.json`，让用户手动把 URL 加到 Discover 的 Index sources（不依赖被 awesome 收录）。
- **UNVERIFIED（必须在有 GitHub 网络的环境里确认）**：awesome 仓库实际要改的文件名/条目模板/PR 检查项/收录标准与时效；本机无法访问 `raw.githubusercontent.com`（`web_fetch` 失败），本地也没有该仓库的 README。上面 §10.1 的字段结构来自**已安装的 dshmarket 运行时类型**（读取端），不是贡献指南。
- 未验证：Desktop UI 里“按 registry spec 手动安装一个未被任何 index 收录的包”的具体入口名称（文档只说明 Desktop 的包操作归 Desktop shell，Web Plugins 页可安装 bundle）。

---

## 11. 发布命令序列（owner 执行；本次不运行）

```powershell
# 0）填 <OWNER>；先把所有不改名的工作做完（README、THIRD-PARTY-LICENSES.md 内容、<OWNER> 占位符）
#    本次不改 package.json；docs 的 files 排除策略已写在 §2 diff 里
# 1）发布前最后一步：按 §3 改名（package.json / cordis.patch.yml / TAB_ID）并重建

# 2）改名后、构建后的校验
pnpm install
pnpm typecheck
pnpm build
git status --short
git diff --stat
pnpm pack --dry-run        # 核对 §5 的 14 文件清单；确认 client.js 第 2 行 id 是 dsh-papers

# 3）提交并打标签（只提交本仓库自己的改动）
git add -A
git commit -m "chore: rename to dsh-papers and prepare v0.1.0 release"
git tag -a v0.1.0 -m "dsh-papers v0.1.0"

# 4）创建 GitHub 仓库并关联远端（owner 手工操作）
git remote add origin https://github.com/<OWNER>/dsh-papers.git
git push -u origin HEAD
git push origin v0.1.0
# 在 GitHub 上创建 Release（可选上传 pnpm pack 产物）

# 5）发布前最后检查名字可用性，然后发布（本次不执行）
pnpm view dsh-papers version --registry https://registry.npmjs.org/   # 必须 404；否则改用 @<npm 用户>/dsh-papers
npm publish --dry-run     # 只打包校验、不上传（建议）
pnpm publish --access public
# 若用 scope 方案：package.json.name 改成 @<npm 用户>/dsh-papers，并保留 publishConfig.access=public

# 6）发布后验证
pnpm view dsh-papers@0.1.0 dist.tarball
# 在一台干净机器/新 profile 上：
dsh plugin --profile web add dsh-papers@0.1.0
# 打开 Web，确认 Plugins 行、图标、详情页（中/英）、右栏「论文」标签、四个工具
```

不要忘记：本仓库的 profile 也要在改名后**先移除旧 `@local/dsh-paper-reader`、再安装/链接 `dsh-papers`，并重启一次 DSH**（§3 第 5 步）。

---

## 12. 发布前必须做的运行时验证

无浏览器控制时不能声称“界面没问题”，但可以做并应记录：

1. **manifest/兼容性**：在目标 DSH（至少 0.2.2-rc.3）上用本地目录安装一次，确认 `plugin_manager` 返回 `application: applied` / 启动不 skipped；确认 `engines.dsh` 真的被接受（若不接受，调整范围或改用精确版本）。
2. **bundle 行**：Plugins 页只出现一行 `paper-reader`，无 metadata diagnostic。
3. **详情页与图标**：中/英文各打开一次，图片加载、无 README 回退、无横向溢出（390 px 宽）。
4. **功能走查**：本地 PDF 拖拽、绝对路径、arXiv 打开、关键词搜索；目录/搜索/笔记/缩放；四色高亮+边注；引用/解释/翻译；切右栏标签再切回（论文应恢复）；`paper_info/paper_outline/paper_read/paper_search` 各调一次。
5. **升级演练**：在临时 profile 里装 0.0.x 再升级到 0.1.0，确认数据与工具不丢；替换包后重启一次再验证。
6. **卸载**：移除 bundle 后 Plugins 行消失、右栏标签不再出现、`$DSH_HOME/paper-reader` 数据保留（当前无自动清理，需手动删除）。

---

## 13. 仍需人工决定的事

1. **`<OWNER>`**：GitHub 用户名 / 组织名（`repository`、`homepage`、`bugs`、README 链接、SECURITY 联系方式）。
2. **发布日复查名字**（§0.1）：发布当天再确认 `dsh-papers` 仍是 404；若已被占用，改用 scope 方案（需要你的 npm 用户名）。
3. **是否现在发布**：运行时验证（§12）没完成前不建议；OCR 仍在并行开发，可以“先发不含 OCR 的 0.1.0、OCR 完成后发 0.2.0”，README 已留 TODO。
4. **版权署名**：`LICENSE` 当前写 “dsh-papers contributors”；要不要换成个人/组织名。
5. **图标/示意图授权**：确认 `icon.svg`、`docs/preview.svg` 为原创可再分发（或替换）。
6. **`docs/` 打包策略**：§2 diff 已改为精确的 `"docs/DETAIL.md"`+`"docs/preview.svg"`；若想保留整个 `docs/` 目录，需接受内部发布文档进包。
7. **是否提交 CI**：`.github/workflows/ci.yml` 只做构建检查，不代表 DSH 内可用；若不想维护，删掉即可。
8. **社区上架**：是否向 awesome-dsh-plugin 提 PR、是否自建 index（§10）。

---

## 14. 本次核对用到的证据

- `pnpm pack --dry-run`（12 文件；加入 LICENSE 与内部 docs 后 15 文件，见 §5）。
- `pnpm typecheck`（通过）。
- `pnpm view dsh-paper-reader --json --registry https://registry.npmjs.org/`（名字已占用，v1.5.0，另一项目 rantz）。
- `pnpm view dsh-papers version --registry https://registry.npmjs.org/` → 404（2026-11-14 决定采用该名字）。
- `pnpm view dsh-pdf-reader / dsh-paper-tab / dsh-sidebar-paper-reader version`（0.2.0 / 404 / 404）。
- `THIRD-PARTY-LICENSES.md` 的 Apache-2.0 全文逐字取自本仓库 `node_modules/pdfjs-dist/LICENSE`（177 行）。
- `git status`、`git remote -v`（无远端）、`git log`（HEAD 533c6a7）。
- 已读源码：`src/client/**`、`src/host/**`、`locale/*.json`、`cordis.patch.yml`、`build.mjs`、`package.json`、`.gitignore`、`.npmrc`、`pnpm-workspace.yaml`、`README.md`、`docs/DETAIL.md`、`docs/preview.svg`、`icon.svg`；`node_modules/pdfjs-dist/package.json` + `LICENSE`。
- 已读 DSH 文档：见 §1 表格（均为本机 `@deepseek-ai/dsh@0.2.2-rc.3` 安装内文档）。
- 已读 profile 状态：`C:\Users\gzy\.dsh\profiles\desktop\package.json`（含 `link:D:/CODE/dsh-paper-reader`）、`cordis.patch.yml`、`node_modules/@local/dsh-paper-reader` junction；`dshmarket@1.73.19` 的 README 与 `lib/types/registry.d.ts`；`.dsh-market/` 只读缓存。
