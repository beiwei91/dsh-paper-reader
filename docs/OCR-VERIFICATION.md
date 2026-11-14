# 扫描版 PDF 的文本级 OCR：设计与验证

扫描页没有文本层，`paper_read` / `paper_search` 和页内搜索此前看不到任何内容。本插件现在做**文本级 OCR**：扫描页在阅读器里被识别一次，文本写进 Host 的逐页文本缓存，于是 agent 工具、页内搜索、翻译都能用。OCR 页**不建文本层**，因此不支持在扫描页上选中/高亮。

- 结论：Host 侧 tesseract.js，Client 侧栅格化；离线、零运行时 npm 依赖（资源已 vendored 到 `lib/ocr/`）。
- 复现命令、资源体积、实测耗时见下；浏览器侧行为见「无浏览器不可验证项」。

## 架构

1. 客户端在阅读器空闲时（滚动停止 700 ms、`requestIdleCallback`）把**没有文本层**的页（可见字符 < 20）用 PDF.js 渲染到一张**离屏 canvas**（固定 `OCR_SCALE = 2`，约 150 DPI，面积上限 4 Mpx），`canvas.toBlob('image/png')` 后 `POST /paper-reader/api/ocr?key=<paperKey>&page=<n>`（二进制体，上限 8 MiB，loopback + Origin 校验与既有路由一致）。
2. Host 用 tesseract.js 的 Node worker（独立 worker 线程）以 `eng+chi_sim` 识别，返回 `{ page, text, ocrPages, ms }`。
3. Host 把该页文本**合并**进 `papers/<sha1>.text.json`（同一份 `src/host/text.ts` 缓存），并记录 `ocrPages` 标记；读取/写入按 paper key 串行，避免和 agent 工具的首次抽取互相覆盖。缓存已存在时同样合并。
4. 客户端把返回文本合并进自己的 `textCache`，页内搜索立即生效；工具栏显示 `OCR n/m`。
5. 打开论文时客户端 `GET /paper-reader/api/ocr?key=…` 取回上次的 OCR 页列表与文本：命中的页既不会重新栅格化也不会重新识别，历史 OCR 文本也直接进入搜索缓存。

`paper_info` 增加 `OCR 文本: 3/15 页（已识别: p.1, p.2, p.5）` 一行；`paper_read` 对 OCR 页的页头标注 `[第 N 页 · OCR]`。中文识别结果会把汉字之间 Tesseract 插入的空格去掉（`注 意 力` → `注意力`），否则多字词搜索不到。

## 引擎与资源：方案 (b) 构建时 vendoring

`package.json` 里 `tesseract.js@6.0.1`、`tesseract.js-core@6.1.2`、`@tesseract.js-data/{eng,chi_sim}@1.0.0`、`wasm-feature-detect@1.10.1` 是 **devDependencies（仅构建期）**。`node build.mjs` 产出：

```
lib/ocr/engine.cjs                     tesseract.js 的 worker 工厂（bundle）
lib/ocr/worker.cjs                     worker 线程脚本（bundle，含 core 加载器）
lib/ocr/engine-impl.cjs                运行时引擎（串行化、超时、空闲回收、中文空格归一化）
lib/ocr/tesseract-core-simd-lstm.wasm  LSTM-only WASM core（SIMD）
lib/ocr/tesseract-core-lstm.wasm       LSTM-only WASM core（无 SIMD 回退）
lib/ocr/lang/eng.traineddata.gz        best_int 英文模型
lib/ocr/lang/chi_sim.traineddata.gz    best_int 简体中文模型
```

之所以选 (b) 而不是把 tesseract.js 声明为运行时依赖：仓库的既有约定是 Host 产物自包含（PDF.js 已经 bundle 进 `lib/host.js`），插件以**目录链接**方式安装时虽然能从仓库 `node_modules` 解析，但发布/复制安装后不保证有依赖被安装；而 vendoring 后**新 profile 只需要本仓库产物本身，不需要任何 npm 安装、不访问 CDN**。代价是提交约 10.8 MiB 的二进制资源（见下表）与构建期 devDependencies。

Worker 里用的是本插件自己的 LSTM-only core 加载器（`src/host/ocr/core-loader.cjs`）：tesseract.js 的 Node 加载器会忽略 LSTM-only 标记而加载完整（legacy+LSTM）core，多出约 3.5 MB WASM；我们固定 `OEM.LSTM_ONLY`，只 ship 两个 LSTM core。

### 资源体积（提交进仓库）

| 文件 | 大小 |
|---|---:|
| `lib/ocr/worker.cjs` | 440.6 KiB |
| `lib/ocr/engine.cjs` | 402.2 KiB |
| `lib/ocr/engine-impl.cjs` | 4.4 KiB |
| `lib/ocr/tesseract-core-simd-lstm.wasm` | 2804.1 KiB |
| `lib/ocr/tesseract-core-lstm.wasm` | 2803.8 KiB |
| `lib/ocr/lang/eng.traineddata.gz` | 2883.7 KiB |
| `lib/ocr/lang/chi_sim.traineddata.gz` | 1678.5 KiB |
| **合计** | **10.76 MiB** |

发布影响：`package.json` 的 `files` 已加入 `lib/ocr`。npm tarball 里 WASM/gz 基本不可再压缩，**发布包从约 5 MB 增加到约 16 MB**；若认为体积不可接受，替代方案是把这些资源改为首次使用时由 Host 从本地 devDependency 复制到 `$DSH_HOME/paper-reader/ocr/`（仍离线，但要求安装时带上依赖）。

## 复现命令（无需浏览器）

```powershell
# 1) 生成"扫描页"：文字画进图片再存成 image-only PDF，因此 PDF 没有任何文本层
python scripts/ocr-fixture.py .build/ocr-fixture

# 2) 端到端检查：资源完整性 → 引擎离线识别 → Host 路由 → 文本缓存 → agent 工具
node scripts/ocr-check.mjs .build/ocr-fixture/scan.png .build/ocr-fixture/scan.pdf

# 3)（可选）客户端 OCR 队列的无浏览器逻辑测试
node node_modules/esbuild/bin/esbuild src/client/ocr/queue.ts --bundle --format=cjs --platform=node --outfile=.build/queue-test.cjs
node scripts/ocr-queue-test.cjs
```

`scripts/ocr-check.mjs` 的检查项（全部通过时输出 `OCR CHECK PASSED`）：

- `lib/ocr/` 下 7 个运行时资源存在，总计 10.76 MiB；`worker.cjs` / `engine.cjs` 不含任何外部 npm `require`（Node 内置模块与 node-fetch 的可选 `encoding` 除外），即安装后不需要 `node_modules`。
- 引擎直接识别合成扫描页（`eng+chi_sim`，离线）。断言：英文标题/正文、连续中文（`本文提出一种全新的简单网络结构`）、中文短语（`注意力`）。
- Host 路由往返：`POST /paper`（image-only PDF）→ `GET /ocr` 初始为空 → `POST /ocr` 识别第 1 页并写入 `papers/<sha1>.text.json`（`ocrPages: [1]`）→ 再次 `POST /ocr` 命中缓存（不重跑识别）→ `GET /ocr` 返回缓存文本。
- agent 工具：`paper_info` 输出 `OCR 文本: 1/1 页`，`paper_read` 输出 `[第 1 页 · OCR]`，`paper_search` 能找到 OCR 文本，`paper_outline` 不受影响。

`scripts/ocr-queue-test.cjs` 在 Node 里用 stub 的 `window`/`fetch`/PDF 页验证队列行为（8 项全过时输出 `QUEUE TEST PASSED`）：

- 只 POST 探测为扫描的页，顺序按距当前页由近到远（当前页优先）；
- 进度 `done/total` 与 `textCache` 合并正确；
- 一次 fill 最多 30 页，队列排空后不会偷偷扫全篇；
- `stop()` 之后不再发 OCR 请求；
- Host 已 OCR 的页（`alreadyOcred`）不会被重复 POST。

实测（本机，Windows / Node 24）：

- 引擎冷启动 1.7–1.9 s（worker 启动 + 4.7 MB 语言模型解压 + 首页识别），预热后**每页约 1.4–1.6 s**（1275×1650 的页面，`eng+chi_sim`）。
- Host 路由端到端（缓存命中文本缓存、worker 已热）：**约 1.6 s/页**；再次请求同一页 **2 ms**（缓存命中，不再识别）。
- 合成页 1275×1650 PNG 约 100 KiB，远低于 8 MiB 路由上限；Client 的 OCR 位图与页面渲染分离，固定比例、不跟随缩放。

## `src/client/pdf/chunk.tsx` 集成清单（锚点式）

> 该集成已在 `perf-fixer` 的 tab 释放提交（`9508d54`）之后合入；以下清单按附近代码定位（不用行号），保留下来便于 review 和后续重排。

1. **import**：在 `import type { PdfViewerProps } from '../contract.ts'` 之后加：

   ```ts
   import { createOcrScheduler, type OcrProgress, type OcrScheduler } from '../ocr/queue.ts'
   import { pageTextLength, renderPagePng, type OcrDocument } from '../ocr/raster.ts'
   ```

2. **ref**：在 `const gesture = useRef<Gesture | null>(null)` 之后加：

   ```ts
   const ocrScheduler = useRef<OcrScheduler | null>(null)
   ```

3. **state**：在 `const [noteEditor, setNoteEditor] = useState<NoteEditor | null>(null)` 之后加：

   ```ts
   const [ocrProgress, setOcrProgress] = useState<OcrProgress | null>(null)
   ```

4. **稳定回调**，放在 `pageText` 之后（都只读 ref，依赖数组为空）：

   ```ts
   const ocrCachedText = useCallback((page: number): string | null => textCache.current.get(page) ?? null, [])
   const ocrProbeText = useCallback((page: number): Promise<number> => {
     const doc = docRef.current
     return doc === null ? Promise.resolve(0) : pageTextLength(doc as unknown as OcrDocument, page)
   }, [])
   const ocrRenderPage = useCallback((page: number, signal: AbortSignal): Promise<Blob | null> => {
     const doc = docRef.current
     return doc === null ? Promise.resolve(null) : renderPagePng(doc as unknown as OcrDocument, page, signal)
   }, [])
   const ocrMergeText = useCallback((page: number, text: string): void => { textCache.current.set(page, text) }, [])
   ```

5. **调度 effect**：插在「Paint the page under the reader first…” 渲染窗口 effect 之后、「Annotated and searched pages need their text layer…」之前。先 `GET /paper-reader/api/ocr` 取 Host 已 OCR 的页（`done` + 文本），合并进 `textCache`，再启动调度器；cleanup 里 `abort` + `scheduler.stop()`，因此切论文/隐藏/卸载都会取消：

   关键依赖：`[numPages, ocrCachedText, ocrMergeText, ocrProbeText, ocrRenderPage, status, storageKey]`，`status !== 'ready' || numPages === 0` 时直接返回。`createOcrScheduler({ numPages, storageKey, alreadyOcred, getCachedText, probeText, renderPage, onText, onProgress: setOcrProgress, onError })`。

6. **当前页重排**：`useEffect(() => { ocrScheduler.current?.setCurrentPage(currentPage) }, [currentPage])`，放在保存阅读位置的 effect 附近。它把剩余队列按距当前页远近重排（跳页后先 OCR 正在看的那页）。

7. **滚动/缩放是活动信号**：在 `onScroll` 的 `requestAnimationFrame` 回调开头（`scrollRaf.current = null` 之后）与 `zoomBy` / `fitWidth` 的 `setScale` 之前调用 `ocrScheduler.current?.noteActivity()`。调度器只在最后一次活动 700 ms 之后才继续下一页，因此**滚动期间不会做 OCR 栅格化**。

8. **工具栏提示**：在 `h('span', { className: 'pr-spacer' })` 之后、缩小按钮之前插入：

   ```ts
   ocrProgress !== null && h('span', { className: 'pr-ocr', title: t('ocrHint') }, `${t('ocr')} ${ocrProgress.done}/${ocrProgress.total}`),
   ```

   `ocrProgress` 为 `null` 时不渲染；只有真的发现扫描页（`total > 0`）才出现。

9. **locale**：`src/client/locale.ts` 追加 `ocr: 'OCR'` / `ocrHint: '扫描页离线 OCR 进度'`（en 对应 `'OCR'` / `'Scanned-page OCR progress (offline)'`），`src/client/types.ts` 的 `PaperReaderLocaleKey` 联合类型末尾追加 `'ocr' | 'ocrHint'`；`src/client/pdf/styles.ts` 加 `.pr-ocr`（小号、弱化色）。

10. **不建文本层**：OCR 文本只进 `textCache` / Host 文本缓存；不要为 OCR 页调用 `buildTextLayer`、`paintHighlights` 或任何选区逻辑。

## 无浏览器不可验证项

- 真实浏览器里 `canvas.toBlob` + `fetch` 的位图链路、`requestIdleCallback` 时机、滚动期间是否真的完全让路（只能靠代码路径与 `noteActivity` 保证）。
- 工具栏 `OCR n/m` 的排版/本地化。
- 不同 PDF 页尺寸、裁剪框、旋转页的栅格化效果（`raster.ts` 用 `getViewport({scale})` 并设面积/尺寸上限）。
- 真实扫描件（噪点、倾斜、双栏）的识别质量——只能确认无文本层的页会被送去 OCR，质量取决于扫描质量。
- DSH Host 进程（Electron）里 worker 线程的真实行为；本次验证在同一个 Node 24 运行时里用同一份 `lib/ocr` 产物完成。

## 残余风险

- 首次打开扫描页时 Host 会做一次整篇文本抽取（`loadPaperText`）来建立逐页缓存，300 页的大文档可能多花数秒（在 Host 事件循环里异步进行，不阻塞 UI 线程，但会让该次 OCR 请求变慢）。
- 每开一次论文最多排队约 30 页（`OCR_QUEUE_LIMIT`，可在 `src/client/ocr/queue.ts` 调整）；队列排空后不会主动扫全篇，滚动/跳页会按新的当前页继续填充，`paper_info` 会如实报告 `OCR n/总页数`。
- `lib/ocr` 的 10.76 MiB 是提交/发布体积成本；如果发布到 npm 需要接受约 16 MB 的包体积。
- Chromium 的 PDF 渲染与 tesseract 都会占 CPU；OCR 只在空闲时一页一页跑，但一台很慢的机器上仍能感到风扇声。
