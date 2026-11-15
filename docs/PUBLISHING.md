# 发布清单（首发：GitHub-only）

本文是发布准备产物，**不执行任何发布动作**：不创建 GitHub 仓库、不 `git push`、不 `npm publish`、不安装/卸载当前 profile 里的插件。

核对时间：2026-11-14。核对基线：本地 `HEAD ≥ 533c6a7`；运行环境 DSH **0.2.2-rc.3**（Desktop，profile `desktop`，Electron `app.asar`）、pnpm 11.24.0、Node 24.16.0、`pdfjs-dist` 6.3.289。
仓库根目录（本地）：`<repo>`（本文以 `<repo>`、`$DSH_HOME`、`<profile>` 等通用占位代替本机绝对路径）。

## 已决定的发布方式（2026-11-14）

| 项 | 决定 |
|---|---|
| 本轮分发渠道 | **只走 GitHub**：仓库 + `v0.1.0` tag + GitHub Release。**不注册 npm、不 publish**。 |
| 包名（本轮） | **`dsh-paper-reader`**（与仓库同名）：改名已在发布前最后一步完成（§2，2026-11-14 的改名 commit）。`package.json.name`、`cordis.patch.yml` 行名、`TAB_ID` 与重建产物都已是新名。GitHub 安装按仓库里的 `package.json` 解析，所以 tag 仍必须打在改名 commit 之后。 |
| GitHub 仓库 | **`https://github.com/beiwei91/dsh-paper-reader`**（已创建）。 |
| 命名对照 | 包名/loader id = `package.json.name` = **`dsh-paper-reader`**；GitHub 仓库 = **`beiwei91/dsh-paper-reader`**（两者同名）。 |
| 未来 npm（可选） | unscoped **`dsh-paper-reader` 已被他人占用**（rantz，1.5.0）——本轮 GitHub-only 不受影响；未来若发布 npm，必须改用 scope（如 `@beiwei91/dsh-paper-reader`，免费账号首次发布即创建）或另选未占用名字（如 `paper-reader`，2026-11-14 查询 404）。发布日决定（§12）。 |

**版本状态（2026-11-15 更新）**：

- `v0.1.0` **已发布**：tag `v0.1.0`（注释 tag）指向 commit `e87e4bc`，GitHub Release 已创建。**已发布的 tag 不移动**，`v0.1.0` 的 commit 保持不变；回滚仍可装回它。
- **当前仓库树已在 `0.2.0`**：`package.json.version` = `0.2.0`；`v0.1.0` 之后 `main` 上的本功能轮（`ea2ccea` 缩放/最近打开/笔记徽标/摘要提示词、`ea57b0f` 下划线/文本框/八色调色板、`1d60a27` 批注 PDF 导出，以及文档同步 commit）已按 `0.2.0` 收尾，`pnpm pack --dry-run` 产物为 `dsh-paper-reader-0.2.0.tgz`（仍是 21 个文件，§5）。
- **下一公开发布版本为 `v0.2.0`**，不是重打 `v0.1.0`。发布步骤见 §11.1：在最终 commit 上打 tag `v0.2.0` → 推送分支与 tag → 用该 tag 创建 GitHub Release → 附上 `dsh-paper-reader-0.2.0.tgz` → 仓库满 24 小时后提交 awesome PR（使用已同步的 `market/beiwei91__dsh-paper-reader.yml`）。`v0.1.0` 的 tag/Release 原样保留。
- 本轮功能没有数据迁移：旧标注 JSON 缺少 `kind` 时按 `highlight` 读取，`$DSH_HOME/paper-reader/**` 跨版本保留（§7）。

---

## 0. 阻断项与决策记录

### 0.1 分发决策：本轮 GitHub-only

- 用户没有 npm 账号，也不需要为本轮发布注册。GitHub 仓库 + tag + Release 就能提供完整可安装的 bundle。
- **包名按最终决定改为 `dsh-paper-reader`，且改名已在发布前最后一步完成**（§2）：`package.json.name`、`cordis.patch.yml` 行名、`TAB_ID` 已改，产物已重建。改名 commit 同时补齐公开元数据（`license`、`repository`、`homepage`、`bugs`、`keywords`）并删除 `private: true`；`engines.dsh` 与 `publishConfig` 仍留到未来 npm 日（§3、§12）。
- 改名 commit 之前 repo 的 `package.json` 是 `@local/dsh-paper-reader` + `private: true`（当时本机 link 安装的插件继续可用）；现在改名 + 重建已提交，tag 仍必须打在“改名 + 重建”之后的 commit 上，GitHub 安装用户拿到包名 `dsh-paper-reader`。
- **命名**：包名/loader id = `package.json.name` = **`dsh-paper-reader`**，与 GitHub 仓库 `beiwei91/dsh-paper-reader` 同名；改名必须在打 tag 前完成（§2）。
- **npm 名可用性（2026-11-14，registry.npmjs.org）**：**`dsh-paper-reader` → 1.5.0（已被占用，另一项目 rantz）**，因此它只用于 GitHub-only 发布，不能直接 npm publish；`paper-reader` → 404（可用，可作为未来 npm 备选名）。此前对 `paper-reader`/`dsh-papers` 的 404 检查不适用于 `dsh-paper-reader`。

### 0.2 PDF.js 是 Apache-2.0：许可证文本已补齐

`pdfjs-dist@6.3.289` 是 **Apache-2.0**，其代码被分进三个随包产物：

| 产物 | 来源 | 说明 |
|---|---|---|
| `lib/host.js` | `pdfjs-dist/legacy/build/pdf.mjs` 经 esbuild 打包 | 生成产物；本项目未改动 PDF.js 源码 |
| `lib/pdf.worker.mjs` | `pdfjs-dist/legacy/build/pdf.worker.mjs` 原样复制 | 与上游一致 |
| `client.pdf.js` | `pdfjs-dist` 浏览器构建打包，并内联 worker 源码 | 生成产物；本项目未改动 PDF.js 源码 |

- 仓库根 **`THIRD-PARTY-LICENSES.md`** 已提供：说明 PDF.js 以未修改的形式再分发（embedded in generated `lib/host.js` / `client.pdf.js`，copied as `lib/pdf.worker.mjs`），并逐字收录 `node_modules/pdfjs-dist/LICENSE` 的 Apache-2.0 全文（177 行）与 Mozilla 版权行。
- GitHub-only 分发同样构成“再分发”，所以该文件必须在**发布 tag 的 commit 里存在**（已提交），并且已显式加入 `package.json.files`（§5），`pnpm pack` 与未来 npm 打包都会带上。
- 注意：依赖由并发 agent 改动/重装，`node_modules/pdfjs-dist` 可能被更新。发布前确认版本仍是 **6.3.289**（`node -p "require('pdfjs-dist/package.json').version"`）；若变化，按新 `LICENSE` 重新生成 `THIRD-PARTY-LICENSES.md`。
- **OCR 栈的许可证也已补齐（2026-11-15）**：`lib/ocr/**` 里内置的 ~7.5 MiB 代码与数据同样构成再分发。`THIRD-PARTY-LICENSES.md` 现按包逐项收录 `tesseract.js`（Apache-2.0）、`tesseract.js-core`（Apache-2.0）、`@tesseract.js-data/eng` + `chi_sim`（`package.json` 声明 MIT，语言数据源自 Apache-2.0 的 `tessdata_best`）、`node-fetch@2`（MIT）、`regenerator-runtime`（MIT）、`wasm-feature-detect`（Apache-2.0），以及同一 `build.mjs` 顺带打进 bundle 的 `whatwg-url`、`webidl-conversions`、`tr46`、`bmp-js`、`is-url`。两个语言数据包和 `tr46` 不随包提供 LICENSE 文件，文件里已显式标注这一点，并按各自 `package.json` 的 `license`/`repository`/`author` 字段给出声明（不虚构版权行）。

### 0.3 本轮发布前的实际待办

| 项 | 现状 | 处理 |
|---|---|---|
| **GitHub 仓库** | 已创建：`https://github.com/beiwei91/dsh-paper-reader` | 无需再填 OWNER；剩余人工步骤（topic、tag/Release、PR）见 §16。 |
| **市场文件（可选）** | `market/beiwei91__dsh-paper-reader.yml`、`market/index.json` 已备好 | 需要用户 PR / 自托管启用（§16）；不影响直接安装。 |
| **发布前改名（§2）** | **已完成**：包名已改为 `dsh-paper-reader` 并重建/提交产物 | 本机 profile 仍需换包（移除旧 `@local` bundle、安装新包）+ 重启一次 DSH（§2 第 6 步，归 Desktop shell 执行）。 |
| `README.md` 安装段与包名 | 已改写为「包名/loader id = `dsh-paper-reader`、GitHub 仓库 `beiwei91/dsh-paper-reader`」并补 GitHub 安装 spec（第 9–16 行） | 发布前仍建议用 `docs/README.draft.md` 整体覆盖（现 README 仍含本机绝对路径与开发向内容）。 |
| 运行时验证 | 仅做过 typecheck / pack dry-run | 发布前按 §14 在真实 DSH 里装一次 GitHub tag（或本地目录）走查。 |
| 图标/示意图授权 | `icon.svg`、`docs/preview.svg` 为仓库内文件 | 所有者确认可再分发（`host-plugin.md` 的显示资源要求）。 |
| `testdata/attention.pdf`（2.2 MB） | 已被 `.gitignore` 忽略、未跟踪 | 保持不提交（论文 PDF 不应再分发）。 |
| `.gitignore` 与 `*.tgz` | `pnpm pack` 会在仓库根生成 tarball | **已补 `*.tgz`**（2026-11-14）：`pnpm pack` 产物不会再被误提交。 |
| `@esbuild/win32-x64` | 只在 Windows 上验证过构建 | 不随 npm 包分发；GitHub 用户只下载已提交的构建产物，不需要本地构建。 |
| secret 扫描 | 无 `.env`/token/密钥 | 发布前再跑一次 `git status` 与 `git log --stat` 确认没带本地文件。 |

`git remote -v` 为空（尚未关联远端）；`git status` 里的其它未跟踪文件（本地分析目录等）不要提交。

---

## 1. 已验证的发布规则与来源

结论读自本机安装的 DSH 0.2.2-rc.3；路径前缀 `<dsh> = <DSH install>/resources/app.asar/dsh/node_modules`。

| 规则 | 来源（路径 · 章节） |
|---|---|
| bundle = `package.json` 声明 `dsh.bundle.patch` 的包；patch 用 Loader YAML 插入插件行；包名与行名要唯一 | `<dsh>/@deepseek-ai/dsh-agent-preset/skills/dsh-doc/references/host-plugin.md` · “Manifest” |
| 展示元数据来自导出 locale 的 `meta.title`/`meta.description`；图标来自 `./icon` 导出（或根 `package.json.icon`）；图标限 SVG/PNG/JPEG/WebP、≤256 KiB、包内路径；详情文档由 `meta.detail` 指定、恰好一张图 | `host-plugin.md` · “Display metadata, detail document, and icon”；`plugin-details.md` · “Declare the document”“Compose the image” |
| Client artifact 注册的 lazy factory **id 必须等于包名**；`dsh.client` 声明 `platform`/`immediately`/`inject` | `…/references/ui-plugin.md` · “Client module” |
| **安装目标只有四类**：npm 包名、git URL、tarball URL、本地绝对目录 —— `plugin_manager` 的 `invalid-spec` 明确给出这四类 | `<dsh>/@deepseek-ai/dsh-plugin-manager/src/tools.ts`（`ERROR_STEPS['invalid-spec']`） |
| 安装 spec 由 profile 目录里的 pnpm 执行；`source` 字段是 `pnpm add` 接受的 spec：git 地址/URL、`file:`/`link:` 本地路径、registry 的 range/tag/alias | `<dsh>/@deepseek-ai/dsh-plugin-manager/README.md` · “Use this package” |
| GitHub 仓库安装前会先 `git ls-remote` 探测；只有网络失败/超时会中止（`failedAt: 'spec-host'`），认证/仓库不存在等交给 pnpm | 同上 · “Use this package”（git 检查段落） |
| git/tarball 安装的兼容性在**安装完成后**判定；不兼容会回滚 profile 并报 `incompatible-version` | 同上 · “Version compatibility and exemptions” |
| 更新能力：registry bundle 可查版本并更新；**只有以完整 40 位 commit 固定的 git 依赖才可更新**；带 branch/tag/range 的 git spec 不可更新（只能重装） | 同上 · “Use this package”（`update` / `listVersions` / `updateBundle` 段落） |
| 安装成功后新 bundle 默认启用；替换已安装包需要重启才能加载新 JS 模块代 | `host-plugin.md` · “Install, enable, and observe”；`plugin-manager/README.md` · “Use this package” |
| 面向用户的安装命令：`dsh plugin --profile <name> <pnpm args>`（在 profile 目录转发给 pnpm） | `<dsh>/@deepseek-ai/dsh/README.md` · “Entry modes” |
| Desktop 的 `desktop` profile 由 Electron shell 拥有，npm CLI 拒绝管理它；Desktop 的包操作归 Desktop shell | `<dsh>/@deepseek-ai/dsh/README.md` · “Entry modes”；`plugin-manager/README.md` · “Known Limitations and Deferred Work” |
| DSH 兼容性：安装与 profile 启动都校验声明的 `engines.dsh`（未声明则用 `@deepseek-ai/dsh*` peer 范围）；预发布参与匹配；不兼容需精确版本豁免 | `<dsh>/@deepseek-ai/dsh/README.md` · “Profiles”；`<dsh>/@deepseek-ai/dsh-app-boot/README.md` · “Profiles” |
| 社区目录 dshmarket 是客户端不是目录；上架向 **awesome-dsh-plugin/awesome-dsh-plugin** 提 PR；同一目录也以 format-1 index 发布（`https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json`） | `<profile>/node_modules/dshmarket/README.md` · 文首提示、“Submit your plugin” |
| **format-1 index 支持 git-only 条目**：`source: { type: "git", url, commit, path? }`，不需要 npm；`version` 精确 SemVer、`publishTimestamp` Unix 秒整数、`commit` 40 位小写 sha、`url` 为 canonical https 仓库（≥2 路径段、无 query/fragment/凭据、非 tarball）、`engines.dsh` 可选且不能 `workspace:`；安装目标由 `marketInstallTarget` 生成 `git+<url>.git#<commit>[&path:/<dir>]` | `<dsh>/@deepseek-ai/dsh-plugin-market-index/src/index.ts`（`parseMarketIndex` / `source` / `marketVersion` / `marketInstallTarget`） |
| awesome 目录条目的安装目标**由 url/npm/tarball 推导**，不是任意字符串：有 `npm` 用 npm 名；否则有 `tarball` 用该 Release tarball URL；否则 `github:<owner>/<repo>`（monorepo 为 `github:<owner>/<repo>#path:/<sub>`） | `<profile>/node_modules/dshmarket/lib/sources.js`（`installTargetFor`/`githubSourceTarget`）；字段结构见 `lib/types/registry.d.ts`（`RegistryPlugin`） |
| awesome 目录支持 **GitHub-only 条目**（读仓库里的包 manifest，含 monorepo 子目录） | `dshmarket/README.md` · “What you get” |
| DSH Discover / `plugin_market` 读取用户配置的 format-1 index（`indexes`），安装仍走 `pluginManager.installBundle` | `<dsh>/@deepseek-ai/dsh-plugin-market/README.md` · “Use this package” |
| 已知风险：pnpm 11.0–11.8 + hoisted linker（DSH profile 默认）对“裸 GitHub Release 资产 URL”不记录 integrity，会报 `ERR_PNPM_MISSING_TARBALL_INTEGRITY`；11.9+ 可用 | `<profile>/node_modules/dshmarket/lib/types/sources.d.ts`（`sourceFallbackFor` 注释；第三方包内的实测说明，标为注意项而非 DSH 官方文档） |

> `…/references/…` 指 `<dsh>/@deepseek-ai/dsh-agent-preset/skills/dsh-doc/references/`；`<profile>` 指 profile 目录（`$DSH_HOME/profiles/<profile>`，本例为 `desktop`）。

---

## 2. 发布前最后一步：改名 + 重建 + tag（GitHub-only 也执行）

**时序决定：其它工作先完成，改名放在发布前的最后一步。【已完成 2026-11-14】** 改名 commit 之前仓库保持 `@local/dsh-paper-reader`（当时本机 link 安装的插件继续可用）；现在仓库已是 `dsh-paper-reader`，剩余步骤只有打 tag/Release 与本机 profile 换包。

改名连带步骤（顺序不能乱；1–3 已完成）：

1. **改 source 与 patch**（已完成）：
   - `package.json.name`：`@local/dsh-paper-reader` → `dsh-paper-reader`；同时删除 `private: true`，补齐 `license`/`repository`/`homepage`/`bugs`/`keywords`；**不**声明 `engines.dsh`、**不加** `publishConfig`（未来 npm 日再定，§3/§12）。
   - `cordis.patch.yml`：`name: '@local/dsh-paper-reader'` → `name: 'dsh-paper-reader'`（行 id `paper-reader` 不变；只改 `name` 字段）。
   - `src/client/index.tsx` 的 `TAB_ID`：`'@local/dsh-paper-reader'` → `'dsh-paper-reader'`（UI key，与包名保持一致）。
2. **重新构建**（已完成）：`build.mjs` 用 `pkg.name` 生成模块 loader id；产物会写死它（`client.js`/`client.pdf.js` 第 2 行），**loader id 必须等于包名**，所以已用 `node build.mjs` 重建并提交 `client.js`、`client.pdf.js`、`lib/*`。不要手改产物。
3. **替换 README**：`README.md` 安装段已改写为「包名/loader id = `dsh-paper-reader`、GitHub 仓库 `beiwei91/dsh-paper-reader`」并补 GitHub 安装 spec（本地目录安装保留为开发方式）；发布前仍建议用 `docs/README.draft.md` 整体覆盖（现 README 仍含本机绝对路径与开发向内容）。
4. **校验**：`pnpm typecheck`；`git status --short` 干净；`client.js` 第 2 行 id 已是 `dsh-paper-reader`；确认 `LICENSE`、`THIRD-PARTY-LICENSES.md`、`docs/DETAIL.md`、`docs/preview.svg`、`icon.svg`、`locale/*.json` 都在 commit 里。
5. **提交 + tag**：提交改名与重建产物，打 `v0.1.0`（与 `package.json.version` 一致），推送并创建 GitHub Release（§13）。
6. **更新本机 profile（改名后必须做；需要一次 DSH 重启）**：先移除旧 `@local/dsh-paper-reader` bundle，再安装 `dsh-paper-reader`（GitHub tag 或本地目录），然后**重启一次 DSH**。旧/新 patch 都插入同一行 id `paper-reader`，不能同时存在；旧依赖键改名后也不可解析。桌面 profile 的包操作归 Desktop shell。
7. **数据不需要迁移**：论文/缓存/标注按论文 key 的 sha1 落盘（`src/host/store.ts`），与包名无关。
8. **不要靠改目录名完成改名**：身份来自 `package.json.name`，本地目录名仍是 `dsh-paper-reader` 无妨。

**不需要**（本轮 GitHub-only）：npm 账号、`npm login`、`publishConfig`、`engines.dsh`（这些是未来 npm 日的事，§3）。公开仓库元数据（`license`/`repository`/`homepage`/`bugs`/`keywords`）已随改名 commit 加入，`private` 已删除（§2）。

---

## 3. 未来 npm 发布日的 `package.json` 叠加（改名已在 §2 完成）

> 仅当用户以后决定注册（免费）npm 账号并发布时执行。此时 `name` 已是 `dsh-paper-reader`（§2）；本节只叠加 npm 元数据与打包改动。

> 注：删除 `private` 与加入 `license`/`repository`/`homepage`/`bugs`/`keywords` 已在改名 commit（§2）中提前完成；npm 日从当前 `package.json` 出发只需应用下面剩余的改动。

> 注：diff 里的 `files` 改动已于 2026-11-14 的打包修正 commit 应用（`docs/DETAIL.md` + `docs/preview.svg` + `THIRD-PARTY-LICENSES.md`，实测 21 文件见 §5）；下面 diff 中这几行仅作记录，npm 日无需重复应用。

```diff
 {
   "name": "dsh-paper-reader",
   "version": "0.2.0",
   "type": "module",
   "main": "./lib/host.js",
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
     "lib/ocr",
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

说明（npm 发布日）：

- **`name` 已在 §2 改为 `dsh-paper-reader`**；注意该 unscoped 名在 npm 上**已被占用**（rantz 1.5.0），因此 npm 发布必须改用 scope（如 `@beiwei91/dsh-paper-reader`）或另选未占用名字（§12），不能直接发布 `dsh-paper-reader`。
- **`private` 已在 §2 删除**（删字段比 `"private": false` 更干净；npm 拒绝发布 private 包）。
- **`engines.dsh` 建议 `>=0.2.2-rc.3 <0.3.0-0`**：devDependencies 的 DSH 类型固定 0.2.2-rc.3；语义上声明 `engines.dsh` 后只按它判定、忽略 peer，预发布参与匹配，空/非法/`workspace:` 视为不兼容。最终用真实安装验证。
- **不需要 `dependencies`/`peerDependencies`**：`lib/host.js` 已打包 PDF.js 等依赖；客户端只把 react/react-dom 作为宿主 externals。
- **`files`（已应用，2026-11-14）**：`"docs"` 会连带 `docs/PUBLISHING.md`、`docs/README.draft.md`、`docs/OCR-VERIFICATION.md` 进包，所以已改成精确两项 `docs/DETAIL.md` + `docs/preview.svg`；`THIRD-PARTY-LICENSES.md` 已显式加入（`LICENSE` 由 npm 自动带）。npm 日只需应用 diff 中剩余的 `engines`/`publishConfig`/`description`/`exports` 项。
- **NPM 账号前置**：发布到 npm 需要（免费）账号 + 本机 `npm login`（可能要求 2FA 一次性密码）；unscoped 名字不需要 scope/用户名出现在包名里。首次发布即占用该名字。

### 改名步骤见 §2

改名（`package.json.name`、`cordis.patch.yml` 行名、`TAB_ID`、重建产物、本机 profile 替换 + 一次重启、无需数据迁移）统一在 §2 的发布前最后一步执行；npm 日只需在本节 diff 之上发布。

---

## 4. 哪些产物必须提交，哪些是生成物

GitHub-only 安装直接使用仓库里的文件，所以“提交构建产物”是**硬要求**：包内没有 `prepack`/`prepare`，安装方不会帮你构建。

| 路径 | 类别 | 处理 |
|---|---|---|
| `src/**`、`build.mjs`、`tsconfig.json`、`package.json`、`pnpm-lock.yaml`、`locale/*.json`、`cordis.patch.yml`、`icon.svg`、`docs/**`、`README.md`、`LICENSE`、`THIRD-PARTY-LICENSES.md` | 源码/元数据 | 必须提交 |
| `client.js`、`client.pdf.js`、`lib/host.js`、`lib/pdf.worker.mjs` | **构建产物（提交）** | 每次发布前 `pnpm build`，review diff 后提交；`.gitattributes` 已标记 generated |
| `.build/` | 生成物（忽略） | 不提交 |
| `node_modules/`、`.pnpm-store/`、`testdata/`、`*.log` | 本地/测试数据（忽略） | 不提交 |
| `*.tgz` | `pnpm pack` 产物 | 不提交（`.gitignore` 的 `*.tgz` 已忽略） |

发布前固定动作：

```powershell
pnpm install
pnpm typecheck
pnpm build
git status --short      # 只应看到预期改动；其它未跟踪文件（本地分析目录等）不要提交
git diff --stat -- client.js client.pdf.js lib/
```

---

## 5. 打包验证（可选：GitHub Release 资产）

本轮**不需要** npm tarball 才能安装；GitHub tag 本身即可安装。若仍想在 Release 里附一个 tarball 供人下载：

- **实测现状（2026-11-14，`files` 精确化后）**：`pnpm pack --dry-run` 输出 **21** 个文件（`client.js`、`client.pdf.js`、`cordis.patch.yml`、`docs/DETAIL.md`、`docs/preview.svg`、`icon.svg`、`lib/host.js`、`lib/ocr/engine.cjs`、`lib/ocr/engine-impl.cjs`、`lib/ocr/worker.cjs`、`lib/ocr/tesseract-core-lstm.wasm`、`lib/ocr/tesseract-core-simd-lstm.wasm`、`lib/ocr/lang/eng.traineddata.gz`、`lib/ocr/lang/chi_sim.traineddata.gz`、`lib/pdf.worker.mjs`、`LICENSE`、`locale/en.json`、`locale/zh.json`、`package.json`、`README.md`、`THIRD-PARTY-LICENSES.md`）；tarball 名 `dsh-paper-reader-0.1.0.tgz`（实测 **8,227,726 B ≈ 7.85 MiB**，`tar -tzf` 数得 21 个 entry）。
- **功能轮后复核（2026-11-15）**：`pnpm pack --dry-run` **仍为 21 个文件**。批注导出新增的 `pdf-lib` 及其传递依赖（`@pdf-lib/standard-fonts`、`@pdf-lib/upng`、`pako`、`tslib`）只是构建期 `devDependencies`，由 `build.mjs` 打进懒加载的 `client.pdf.js`，**没有新增任何 tarball 文件**；`THIRD-PARTY-LICENSES.md` 已补这 5 个组件（§14–§18）。当前产物体积：`client.pdf.js` 2,197,097 B、`client.js` 55,292 B、`lib/host.js` 1,062,122 B、`lib/pdf.worker.mjs` 2,395,538 B，`lib/ocr/**` 11,282,058 B；`v0.2.0` 实测：`pnpm pack` 产物 **`dsh-paper-reader-0.2.0.tgz`**，**8,438,501 B ≈ 8.05 MiB**，`tar -tzf` 数得 **21** 个 entry。
- **`files` 已精确化**（2026-11-14 的打包修正 commit）：`"docs"` → `"docs/DETAIL.md"` + `"docs/preview.svg"`，并显式加入 `"THIRD-PARTY-LICENSES.md"`。因此内部发布文档（`docs/PUBLISHING.md`、`docs/README.draft.md`、`docs/OCR-VERIFICATION.md`）**不再进包**，而 `THIRD-PARTY-LICENSES.md` **会**进包（`LICENSE` 仍由 npm 按惯例自动带）。包内**没有** `src/**`、`.github/**`、`scripts/**`、`market/**`、`.build/**`、`build.mjs`、`tsconfig.json`、lockfile、`testdata/**`。
- **`files` 里的 `"client.*.js"` 是宽通配**：它目前只匹配 `client.pdf.js`（`client.js` 由前面的精确项覆盖）；将来若新增 `client.<name>.js`，会被**无提示**一并打进包。这是有意保留的便利，风险可接受；新增客户端产物时要复核 `pnpm pack --dry-run` 清单。
- **tarball 里的 `scripts` 是“有脚本、无源码”**：`package.json` 仍带 `scripts.build`（`node build.mjs`）与 `scripts.typecheck`（`tsc -p tsconfig.json`），但 `files` 不含 `src/**`、`build.mjs`、`tsconfig.json` 和 devDependencies；从 tarball 安装后这两个脚本无法运行。它们只在 git 安装 / 源码仓里有意义（这也是保留二者、不把脚本移出 `package.json` 的原因）。
- **仍留在仓库、但不进包**：`docs/OCR-VERIFICATION.md`、`docs/PUBLISHING.md`、`docs/README.draft.md` 仍是仓库文件，GitHub 源码归档会包含它们。**已决定保留在公开仓库**（理由与要求见 §15.1）。
- **对 GitHub-only 的影响**：tarball 现在既含 `THIRD-PARTY-LICENSES.md`（许可证合规）又不含内部文档，**可以直接作为 Release 资产**；GitHub 自动生成的源码归档（`tar.gz`/`zip`，含仓库全部 tracked 文件）同样可用。
- npm 发布日目标清单：与上面的实测清单完全一致（21 项；`lib/ocr/**` 为 7 个文件：`engine.cjs`/`engine-impl.cjs`/`worker.cjs` + 2 个 WASM core + 2 个语言包）。`files` 已是最终形态，npm 日只需叠加 §3 diff 里剩余的 `engines`/`publishConfig`/`description`/`exports` 项。
- 体积（v0.1.0 实测，`files` 精确化后）：`client.pdf.js` 1,735,431 B + `lib/pdf.worker.mjs` 2,395,538 B + `lib/host.js` 1,058,698 B + `client.js` 32,407 B ≈ 5.0 MiB（未压缩）；`lib/ocr/**` 另 11,281,627 B ≈ 10.8 MiB；tarball 实测 8,227,726 B ≈ 7.85 MiB。
- 如要检查真实 tarball（会写文件）：`pnpm pack` 后 `tar -tzf dsh-paper-reader-0.2.0.tgz`，检查完删除、不要提交（`*.tgz` 已被 `.gitignore` 忽略，仍不要提交）。

---

## 6. 用户如何安装

### 6.1 直接安装（本轮主路径）

包名/loader id 是 `dsh-paper-reader`（来自 `package.json.name`），GitHub 仓库是 `beiwei91/dsh-paper-reader`。推荐固定 40 位 commit（只有完整 commit 固定的 git 依赖才可能被 `plugin_manager` 视为可更新安装）：

```powershell
# <40-hex commit> 来自：git rev-list -n1 v0.1.0
dsh plugin --profile <profile> add 'git+https://github.com/beiwei91/dsh-paper-reader.git#<40-hex commit>'
```

tag 形式（可以安装，但 tag/branch spec 不参与自动更新）：

```powershell
dsh plugin --profile <profile> add 'github:beiwei91/dsh-paper-reader#v0.1.0'
```

- 建议用引号包住 spec：PowerShell 里 `#` 可能被当成注释起始。
- 安装会先 `git ls-remote` 探测仓库（需要本机 `git` 与 GitHub 网络）；随后 pnpm 克隆该 commit/tag。
- 仓库里已提交构建产物，**不需要**本地构建，也没有生命周期脚本需要审批。
- 让 agent 安装时，`plugin_manager` 的 `install_bundle` target 填同一个 spec。
- Desktop 的 `desktop` profile 由 Desktop shell 管理：用 Desktop Plugins 设置或 agent 的 `plugin_manager`（Desktop UI 里“手动输入 git spec”的具体入口**未验证**）。

### 6.2 GitHub Release 资产 tarball

```powershell
dsh plugin --profile <profile> add 'https://github.com/beiwei91/dsh-paper-reader/releases/download/v0.1.0/dsh-paper-reader-0.1.0.tgz'
```

- 安装目标是四类之一（npm 名、git URL、tarball URL、本地绝对目录），tarball URL 被支持。
- **注意**：pnpm 11.0–11.8 + hoisted linker（DSH profile 的默认布局）对裸 Release 资产 URL 不记录 integrity，可能报 `ERR_PNPM_MISSING_TARBALL_INTEGRITY`；11.9+ 可用。Desktop 捆绑的 pnpm 版本可能偏旧，因此 **tag/git 安装是更稳的首选**，tarball 作为备选。
- 也可安装 GitHub 自动生成的源码归档 URL（`https://github.com/beiwei91/dsh-paper-reader/archive/refs/tags/v0.1.0.tar.gz`）；同样受上面 pnpm 版本注意项影响（**未逐一实测**）。

### 6.3 本地目录（开发/未发布）

- DSH Web/Desktop：Plugins 设置里 **Add plugin / 添加本地目录**，选择仓库目录；或
- agent 调 `plugin_manager` 的 `install_bundle`，target 填仓库绝对路径。
- 本地目录是 link 安装：改完源码需重新构建并重新加载插件。

### 6.4 npm 包（未来可选，需要免费 npm 账号）

**当前不可用**：unscoped `dsh-paper-reader` 已被他人占用（rantz 1.5.0）。未来若要发 npm，需改用 scope 名（如 `@beiwei91/dsh-paper-reader`）或另选未占用名字（如 `paper-reader`），并把 `package.json.name` 与 `publishConfig.access` 一起改（§12）。

发布后的命令形如：

```powershell
dsh plugin --profile <profile> add '@beiwei91/dsh-paper-reader'
```

### 6.5 安装成功后的检查

重启/刷新 → Plugins 出现 `dsh-paper-reader` 行（标题「论文阅读器 / Paper Reader」+ 图标 + 详情页）→ 打开右侧栏，点引导页「论文阅读器」卡片打开「论文」标签。

---

## 7. 升级预期

### GitHub-only（本轮）

- **没有自动版本检测**：`plugin_manager` 只对 registry 依赖查新版本；git 依赖只有在以完整 40 位 commit 固定时才可能被索引/市场更新，而 **tag/branch/range 形式的 git spec 不可更新**（`plugin-manager/README.md`）。
- 升级方式 = 用新 tag 重装：
  ```powershell
  dsh plugin --profile <profile> add 'github:beiwei91/dsh-paper-reader#v0.2.0'
  ```
  对已安装的旧包（本机开发时的 `@local/dsh-paper-reader` link），重复 `add` 会替换依赖；替换已安装 bundle 需要重启才能加载新模块代（Client 可能 HMR 重载）。更稳妥：先移除、再安装、再重启。
- `engines.dsh`：本轮 `package.json` 没有声明（也没有 DSH peer 依赖），所以不产生版本约束；将来若声明，启动时仍会按 bundle manifest 校验（`app-boot` §Profiles），git/tarball 安装则在安装完成后判定并可能回滚。
- 数据：`$DSH_HOME/paper-reader/**` 跨版本保留；标注 JSON 没有 schema 版本字段，未来改格式要迁移或只清 `*.text.json` 缓存。
- 回滚：装回旧 tag 即可。

### npm（未来）

- registry 依赖可用 `listVersions`/`updateBundle` 更新，只有更新版本被接受；更新前校验 `engines.dsh`。

---

## 8. DSH manifest / 展示资源 checklist

本轮（GitHub 安装）不经过 npm `files`，检查项以“仓库文件齐全”为准：

- [ ] `dsh.bundle.patch` 指向 `./cordis.patch.yml`；**行 id 保持 `paper-reader`**；patch 里 `name` 与 `package.json.name` 一致（两者现在都是 `dsh-paper-reader`）。
- [ ] `dsh.client.platform = "web"`、`immediately: true`、`inject` 四项与实际运行时依赖一致。
- [ ] Client artifact 的 loader id == 包名（`client.js` 第 2 行已是 `dsh-paper-reader`）。
- [ ] `locale/zh.json`、`locale/en.json` 都有 `meta.title`、`meta.description`、`meta.detail = "docs/DETAIL.md"`。
- [ ] `docs/DETAIL.md` 恰好一行图片、相对路径 `preview.svg`、含替代文本。
- [ ] `docs/preview.svg` 自包含、640×300、无 `text`/`foreignObject`/脚本/外链；当前是**示意图不是截图**。
- [ ] `icon.svg`：SVG、≤256 KiB、包内路径、无外链。
- [ ] 仓库 tracked 文件包含全部运行时文件与 `lib/pdf.worker.mjs`、`THIRD-PARTY-LICENSES.md`、`LICENSE`。
- [ ] `engines.dsh`：**本轮不声明**（npm 发布日再加，见 §3）。
- [ ] `private` 已删除（GitHub 安装无影响；未来 npm 发布要求非 private，见 §3）；公开元数据 `license`/`repository`/`homepage`/`bugs`/`keywords` 已加入。

图标/详情页**实际渲染**未验证（本环境无浏览器控制）。发布前在运行中的 DSH 里打开一次「Plugins → 该 bundle」分别用中文/英文确认标题、描述、图片，并确认无 metadata diagnostic。

---

## 9. GitHub 仓库形态

- 仓库：**`https://github.com/beiwei91/dsh-paper-reader`**（已创建；命名对照见 §0.1）。
- 占位已填：README 草稿、PUBLISHING 中的仓库地址均为真实 URL；只剩 `.github/SECURITY.md` 的联系邮箱 `<OWNER>`（本次范围外，可选填也可改成 GitHub 私密报告）。Release notes 用真实仓库链接。
- 根目录：`README.md`、`LICENSE`、`THIRD-PARTY-LICENSES.md`、`SECURITY.md`、`docs/`、`.github/`。
- 标签：`v0.1.0`（注释 tag，与当时的 `package.json.version` 一致）**已发布、不再移动**；当前树的 `package.json.version` 已是 `0.2.0`，`v0.2.0` 在最终 release commit 上打 tag（§11.1）。
- Release：`v0.1.0` 已创建；`v0.2.0` 从 tag 创建，正文按 §11.1 的清单写本轮功能，并附 `dsh-paper-reader-0.2.0.tgz` 资产。
- 建议打开 GitHub 私密漏洞报告（Security → Advisories），与 `.github/SECURITY.md` 一致。
- CI（`.github/workflows/ci.yml`）只做 install/typecheck/build + 产物一致性检查，不代表 DSH 内可用。

---

## 10. 社区目录（GitHub-only 也能上）

### 10.1 已核实的事实

- **dshmarket 是市场客户端，不是目录**。上架要向 **`awesome-dsh-plugin/awesome-dsh-plugin`** 提 PR（一条 entry）；被收录后自动进入 dshmarket 与站点，并进入 npm 包 `dsh-plugin-catalog` 的 format-1 index（`https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json`）。dshmarket 1.73.19 README“Submit your plugin”。
- DSH 的 Discover/`plugin_market` 读用户配置的 format-1 index（`indexes`），默认没有公共目录；安装仍走 `pluginManager.installBundle`（`dsh-plugin-market/README.md`）。
- **format-1 index 完全支持 git-only 条目**（不需要 npm）：`parseMarketIndex` 校验 `format: 1`、localized title（含 `en`）、plugin `name`（合法 npm 包名；发布后的 `dsh-paper-reader` 合法）、`versions`（非空、精确 SemVer、降序、`publishTimestamp` 为 Unix 秒整数）、`source`：
  - npm：`{ "type": "npm", "registry"?: "https://…" }`
  - git：`{ "type": "git", "url": "https://github.com/beiwei91/dsh-paper-reader", "commit": "<40-hex>", "path"?: "<子目录>" }`；`url` 必须是 canonical https 仓库地址（≥2 段路径、无 query/fragment/凭据、不是 tarball），`commit` 为 40 位小写 sha；可选 `engines: { dsh: "<SemVer range>" }`（不能 `workspace:`）。
  - 安装目标由 `marketInstallTarget` 生成：`git+https://github.com/beiwei91/dsh-paper-reader.git#<commit>`（有 `path` 时加 `&path:/<dir>`）。
- awesome 目录的 `RegistryPlugin.install` 是**推导出来的 pnpm spec**：有 `npm` 字段 → npm 名；否则有 `tarball` → 该 Release tarball URL；否则 → `github:<owner>/<repo>`（monorepo 加 `#path:/<sub>`）（`dshmarket/lib/sources.js` `installTargetFor`；字段见 `lib/types/registry.d.ts`）。
- awesome 目录明确支持 GitHub-only 条目（读仓库里的 manifest，含 monorepo 子目录）——`dshmarket/README.md`“What you get”。
- **UNVERIFIED**：awesome 仓库实际要改的文件/条目模板/PR 检查项/收录标准；本机 `raw.githubusercontent.com` 不可达（`web_fetch` 失败），本地也没有该仓库 README。上面的字段结构来自已安装 dshmarket 的**读取端**实现。
- 未验证：Desktop UI 中按 spec 手动安装的入口名称。

### 10.2 上架建议（GitHub-only）

- 先发 GitHub Release（§11），拿到 tag 对应的 **40 位 commit**；再向 awesome 目录提 git-only entry（`url` 指仓库，`commit` 指该 tag 的 commit）。
- 也可以自己托管一份 format-1 `index.json`，让用户把 URL 加到 Discover 的 Index sources。
- 包名已在 §2 改为 `dsh-paper-reader`，因此 awesome 条目的 `name` 用 `dsh-paper-reader`（与安装后的包名一致）；`@local/dsh-paper-reader` 只是改名前的本地历史名。
- 条目文件、自托管 format-1 index 示例与逐步人工步骤见 §16；PR 用的 entry 已放在 `market/beiwei91__dsh-paper-reader.yml`。

---

## 11. 发布路径 A：GitHub-only（本轮采用）

**目标**：不注册 npm，用户从 GitHub tag / Release 安装。

### 11.1 Release 长什么样

- 仓库 `beiwei91/dsh-paper-reader`，默认分支最新 commit 已包含：源码、`build.mjs`、`locale`、`docs`、`icon.svg`、`cordis.patch.yml`、`README.md`、`LICENSE`、`THIRD-PARTY-LICENSES.md`，以及**已构建的** `client.js`、`client.pdf.js`、`lib/host.js`、`lib/pdf.worker.mjs`；`package.json.version` 与 tag 都是 `0.2.0`（包名与 loader id 都是 `dsh-paper-reader`）。
- tag `v0.2.0`（注释 tag，与 `package.json.version` 一致，打在最终 release commit 上）。
- GitHub Release `v0.2.0`：从该 tag 创建，正文含变更说明 + 安装命令；**附上 Release 资产 `dsh-paper-reader-0.2.0.tgz`**（`pnpm pack` 生成，21 个文件，见 §5）。
- CI 可选：`.github/workflows/ci.yml` 只保证 install/typecheck/build 与产物一致。

**发布步骤（2026-11-15；tree 已在 `0.2.0`）**：`v0.1.0` 已发布（commit `e87e4bc`），tag 不移动、不重打；`v0.2.0` 按以下顺序执行：

1. **确认最终 commit**：`git status --short` 干净；`package.json.version` = `0.2.0`；构建产物已重建并提交（§4）；`pnpm pack --dry-run` 仍是 21 个文件（§5）。
2. **打 tag**：在最终 release commit 上执行 `git tag -a v0.2.0 -m "dsh-paper-reader v0.2.0 (GitHub-only)"`。
3. **推送**：`git push origin HEAD`，再 `git push origin v0.2.0`（分支与 tag 一起推送）。`v0.1.0` 的 tag/Release 原样保留。
4. **创建 Release**：在 GitHub 上以 tag `v0.2.0` 创建 Release，正文按下文清单写，并上传资产 `dsh-paper-reader-0.2.0.tgz`。
5. **上架 PR**：仓库创建满 24 小时（≥24h）后，把已同步到 0.2.0 功能集的 `market/beiwei91__dsh-paper-reader.yml` 复制为 awesome 仓库的 `data/plugins/beiwei91__dsh-paper-reader.yml` 并提 PR（§16.1）；可选自托管 `market/index.json`（模板，替换 `commit` 占位符后发布，§16.2）。

**`v0.2.0` release-notes 内容清单**：

- [ ] 用户可读变更：Ctrl/Cmd + 滚轮缩放（光标锚定，25%–400%）、高倍缩放下的横向滚动、最近打开列表（最多 12 条，重开 + 悬停 × 移除）、八色标注、下划线工具、文本框（页面比例锚定、Esc/失焦提交、空内容删除、不可拖动）、有边注标注的页边距徽标、笔记列表按类型标注并跳到标注本身、工具栏「摘要 / Digest」、工具栏「导出 / Export」生成 `<name>.annotated.pdf`。
- [ ] 导出限制要写清：边注正文不写入 PDF、原文件不改、加密 PDF 拒绝、文本层定位不到的引文会被跳过、导出是单向的（不能导回插件）。
- [ ] 兼容性：旧标注数据没有 `kind` 字段时按 `highlight` 自动读取，无需迁移；`$DSH_HOME/paper-reader/**` 与旧版数据兼容。
- [ ] 安装命令：Release 正文用 §11.2 的原文，把 `v0.1.0` 全部换成 `v0.2.0`（commit 用 `git rev-list -n1 v0.2.0`）。
- [ ] 许可证与打包：`THIRD-PARTY-LICENSES.md` 已含 pdf-lib 栈（§14–§18），`pnpm pack --dry-run` 仍为 **21 文件**（§5）。

### 11.2 用户安装命令（本轮发放给用户的原文）

```powershell
# 推荐：固定 v0.1.0 的 40 位 commit（git rev-list -n1 v0.1.0）
dsh plugin --profile <profile> add 'git+https://github.com/beiwei91/dsh-paper-reader.git#<40-hex commit>'

# tag 形式（可安装；tag/branch spec 不参与自动更新）
dsh plugin --profile <profile> add 'github:beiwei91/dsh-paper-reader#v0.1.0'
```

或让 agent 执行：`plugin_manager` → `install_bundle`，target 填 `git+https://github.com/beiwei91/dsh-paper-reader.git#<40-hex commit>`（或 tag 形式）。

包名/loader id 与 GitHub 仓库同名（`dsh-paper-reader`）。

Release 资产 tarball（备选，注意 pnpm 版本）：

```powershell
dsh plugin --profile <profile> add 'https://github.com/beiwei91/dsh-paper-reader/releases/download/v0.1.0/dsh-paper-reader-0.1.0.tgz'
```

> 发布 `v0.2.0` 时把本节与 §6 里的 `v0.1.0` 全部换成 `v0.2.0`（commit 用 `git rev-list -n1 v0.2.0`）；`v0.1.0` 的 tag/Release 原样保留，不重打、不移动。

安装后核对：Plugins 出现 `dsh-paper-reader` 行、右栏「论文」标签、四个 `paper_*` 工具。

### 11.3 GitHub-only 会失去什么

| 失去 | 说明 |
|---|---|
| 自动版本检测 / 一键更新 | `plugin_manager` 的版本列表只查 registry；git 依赖只有“完整 40 位 commit 固定”时才可能被索引/市场更新；**tag/branch/range 形式的 git spec 不可更新**，升级只能重装新 tag（§7）。 |
| npm 生态统计/排序 | 社区目录里的 npm 下载量、npm 版本字段等不适用（dshmarket README “Data source”）。 |
| 安装便捷性 | 需要本机 `git` 与 GitHub 可达（`git ls-remote` 预检查；网络失败会中止，`failedAt: 'spec-host'`）。GitHub 在中国大陆网络可能不稳；Release tarball 可作备选但有 pnpm 版本注意项（§6.2）。 |
| 供应链信号 | 没有 npm provenance/签名，信任锚是 GitHub 仓库与 tag。 |
| 目录覆盖率 | 多数社区目录以 npm 包名为主键；git-only 条目可上（§10），但 discoverability/统计不如 npm。 |
| 包名观感 | 本地开发阶段曾是 `@local/dsh-paper-reader`；发布前已按 §2 改为 `dsh-paper-reader`，与仓库同名（产物已重建）。 |

**仍然保留**：功能完全一致；`engines.dsh` 若声明仍会在 profile 启动时校验（git/tarball 安装则在安装完成后判定并可能回滚）；数据目录与升级兼容规则不变；bundles 的启用/禁用/移除行为不变。

---

## 12. 发布路径 B：npm（未来可选，需要免费 npm 账号）

仅当用户以后想获得 registry 的版本发现/更新能力时执行。

**前置**：免费 npm 账号；本机 `npm login`（可能要求 2FA 一次性密码）。**unscoped `dsh-paper-reader` 已被占用，不能直接发布**；必须改用 scope 名（如 `@beiwei91/dsh-paper-reader`，免费账号首次 publish 即创建该 scope）或另选未占用名字（如 `paper-reader`），并把 `package.json.name` 改成最终名字、保留 `publishConfig.access=public`。

步骤：

1. **发布日决定名字**：用 `pnpm view <候选名> version --registry https://registry.npmjs.org/` 确认 404（scope 名只需确认没有同名版本）；`dsh-paper-reader` 已被占用，不要用它发布。
2. 应用 §3 的 npm 元数据 diff，并把 `name` 改为最终 npm 名（`@beiwei91/dsh-paper-reader` 或另选的 free 名）；改名连带步骤已在 §2 完成。
3. `pnpm install && pnpm typecheck && pnpm build`；`pnpm pack --dry-run` 核对 §5 的打包清单。
4. `npm login`；`npm publish --dry-run`（只打包校验）；`pnpm publish --access public`。
5. 发布后：`pnpm view <最终名>@0.1.0 dist.tarball`；在干净 profile 上 `dsh plugin --profile web add <最终名>@0.1.0` 验证。
6. 用户安装：`dsh plugin --profile <profile> add <最终名>`；之后可用 `plugin_manager` 的 `listVersions`/`updateBundle` 更新。

---

## 13. 发布命令序列（本轮 GitHub-only；npm 段落不在本轮执行）

> 本节是 `v0.1.0` 首发时实际执行的命令记录（历史，保留备查）。`v0.2.0` 的发布步骤见 §11.1：tag 打在最终 release commit 上，**不重打、不移动 `v0.1.0`**。

```powershell
# 0）GitHub 仓库已就绪（beiwei91/dsh-paper-reader）；用 docs/README.draft.md 覆盖 README.md
# 1）发布前最后一步：按 §2 改名（package.json name / cordis.patch.yml / TAB_ID → dsh-paper-reader）—— 已完成
#    产物已用 node build.mjs 重建（loader id 必须等于包名）

# 2）构建与本地校验
pnpm install
pnpm typecheck
pnpm build
git status --short         # 不要提交其它未跟踪文件（本地分析目录等）
git diff --stat -- client.js client.pdf.js lib/
# 确认 client.js 第 2 行 id 已是 dsh-paper-reader
pnpm pack --dry-run        # 可选：检查 Release 资产内容（见 §5 注意事项）

# 3）提交发布内容（显式路径，避免带上别人的改动）
git add README.md LICENSE THIRD-PARTY-LICENSES.md docs .github .gitattributes
git add src build.mjs package.json pnpm-lock.yaml locale cordis.patch.yml icon.svg client.js client.pdf.js lib
git commit -m "chore: rename to dsh-paper-reader and release v0.1.0"
git tag -a v0.1.0 -m "dsh-paper-reader v0.1.0 (GitHub-only)"

# 4）创建 GitHub 仓库并推送（owner 手工操作）
git remote add origin https://github.com/beiwei91/dsh-paper-reader.git
git push -u origin HEAD
git push origin v0.1.0

# 5）GitHub 上创建 Release v0.1.0
#    正文：变更 + 安装命令（见 §11.2）；资产可选（§5）

# 6）发布后：更新本机 profile（§2 第 6 步）—— 移除旧 @local 行、安装 dsh-paper-reader、重启一次 DSH
# 7）干净 profile 验证：dsh plugin --profile web add 'github:beiwei91/dsh-paper-reader#v0.1.0'

# —— 以下仅未来 npm 发布日执行 ——
# npm login
# 注意：npm 上 dsh-paper-reader 已被占用；npm 发布需改用 scope 名（如 @beiwei91/dsh-paper-reader）或另选 free 名
# npm publish --dry-run
# pnpm publish --access public
```

---

## 14. 发布前必须做的运行时验证

1. **GitHub tag 安装**：干净 profile（或临时 profile）里执行 §11.2 的 tag 命令；确认 `plugin_manager` 返回 applied（或提示重启后生效），启动不 skipped，`git ls-remote` 预检查通过。
2. **bundle 行**：Plugins 只出现一行 `dsh-paper-reader`，无 metadata diagnostic。
3. **详情页与图标**：中/英文各打开一次，图片加载、无 README 回退、390 px 宽无横向溢出。
4. **功能走查**：本地 PDF 拖拽、绝对路径、arXiv 打开、关键词搜索；最近打开列表（重开、Host 缺字节时回读原路径、悬停 × 移除）；目录/搜索/笔记/缩放；Ctrl/Cmd + 滚轮缩放（光标锚定）与高倍缩放横向滚动；八色高亮、下划线、文本框、有边注标注的页边距徽标、笔记列表按类型跳转；摘要提示词写入输入框（不自动发送）；导出 `.annotated.pdf`（高亮/下划线/文本框、旋转页、原文件不变、边注不写入）；引用/解释/翻译；切右栏标签再切回（论文应恢复）；`paper_info/paper_outline/paper_read/paper_search` 各调一次。
5. **升级演练**：装 tag 后模拟升级（改一个 tag 或重装），确认数据与工具不丢；替换包后重启一次再验证。
6. **卸载**：移除 bundle 后 Plugins 行消失、右栏标签不再出现、`$DSH_HOME/paper-reader` 数据保留（无自动清理）。

无浏览器控制时不能声称“界面没问题”；把未验证项如实写进发布说明。

---

## 15. 仍需人工决定的事

1. **GitHub 仓库人工步骤**：给 repo 加 `dsh-plugin` topic、仓库满 1 天、打 tag/Release、fork + PR 到 awesome-dsh-plugin（§16）；GitHub 用户名已确定为 `beiwei91`。
2. **运行时验证**（§14）是否已完成。
3. **Release 资产策略**（§5）：只发 tag（推荐）、源码归档，还是附 `pnpm pack` tarball（`files` 已精确化，tarball 已含 `THIRD-PARTY-LICENSES.md` 且不含内部文档，可直接用）。
4. **图标/示意图授权**：确认 `icon.svg`、`docs/preview.svg` 可再分发。
5. **版权署名**：`LICENSE` 当前写 “dsh-paper-reader contributors”；是否换成个人/组织名。
6. **社区上架**：是否向 awesome-dsh-plugin 提 git-only entry、是否自建 format-1 index（§10）。
7. **未来 npm**：是否注册免费账号走 §12；若做，发布日决定最终 npm 名（scoped `@beiwei91/dsh-paper-reader` 或另选 free 名）——unscoped `dsh-paper-reader` 已被占用。
8. **内部文档是否移出仓库**：**已决定保留**（见 §15.1）。

### 15.1 内部文档保留决定（2026-11-14）

决定：**`docs/PUBLISHING.md`、`docs/README.draft.md`、`docs/OCR-VERIFICATION.md` 继续保留在公开仓库中**，不移出、不删除。理由：三者都是维护者文档——`PUBLISHING.md` 是发布清单，`OCR-VERIFICATION.md` 记录 OCR 的设计、复现命令与实测数据，`README.draft.md` 是 README 的编辑底稿；源码归档本来就是给愿意读构建/发布细节的人看的，公开它们比让发布流程只存在于作者本机更透明。前提与要求：这些文档**不得包含任何密钥、凭据、本机绝对路径、用户名或私人邮箱**（2026-11-14 已做一轮清理，通用占位用 `<repo>`、`$DSH_HOME`、`<profile>` 等）；它们已不随 npm 包 / Release tarball 分发，所以普通用户看不到；若将来某篇文档开始包含敏感运营信息，再单独移出仓库。

---

## 16. 上架插件市场（marketplace listing）

### 16.0 结论：DSH 没有中心市场

- **DSH 本体不带中心市场**。“市场”= 社区目录 + 用户自行添加的 format-1 JSON index；安装始终走 `pluginManager.installBundle`。
- 事实上的社区目录是 **[awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)**：站点与 `dshmarket` 拉取 `https://awesome-dsh-plugin.com/plugins.json`（每日刷新；已安装 dshmarket 1.73.19 README 证实）。DSH 自带 Discover 则只读用户配置的 index URL（`@deepseek-ai/dsh-plugin-market` 的 `indexes`）。
- **没有上传表单**：上架 = 向该仓库提一个 **PR，新增恰好一个 YAML**，路径 `data/plugins/<owner>__<repo>.yml`（我们：`data/plugins/beiwei91__dsh-paper-reader.yml`）。
- 第三方插件发布说明提到的 CI 门槛（**UNVERIFIED**，本机无法访问 GitHub 核对）：`package.json` 必须声明 `dsh.bundle`（我们已声明）；仓库需 ≥1 天；GitHub 仓库需 `dsh-plugin` topic；`category` 来自固定列表；描述需与代码一致、避免营销语言；可选 `screenshots.json`（1–8 个 repo 相对路径）与 icon。
- **我们已交付**：PR 用条目 `market/beiwei91__dsh-paper-reader.yml`、自托管 index 示例 `market/index.json`（见 §16.2），以及 §13 的 release checklist。`screenshots.json` 需真实截图，可选、未提供。

### 16.1 推荐条目（复制进 PR）

文件：`market/beiwei91__dsh-paper-reader.yml`。字段取自已安装 `dshmarket@1.73.19` 的运行时目录类型（`Registry` / `RegistryPlugin`：`name`/`owner`/`url`/`category`/`description`/`install`/`added`，可选 `tarball`/`icon`）；`screenshots` 是 awesome 仓库单独的 `screenshots.json`（**UNVERIFIED** 格式），不在本 YAML 内。

- 目标路径（**UNVERIFIED**）：awesome 仓库的 `data/plugins/beiwei91__dsh-paper-reader.yml`；提 PR 前按该仓库的 `CONTRIBUTING`/CI 核对路径、文件名与字段（本机未访问 GitHub 核对，2026-11-14 起草时的假设）。
- `market/` 里的 YAML 保持**无注释、可直接复制粘贴**，未验证事项只记录在本节，不写回文件。
- `added` 填条目实际加入目录的日期（文件里的 `2026-11-14` 是起草日期，PR 时按当天或维护者要求填写）。
- 第三方插件发布说明提到的其它 CI 门槛（**UNVERIFIED**）：`package.json` 必须声明 `dsh.bundle`（已声明）；仓库需 ≥1 天；GitHub 仓库需 `dsh-plugin` topic；描述需与代码一致、避免营销语言。

```yaml
name: dsh-paper-reader
owner: beiwei91
url: https://github.com/beiwei91/dsh-paper-reader
description:
  en: Paper Reader adds a Papers tab to the DSH right sidebar: read local PDFs and arXiv papers with continuous scrolling, outline jumps, in-document search, a remembered position, Ctrl/Cmd + wheel zoom and a recent-papers list; annotate with eight highlight colours, underlines, text boxes and margin notes; generate a structured digest prompt; export the annotations onto a copy of the PDF as <name>.annotated.pdf; OCR text on scanned pages so in-document search and the read-only paper_* agent tools can read it; quote a selection into the conversation or ask the agent to explain/translate it. Four read-only paper_info / paper_outline / paper_read / paper_search tools read the paper open in the session.
  zh: 论文阅读器：在 DSH 右侧栏新增「论文」标签页，读本地 PDF 与 arXiv 论文（连续滚动、目录跳转、全文搜索、记忆位置、Ctrl/Cmd + 滚轮缩放、最近打开列表）；八色高亮、下划线、文本框与边注按论文保存；一键生成结构化摘要提示词；把批注导出为 PDF 副本（<name>.annotated.pdf）；扫描页可做文本级 OCR，使页内搜索与只读 paper_* 工具同样可读；选中原文可引用到对话、让 agent 解释/翻译；四个只读 paper_info / paper_outline / paper_read / paper_search 工具读取当前会话打开的论文。
install: "github:beiwei91/dsh-paper-reader"
added: "2026-11-14"
icon: https://raw.githubusercontent.com/beiwei91/dsh-paper-reader/v0.1.0/icon.svg
category: productivity   # UNVERIFIED enum：PR 前换成 awesome 仓库允许的、最接近的 category id
```

> 注：上面的描述与仓库里的 `market/beiwei91__dsh-paper-reader.yml` 已按 `v0.2.0` 功能集同步（2026-11-15：八色标注、下划线、文本框、边注徽标、摘要提示词、批注导出、最近打开、Ctrl/Cmd + 滚轮缩放、扫描页 OCR）；`market/index.json` 是同一功能集的模板，`commit` 仍为故意明显的占位符。提 PR / 自托管前按本段与 awesome 仓库的 CI/分类要求核对。

- **`category` 枚举未验证**：本机没有目录枚举（`registry.d.ts` 只把 `category` 当 `string | string[]`，catalog 的 categories 表在远端）。`productivity` 只是占位，提 PR 前按 awesome 仓库的 category 列表选最接近的（阅读/效率/工具类）。
- **`install` 的语义**：dshmarket 实际从 `url`/`npm`/`tarball` 推导安装目标（无 npm/tarball 时 → `github:beiwei91/dsh-paper-reader`，见 §1 表格最后几行）；本字段用同一推导值。要 tag 固定可改用 `git+https://github.com/beiwei91/dsh-paper-reader.git#v0.1.0`。若 CI 对 `install` 有额外格式要求，以 CI 为准。
- **screenshots（可选）**：awesome 仓库支持可选的 `screenshots.json`（1–8 个 repo 相对路径，UNVERIFIED 格式）。真实截图需要人工补；别把 `docs/preview.svg` 当成截图提交（它是示意图）。

### 16.2 自托管 format-1 index（不依赖 awesome 收录）

文件：`market/index.json`。这是一个**模板（TEMPLATE）**，不是可直接服务的索引：JSON 有效，但 `commit` 是**显而易见的占位符**（`"<40-hex commit of this repo, e.g. git rev-list -n1 v0.2.0>"`），`_note` 与 `title` 也标注了 TEMPLATE。format-1 解析器（`@deepseek-ai/dsh-plugin-market-index` 的 `parseMarketIndex`；未知字段被忽略）要求 40 位小写 hex，因此模板**故意**通不过校验，避免被当成真实索引误用；替换 `commit` 与 `publishTimestamp` 后再校验/发布。

```json
{
  "format": 1,
  "title": { "en": "Paper Reader plugin index (TEMPLATE — replace the commit placeholder)", "zh": "论文阅读器插件索引（模板 — 请替换 commit 占位符）" },
  "plugins": [{
    "name": "dsh-paper-reader",
    "title": { "en": "Paper Reader", "zh": "论文阅读器" },
    "description": { "en": "PDF/arXiv paper reading for the DSH right sidebar.", "zh": "在 DSH 右侧栏读 PDF/arXiv 论文。" },
    "author": "beiwei91",
    "homepage": "https://github.com/beiwei91/dsh-paper-reader",
    "repository": { "url": "https://github.com/beiwei91/dsh-paper-reader" },
    "versions": [{
      "version": "0.2.0",
      "publishTimestamp": 1794662000,
      "source": {
        "type": "git",
        "url": "https://github.com/beiwei91/dsh-paper-reader",
        "commit": "<40-hex commit of this repo, e.g. git rev-list -n1 v0.2.0>"
      }
    }]
  }]
}
```

- 发布前把 `commit` 换成 `v0.2.0` 的 40 位 commit（`git rev-list -n1 v0.2.0`）、`publishTimestamp` 换成实际 Unix 秒（模板里的 `1794662000` 只是占位数值）；`engines.dsh` 可选（本轮未声明，可省略）。
- 发布到仓库后，用户消费步骤：
  1. 启用 DSH 随装的可选 custom-index bundle：`@deepseek-ai/dsh-experimental-plugin-market-bundle`（shipped profiles 默认不启用；用 `plugin_manager`/profile bundles 启用；具体入口以当前 UI 为准）。
  2. **Plugins → Discover → Add index source**，填入 index 的 URL，例如 `https://raw.githubusercontent.com/beiwei91/dsh-paper-reader/v0.2.0/market/index.json`（或 jsDelivr 镜像）。
  3. 在 Discover 里搜索/打开 `dsh-paper-reader` 并安装（安装仍走 `installBundle`）。
- **UNVERIFIED**：上面两步的精确 UI 文案与“是否默认禁用”来自 `@deepseek-ai/dsh-plugin-market` README（“shipped profiles leave the bundle off”）；`Add index source` 的入口名未在运行中的 UI 里实测。

### 16.3 直接安装仍然是第一优先

不想等目录收录时，直接安装（§6.1 / §11.2）：

```powershell
dsh plugin --profile <profile> add 'git+https://github.com/beiwei91/dsh-paper-reader.git#<40-hex commit>'
# 或 tag 形式（不参与自动更新）
dsh plugin --profile <profile> add 'github:beiwei91/dsh-paper-reader#v0.1.0'
```

agent 用 `plugin_manager` → `install_bundle`，target 填同一 spec。

### 16.4 只有用户能做的步骤 vs 我们交付的

| 谁 | 步骤 |
|---|---|
| **用户** | 给 `beiwei91/dsh-paper-reader` 加 GitHub topic **`dsh-plugin`**；确保仓库满 1 天；（§2 改名 + 重建已完成）打 tag `v0.2.0` 并创建 Release（§11.1）；fork `awesome-dsh-plugin/awesome-dsh-plugin`，把 `market/beiwei91__dsh-paper-reader.yml` 复制为 `data/plugins/beiwei91__dsh-paper-reader.yml` 并提 PR（按该仓库 CI/分类要求调整 `category` 和格式）；可选：补真实截图 `screenshots.json`；可选：自托管 `market/index.json`（模板，替换 `commit` 占位符后发布）。 |
| **我们（已交付）** | `market/beiwei91__dsh-paper-reader.yml`（PR 条目，无内部注释）、`market/index.json`（format-1 自托管**模板**，`commit` 为故意明显的占位符，未作为真实索引交付）、`docs/PUBLISHING.md` 的 release checklist（§2、§11、§13）；市场条目的未验证事项集中在 §16.1/§16.2。 |
| **共同** | §14 运行时验证；未来 npm 发布日决定最终 npm 名（`dsh-paper-reader` 已被占用，需 scope 或 free 名）。 |

## 17. 本次核对用到的证据

- `pnpm pack --dry-run`（核对时为 15 文件；改名 + OCR 后为 23 文件，内部 docs 会进包、`THIRD-PARTY-LICENSES.md` 未进包；`files` 精确化后为 **21 文件**，内部 docs 已不进包、`THIRD-PARTY-LICENSES.md` 已进包，真实 tarball 8,227,726 B ≈ 7.85 MiB——见 §5）。2026-11-14 的成品 API 清理（README 重写 + 文档去本机路径）后复核仍为 **21 文件**：README 内容变化不改变打包清单。
- 2026-11-15 功能轮后的文档同步复核：`pnpm pack --dry-run --json` 的 `files` 数仍为 **21**（`pdf-lib` 栈打进 `client.pdf.js`，不新增包内文件）；旧英文过时断言（四色、无导入导出等）grep 无结果；`git diff --stat` 只涉及 `README.md`、`docs/README.draft.md`、`docs/PUBLISHING.md`。
- `pnpm typecheck`（通过）；成品清理未改 `src/**`，`node build.mjs` 无需重跑。
- `pnpm view dsh-paper-reader --json --registry https://registry.npmjs.org/`（**已被占用**，v1.5.0，另一项目 rantz）。
- `pnpm view paper-reader version --registry https://registry.npmjs.org/` → 404（2026-11-14；仅作未来 npm 备选名记录，本轮不使用）。
- `pnpm view dsh-papers / dsh-pdf-reader / dsh-paper-tab / dsh-sidebar-paper-reader version`（404 未采用 / 0.2.0 已占 / 404 / 404）。
- `git status`、`git remote -v`（无远端）、`git log`。
- GitHub 仓库已创建：`https://github.com/beiwei91/dsh-paper-reader`（用户提供；本机未 `git remote add`）。
- `market/beiwei91__dsh-paper-reader.yml` 用 js-yaml 解析通过（`name`/`owner`/`url`/`category`/`description`/`install`/`added` 齐全）。
- `market/index.json` 按 `parseMarketIndex` 规则人工校验：`format=1`、`title.en`、合法包名、精确 SemVer、`publishTimestamp` 整数、git source `url` 为 canonical https 且 `commit` 为 40 位小写 hex。
- 已读源码：`src/client/**`、`src/host/**`、`locale/*.json`、`cordis.patch.yml`、`build.mjs`、`package.json`、`.gitignore`、`.npmrc`、`pnpm-workspace.yaml`、`README.md`、`docs/DETAIL.md`、`docs/preview.svg`、`icon.svg`；`node_modules/pdfjs-dist/package.json` + `LICENSE`（生成 `THIRD-PARTY-LICENSES.md` 时逐字复制，177 行）。
- 已读 DSH 文档：见 §1 表格（本机 `@deepseek-ai/dsh@0.2.2-rc.3` 安装内文档）。
- 已读 profile 状态：`$DSH_HOME/profiles/<profile>/package.json`（含 `link:<repo>`）、`cordis.patch.yml`、`node_modules/@local/dsh-paper-reader` junction；`dshmarket@1.73.19` 的 README、`lib/types/registry.d.ts`、`lib/sources.js`、`lib/types/sources.d.ts`；`.dsh-market/` 只读缓存。
