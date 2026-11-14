/**
 * Lazy chunk: everything that needs PDF.js lives here, so the always-loaded
 * Client bundle stays a few KiB. The main bundle reaches this module through
 * `require.async('./client.pdf.js')`; the loader serves it next to client.js
 * under the same artifact revision.
 */
import * as pdfjs from 'pdfjs-dist'
import { createElement as h, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import workerSource from '../../../.build/pdf-worker.txt'
import type { Highlight, HighlightColor } from '../annotations.ts'
import type { PdfViewerProps } from '../contract.ts'
import { highlightIdsOf, paintHighlights } from './marks.ts'
import { VIEWER_CSS } from './styles.ts'

type PdfDoc = Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>
type PdfPage = Awaited<ReturnType<PdfDoc['getPage']>>
type PdfViewport = ReturnType<PdfPage['getViewport']>
type PdfWorker = ReturnType<typeof pdfjs.PDFWorker.create>

interface PageSize {
  readonly w: number
  readonly h: number
}

interface OutlineRow {
  readonly title: string
  readonly page: number | null
  readonly depth: number
}

interface SearchHit {
  readonly page: number
  readonly count: number
  readonly snippet: string
}

interface StoredPosition {
  readonly page: number
  readonly scale: number
}

/** One page's in-flight render, replaced (and cancelled) when its inputs change. */
interface PageJob {
  readonly key: string
  cancel(): void
}

/** One page's in-flight text-layer build, cancellable when the page is released. */
interface TextJob {
  readonly key: string
  promise: Promise<void>
  cancel(): void
}

/** The mouse gesture in flight, kept so a drag can be replayed once its layer exists. */
interface Gesture {
  readonly page: number
  readonly x: number
  readonly y: number
  /** The page already had a text layer when the press started, so nothing needs replaying. */
  readonly hadLayer: boolean
  readonly scrollTop: number
}

/** The current text selection in the reading surface, anchored to its page. */
interface ReaderSelection {
  readonly page: number
  readonly quote: string
  readonly x: number
  readonly y: number
}

/** The open note editor for one highlight. */
interface NoteEditor {
  readonly id: string
  readonly note: string
  readonly x: number
  readonly y: number
}

const DEFAULT_PAGE: PageSize = { w: 612, h: 792 }
const MAX_ZOOM = 4
const MIN_ZOOM = 0.25
const RENDER_DELAY_MS = 120
/** How long a hidden tab stays loaded before its document and bitmaps are released. */
const HIDDEN_RELEASE_MS = 1500
const DPR_CAP = 1.25
const MAX_CANVAS_DIM = 16384
const MAX_CANVAS_AREA = 16777216
const MAX_HITS = 60
const POSITION_PREFIX = 'dsh.paper-reader.pos.'
const COLORS: readonly HighlightColor[] = ['yellow', 'green', 'blue', 'pink']

let workerBlobUrl: string | null = null

/** The inlined worker source as one reusable Blob URL. */
function workerUrl(): string {
  workerBlobUrl ??= URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }))
  return workerBlobUrl
}

/**
 * One worker per open document. A worker is destroyed with its document, so a
 * shared port would let one tab's teardown freeze another tab's PDF.
 */
function spawnWorker(): PdfWorker {
  const port = new Worker(workerUrl(), { type: 'module', name: 'dsh-paper-reader' })
  port.addEventListener('error', (event: Event) => {
    console.error('[paper-reader] PDF worker failed to start', event)
  })
  return pdfjs.PDFWorker.create({ port })
}

function readPosition(storageKey: string): StoredPosition | null {
  try {
    const raw = window.localStorage.getItem(POSITION_PREFIX + storageKey)
    if (raw === null) return null
    const parsed = JSON.parse(raw) as Partial<StoredPosition>
    if (typeof parsed.page !== 'number' || typeof parsed.scale !== 'number') return null
    return { page: Math.max(1, Math.floor(parsed.page)), scale: clampZoom(parsed.scale) }
  } catch {
    return null
  }
}

function writePosition(storageKey: string, position: StoredPosition): void {
  try {
    window.localStorage.setItem(POSITION_PREFIX + storageKey, JSON.stringify(position))
  } catch {
    // Storage can be full or disabled; the reading position is a convenience.
  }
}

function clampZoom(scale: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale))
}

/** The scale that keeps a page inside the browser's canvas limits. */
function canvasDpr(viewport: PdfViewport): number {
  let dpr = Math.min(DPR_CAP, window.devicePixelRatio || 1)
  while (
    dpr > 0.2 &&
    (viewport.width * dpr > MAX_CANVAS_DIM ||
      viewport.height * dpr > MAX_CANVAS_DIM ||
      viewport.width * viewport.height * dpr * dpr > MAX_CANVAS_AREA)
  ) {
    dpr *= 0.8
  }
  return dpr
}

function markSpans(container: HTMLElement, query: string): void {
  const needle = query.trim().toLowerCase()
  const tokens = needle.split(/\s+/).filter(token => token.length >= 2)
  for (const span of container.querySelectorAll('span')) {
    const text = (span.textContent ?? '').toLowerCase()
    const hit =
      needle !== '' &&
      text !== '' &&
      (text.includes(needle) || needle.includes(text) || tokens.some(token => text.includes(token)))
    span.classList.toggle('pr-hit', hit)
  }
}

function clearMarks(container: HTMLElement): void {
  for (const span of container.querySelectorAll('span')) span.classList.remove('pr-hit')
}

function snippetAround(text: string, query: string): string {
  const at = text.toLowerCase().indexOf(query.toLowerCase())
  if (at < 0) return text.slice(0, 90)
  const from = Math.max(0, at - 30)
  return `${from > 0 ? '…' : ''}${text.slice(from, Math.min(text.length, at + query.length + 50))}`
}

interface PdfOutlineNode {
  readonly title: string
  readonly dest: unknown
  readonly items?: readonly PdfOutlineNode[]
}

async function flattenOutline(doc: PdfDoc, nodes: readonly PdfOutlineNode[], depth: number, out: OutlineRow[]): Promise<void> {
  for (const node of nodes) {
    let page: number | null = null
    try {
      let dest: unknown = node.dest
      if (typeof dest === 'string') dest = await doc.getDestination(dest)
      if (Array.isArray(dest) && dest.length > 0 && typeof dest[0] === 'object' && dest[0] !== null) {
        page = (await doc.getPageIndex(dest[0] as Parameters<PdfDoc['getPageIndex']>[0])) + 1
      }
    } catch {
      page = null
    }
    out.push({ title: node.title || '·', page, depth })
    if (node.items !== undefined && node.items.length > 0) await flattenOutline(doc, node.items, depth + 1, out)
  }
}

/** The page number of the `.pr-page` that contains a DOM node. */
function pageOfNode(node: Node | null, pages: readonly (HTMLDivElement | null)[]): number | null {
  const element = node instanceof Element ? node : node?.parentElement ?? null
  const page = element?.closest('.pr-page') ?? null
  if (page === null) return null
  const index = pages.findIndex(candidate => candidate === page)
  return index < 0 ? null : index + 1
}

/** The collapsed caret range at a viewport point, for replaying a drag. */
function caretRangeAt(x: number, y: number): Range | null {
  if (typeof document.caretRangeFromPoint === 'function') return document.caretRangeFromPoint(x, y)
  if (typeof document.caretPositionFromPoint !== 'function') return null
  const position = document.caretPositionFromPoint(x, y)
  if (position === null) return null
  const caret = document.createRange()
  caret.setStart(position.offsetNode, position.offset)
  caret.collapse(true)
  return caret
}

/**
 * The reading surface: continuous scrolling pages, outline drawer, whole-paper
 * search, highlights with notes, zoom, and the remembered position for this paper.
 */
export function PdfViewer({
  bytes,
  storageKey,
  t,
  highlights,
  visible = true,
  onCreateHighlight,
  onUpdateNote,
  onDeleteHighlight,
  onQuote,
  onAsk,
}: PdfViewerProps): ReturnType<typeof h> {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const pageRefs = useRef<(HTMLDivElement | null)[]>([])
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([])
  const textRefs = useRef<(HTMLDivElement | null)[]>([])
  const docRef = useRef<PdfDoc | null>(null)
  const workerRef = useRef<PdfWorker | null>(null)
  const taskRef = useRef<{ destroy(): Promise<void> } | null>(null)
  const jobs = useRef<Map<number, PageJob>>(new Map())
  const textCache = useRef<Map<number, string>>(new Map())
  const highlightRef = useRef('')
  const highlightsRef = useRef<readonly Highlight[]>(highlights)
  const saveTimer = useRef<number | null>(null)
  const restoreRef = useRef<StoredPosition | null>(null)
  const currentPageRef = useRef(1)
  const scaleRef = useRef(1)
  const searchVersion = useRef(0)
  const offsetsRef = useRef<number[]>([])
  const pageSizeRef = useRef<PageSize[]>([])
  const scrollRaf = useRef<number | null>(null)
  const measureRaf = useRef<number | null>(null)
  const renderTimer = useRef<number | null>(null)
  const prefetchTimer = useRef<number | null>(null)
  /** Which scale each page's text layer was built for; dropped when the page leaves the window. */
  const builtLayers = useRef<Map<number, string>>(new Map())
  /** In-flight text-layer builds, so a second gesture can await the first. */
  const textJobs = useRef<Map<number, TextJob>>(new Map())
  /** The mouse gesture in flight; a drag that began before its layer existed is replayed after it. */
  const gesture = useRef<Gesture | null>(null)

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  /** Whether the document should be loaded: false while this tab is hidden. */
  const [live, setLive] = useState(visible)
  const [failure, setFailure] = useState('')
  const [numPages, setNumPages] = useState(0)
  const [sizes, setSizes] = useState<PageSize[]>([DEFAULT_PAGE])
  const [scale, setScale] = useState(1)
  const [currentPage, setCurrentPage] = useState(1)
  const [outline, setOutline] = useState<OutlineRow[] | null>(null)
  const [showOutline, setShowOutline] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [showNotes, setShowNotes] = useState(false)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [selection, setSelection] = useState<ReaderSelection | null>(null)
  const [noteEditor, setNoteEditor] = useState<NoteEditor | null>(null)

  useEffect(() => { currentPageRef.current = currentPage }, [currentPage])
  useEffect(() => { scaleRef.current = scale }, [scale])
  useEffect(() => { highlightsRef.current = highlights }, [highlights])

  // A hidden tab stays mounted, so the open paper cannot disappear; only the
  // heavy PDF resources are dropped, and only once the tab has really been
  // hidden: the dock keeps hidden tabs in the DOM, which `getClientRects` (empty
  // while an ancestor is `hidden`) confirms before the expensive teardown. A
  // transient visibility flip shorter than the delay costs nothing.
  useEffect(() => {
    if (visible) {
      setLive(true)
      return
    }
    const timer = window.setTimeout(() => {
      const root = rootRef.current
      if (root === null || root.getClientRects().length === 0) setLive(false)
    }, HIDDEN_RELEASE_MS)
    return () => window.clearTimeout(timer)
  }, [visible])

  // Text-layer run geometry is scale-specific, so a zoom drops every layer
  // synchronously instead of leaving stale spans that would accept selection at
  // the old coordinates; annotated pages rebuild through the effect below.
  useEffect(() => {
    builtLayers.current.clear()
    for (const job of textJobs.current.values()) job.cancel()
    textJobs.current.clear()
    for (const element of textRefs.current) {
      if (element !== null && element !== undefined && element.childElementCount > 0) element.replaceChildren()
    }
  }, [scale])

  // Highlights are anchored to text runs, so every (re)built page repaints.
  useEffect(() => {
    for (let index = 0; index < textRefs.current.length; index += 1) {
      const element = textRefs.current[index]
      if (element !== null && element !== undefined) paintHighlights(element, index + 1, highlights)
    }
  }, [highlights, numPages, scale])

  const cancelJob = useCallback((pageNumber: number): void => {
    jobs.current.get(pageNumber)?.cancel()
    jobs.current.delete(pageNumber)
  }, [])

  /** Page tops in scroll-container coordinates, so scrolling never reads layout. */
  const measureOffsets = useCallback((): void => {
    if (measureRaf.current !== null) return
    measureRaf.current = window.requestAnimationFrame(() => {
      measureRaf.current = null
      const next: number[] = []
      for (let index = 0; index < pageRefs.current.length; index += 1) {
        next[index] = pageRefs.current[index]?.offsetTop ?? 0
      }
      offsetsRef.current = next
    })
  }, [])

  /**
   * Build one page's text layer on demand.
   *
   * Laying out a dense page's text runs is the most expensive thing this panel
   * does (thousands of absolutely positioned spans with per-run font metrics).
   * Doing it for every rendered page while scrolling is what froze the whole
   * app, so only pages that need it — annotated pages, search hits, and the page
   * the reader is actually selecting on — get one. Repeated calls share one
   * build, so a second selection gesture can await the first.
   */
  const buildTextLayer = useCallback((pageNumber: number): Promise<void> => {
    const doc = docRef.current
    if (doc === null) return Promise.resolve()
    const key = `${pageNumber}@${scale}`
    const running = textJobs.current.get(pageNumber)
    if (running !== undefined) {
      if (running.key === key) return running.promise
      running.cancel()
      textJobs.current.delete(pageNumber)
    }
    if (builtLayers.current.get(pageNumber) === key) return Promise.resolve()
    const textEl = textRefs.current[pageNumber - 1]
    if (textEl === null || textEl === undefined) return Promise.resolve()
    builtLayers.current.set(pageNumber, key)
    let cancelled = false
    let layer: InstanceType<typeof pdfjs.TextLayer> | null = null
    const job: TextJob = {
      key,
      promise: Promise.resolve(),
      cancel(): void {
        cancelled = true
        layer?.cancel()
        layer = null
        if (builtLayers.current.get(pageNumber) === key) builtLayers.current.delete(pageNumber)
        if (textEl.childElementCount > 0) textEl.replaceChildren()
      },
    }
    job.promise = (async (): Promise<void> => {
      try {
        const page = await doc.getPage(pageNumber)
        if (cancelled || builtLayers.current.get(pageNumber) !== key) return
        const viewport = page.getViewport({ scale })
        textEl.replaceChildren()
        textEl.style.width = `${viewport.width}px`
        textEl.style.height = `${viewport.height}px`
        // PDF.js lays text runs out in `--total-scale-factor` units; a standalone
        // text layer has to publish the factor itself.
        textEl.style.setProperty('--total-scale-factor', String(viewport.scale))
        const content = await page.getTextContent()
        if (cancelled || builtLayers.current.get(pageNumber) !== key) return
        layer = new pdfjs.TextLayer({ textContentSource: content, container: textEl, viewport })
        await layer.render()
        layer = null
        if (cancelled || builtLayers.current.get(pageNumber) !== key) return
        textCache.current.set(pageNumber, content.items.map(item => ('str' in item ? item.str : '')).join(' '))
        markSpans(textEl, highlightRef.current)
        paintHighlights(textEl, pageNumber, highlightsRef.current)
      } catch (error) {
        // A cancelled layer was already cleared, and a layer rebuilt at a newer
        // scale now owns this element: never wipe the replacement's spans.
        if (builtLayers.current.get(pageNumber) === key) {
          builtLayers.current.delete(pageNumber)
          textEl.replaceChildren()
          if (!cancelled) console.warn('[paper-reader] text layer failed', pageNumber, error)
        }
      } finally {
        if (textJobs.current.get(pageNumber) === job) textJobs.current.delete(pageNumber)
      }
    })()
    textJobs.current.set(pageNumber, job)
    return job.promise
  }, [scale])

  /** Drop one far page's bitmap and text layer, cancelling whatever is still in flight. */
  const releasePage = useCallback((pageNumber: number): void => {
    cancelJob(pageNumber)
    const textJob = textJobs.current.get(pageNumber)
    textJob?.cancel()
    textJobs.current.delete(pageNumber)
    builtLayers.current.delete(pageNumber)
    const textEl = textRefs.current[pageNumber - 1]
    if (textEl !== null && textEl !== undefined && textEl.childElementCount > 0) textEl.replaceChildren()
    const canvas = canvasRefs.current[pageNumber - 1]
    if (canvas !== null && canvas !== undefined && canvas.width > 1) {
      canvas.width = 0
      canvas.height = 0
    }
  }, [cancelJob])

  /** Paint one page's canvas, with a watchdog so a stuck render cannot freeze the panel. */
  const renderCanvas = useCallback(async (pageNumber: number): Promise<void> => {
    const doc = docRef.current
    if (doc === null) return
    const key = `${pageNumber}@${scale}`
    const running = jobs.current.get(pageNumber)
    if (running !== undefined && running.key === key) return
    running?.cancel()

    let renderTask: { cancel(): void; promise: Promise<void> } | null = null
    let watchdog: number | null = null
    const job: PageJob = {
      key,
      cancel(): void {
        renderTask?.cancel()
        if (watchdog !== null) {
          window.clearTimeout(watchdog)
          watchdog = null
        }
      },
    }
    jobs.current.set(pageNumber, job)
    const isCurrent = (): boolean => jobs.current.get(pageNumber) === job

    try {
      const page = await doc.getPage(pageNumber)
      if (!isCurrent()) return
      const viewport = page.getViewport({ scale })
      const canvas = canvasRefs.current[pageNumber - 1]
      if (canvas === null || canvas === undefined) return
      const dpr = canvasDpr(viewport)
      canvas.width = Math.max(1, Math.floor(viewport.width * dpr))
      canvas.height = Math.max(1, Math.floor(viewport.height * dpr))
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      renderTask = page.render({
        canvas,
        viewport,
        transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
        // Links and form widgets are not part of what this reader shows; skipping
        // their rendering keeps a heavy page's paint short.
        annotationMode: 0,
      })
      await Promise.race([
        renderTask.promise,
        new Promise<never>((_resolve, reject) => {
          watchdog = window.setTimeout(() => {
            renderTask?.cancel()
            reject(new Error(`page ${pageNumber} render timed out`))
          }, 4000)
        }),
      ])
      if (watchdog !== null) window.clearTimeout(watchdog)
      watchdog = null
      renderTask = null
      if (!isCurrent()) return
      // Size the page wrapper imperatively: a state update here would re-render
      // the whole page list on every rendered page.
      const wrapper = pageRefs.current[pageNumber - 1]
      if (wrapper !== null && wrapper !== undefined) {
        wrapper.style.width = `${viewport.width}px`
        wrapper.style.height = `${viewport.height}px`
      }
      pageSizeRef.current[pageNumber - 1] = { w: viewport.width / scale, h: viewport.height / scale }
      measureOffsets()
    } catch (error) {
      if (watchdog !== null) {
        window.clearTimeout(watchdog)
        watchdog = null
      }
      if (isCurrent()) {
        jobs.current.delete(pageNumber)
        console.warn('[paper-reader] page render failed', pageNumber, error)
      }
    }
  }, [measureOffsets, scale])

  // Load the document once per byte buffer; the worker lives exactly as long.
  useEffect(() => {
    // A hidden tab keeps its component (and bytes) but no document: the cleanup
    // below has already released it, and the tab reloads from `bytes` when shown.
    if (!live) {
      setStatus('loading')
      return
    }
    let disposed = false
    jobs.current.clear()
    builtLayers.current.clear()
    textCache.current.clear()
    setStatus('loading')
    setFailure('')
    setOutline(null)
    setHits(null)
    setQuery('')
    setShowOutline(false)
    setShowSearch(false)
    setShowNotes(false)
    setSelection(null)
    setNoteEditor(null)
    restoreRef.current = readPosition(storageKey)
    void (async () => {
      try {
        const worker = spawnWorker()
        workerRef.current = worker
        const task = pdfjs.getDocument({ data: bytes.slice(), worker })
        taskRef.current = task
        const doc = await task.promise
        if (disposed) return
        docRef.current = doc
        const firstPage = await doc.getPage(1)
        const base = firstPage.getViewport({ scale: 1 })
        const all: PageSize[] = Array.from({ length: doc.numPages }, () => ({ w: base.width, h: base.height }))
        const width = scrollRef.current?.clientWidth ?? 0
        const fit = width > 40 ? (width - 28) / base.width : 1.2
        const restored = restoreRef.current
        pageRefs.current.length = doc.numPages
        setSizes(all)
        setNumPages(doc.numPages)
        setScale(clampZoom(restored?.scale ?? Math.min(2, Math.max(0.5, fit))))
        setCurrentPage(Math.min(restored?.page ?? 1, doc.numPages))
        setStatus('ready')
        const outlineRows: OutlineRow[] = []
        void flattenOutline(doc, ((await doc.getOutline()) ?? []) as unknown as readonly PdfOutlineNode[], 0, outlineRows)
          .then(() => { if (!disposed) setOutline(outlineRows) })
          .catch(() => { if (!disposed) setOutline([]) })
      } catch (error) {
        if (disposed) return
        setFailure(error instanceof Error ? error.message : String(error))
        setStatus('error')
      }
    })()
    return () => {
      disposed = true
      searchVersion.current += 1
      for (const job of jobs.current.values()) job.cancel()
      jobs.current.clear()
      for (const job of textJobs.current.values()) job.cancel()
      textJobs.current.clear()
      builtLayers.current.clear()
      docRef.current = null
      const task = taskRef.current
      taskRef.current = null
      const worker = workerRef.current
      workerRef.current = null
      void task?.destroy()
      worker?.destroy()
      // Hiding a tab must not lose the reader's place in the paper.
      writePosition(storageKey, { page: currentPageRef.current, scale: scaleRef.current })
    }
  }, [live, bytes, storageKey])

  // Put the reader back where it was once the pages have a size.
  useEffect(() => {
    const restored = restoreRef.current
    if (status !== 'ready' || restored === null) return
    restoreRef.current = null
    window.requestAnimationFrame(() => {
      const scroller = scrollRef.current
      const target = pageRefs.current[restored.page - 1]
      if (scroller !== null && target !== null && target !== undefined) scroller.scrollTop = target.offsetTop
      measureOffsets()
    })
  }, [measureOffsets, status])

  // Page tops change with zoom and with each finished render.
  useEffect(() => {
    if (status !== 'ready') return
    measureOffsets()
  }, [measureOffsets, numPages, scale, status])

  // Paint the page under the reader first, and the neighbours only once the
  // reader has been still for a while: canvas painting is main-thread work, so
  // queuing several dense pages at once is what froze the whole app.
  useEffect(() => {
    if (status !== 'ready') return
    let cancelled = false
    const keep = new Set([currentPage - 3, currentPage - 2, currentPage - 1, currentPage, currentPage + 1, currentPage + 2, currentPage + 3])
    if (renderTimer.current !== null) window.clearTimeout(renderTimer.current)
    if (prefetchTimer.current !== null) window.clearTimeout(prefetchTimer.current)
    renderTimer.current = window.setTimeout(() => {
      renderTimer.current = null
      // Release far-away bitmaps and text layers: a long paper must not keep
      // every canvas alive.
      for (let page = 1; page <= numPages; page += 1) {
        if (!keep.has(page)) releasePage(page)
      }
      void renderCanvas(currentPage)
      prefetchTimer.current = window.setTimeout(() => {
        prefetchTimer.current = null
        if (cancelled) return
        for (const page of [currentPage + 1, currentPage - 1, currentPage + 2]) {
          if (page >= 1 && page <= numPages) void renderCanvas(page)
        }
      }, 600)
    }, RENDER_DELAY_MS)
    return () => {
      cancelled = true
      if (renderTimer.current !== null) {
        window.clearTimeout(renderTimer.current)
        renderTimer.current = null
      }
      if (prefetchTimer.current !== null) {
        window.clearTimeout(prefetchTimer.current)
        prefetchTimer.current = null
      }
    }
  }, [numPages, currentPage, releasePage, renderCanvas, status])

  // Annotated and searched pages need their text layer even before the reader
  // touches them; everything else waits for a selection gesture. The window is
  // small and delayed like the canvas renders, so a fast scroll cannot queue
  // several dense layers at once.
  useEffect(() => {
    if (status !== 'ready') return
    const timer = window.setTimeout(() => {
      const from = Math.max(1, currentPage - 2)
      const to = Math.min(numPages, currentPage + 3)
      for (const highlight of highlights) {
        if (highlight.page >= from && highlight.page <= to) void buildTextLayer(highlight.page)
      }
      if (hits === null) return
      for (const hit of hits) {
        if (Math.abs(hit.page - currentPage) <= 3) void buildTextLayer(hit.page)
      }
    }, RENDER_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [buildTextLayer, currentPage, hits, highlights, numPages, status])

  // Starting a selection is what asks for a text layer on an arbitrary page.
  const onMouseDown = useCallback((event: { target: EventTarget | null; clientX: number; clientY: number; button: number }): void => {
    const page = event.button === 0 ? pageOfNode(event.target as Node | null, pageRefs.current) : null
    if (page === null) {
      gesture.current = null
      return
    }
    const textEl = textRefs.current[page - 1]
    gesture.current = {
      page,
      x: event.clientX,
      y: event.clientY,
      hadLayer: builtLayers.current.get(page) === `${page}@${scaleRef.current}` &&
        textEl !== null && textEl !== undefined && textEl.childElementCount > 0,
      scrollTop: scrollRef.current?.scrollTop ?? 0,
    }
    void buildTextLayer(page)
  }, [buildTextLayer])

  // Persist the position on the way out, including the last pending scroll.
  useEffect(() => () => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    if (scrollRaf.current !== null) window.cancelAnimationFrame(scrollRaf.current)
    if (measureRaf.current !== null) window.cancelAnimationFrame(measureRaf.current)
    if (renderTimer.current !== null) window.clearTimeout(renderTimer.current)
    if (prefetchTimer.current !== null) window.clearTimeout(prefetchTimer.current)
    writePosition(storageKey, { page: currentPageRef.current, scale: scaleRef.current })
  }, [storageKey])

  const savePosition = useCallback((page: number): void => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => writePosition(storageKey, { page, scale: scaleRef.current }), 400)
  }, [storageKey])

  // One rAF per frame, and no layout reads: offsets were measured when pages moved.
  const onScroll = useCallback((): void => {
    if (scrollRaf.current !== null) return
    scrollRaf.current = window.requestAnimationFrame(() => {
      scrollRaf.current = null
      const scroller = scrollRef.current
      if (scroller === null) return
      const line = scroller.scrollTop + 80
      const offsets = offsetsRef.current
      const limit = Math.min(offsets.length, numPages)
      let page = 1
      let low = 0
      let high = limit - 1
      while (low <= high) {
        const mid = (low + high) >> 1
        if ((offsets[mid] ?? 0) <= line) {
          page = mid + 1
          low = mid + 1
        } else {
          high = mid - 1
        }
      }
      if (page !== currentPageRef.current) {
        setCurrentPage(page)
        savePosition(page)
      }
    })
  }, [numPages, savePosition])

  const pageText = useCallback(async (pageNumber: number): Promise<string> => {
    const cached = textCache.current.get(pageNumber)
    if (cached !== undefined) return cached
    const doc = docRef.current
    if (doc === null) return ''
    const page = await doc.getPage(pageNumber)
    const content = await page.getTextContent()
    const text = content.items.map(item => ('str' in item ? item.str : '')).join(' ')
    textCache.current.set(pageNumber, text)
    return text
  }, [])

  const runSearch = useCallback(async (needle: string): Promise<void> => {
    const trimmed = needle.trim()
    const version = searchVersion.current + 1
    searchVersion.current = version
    if (trimmed === '') {
      setHits(null)
      highlightRef.current = ''
      for (const element of textRefs.current) if (element !== null && element !== undefined) clearMarks(element)
      return
    }
    setSearching(true)
    const found: SearchHit[] = []
    try {
      for (let page = 1; page <= numPages && found.length < MAX_HITS; page += 1) {
        const text = await pageText(page)
        if (version !== searchVersion.current) return
        const lower = text.toLowerCase()
        const target = trimmed.toLowerCase()
        let count = 0
        let at = lower.indexOf(target)
        while (at >= 0) {
          count += 1
          at = lower.indexOf(target, at + target.length)
        }
        if (count > 0) found.push({ page, count, snippet: snippetAround(text, trimmed) })
      }
      setHits(found)
      highlightRef.current = trimmed
      // Marks only exist on built layers; layers built later mark themselves from
      // `highlightRef`. The effect over `hits` builds the ones near the reader.
      for (const element of textRefs.current) if (element !== null && element !== undefined) markSpans(element, trimmed)
    } catch (error) {
      if (version === searchVersion.current) console.warn('[paper-reader] search failed', error)
    } finally {
      if (version === searchVersion.current) setSearching(false)
    }
  }, [numPages, pageText])

  const jumpTo = useCallback((page: number): void => {
    const target = Math.min(numPages, Math.max(1, page))
    setCurrentPage(target)
    const scroller = scrollRef.current
    if (scroller !== null) {
      scroller.scrollTop = offsetsRef.current[target - 1] ?? pageRefs.current[target - 1]?.offsetTop ?? 0
      savePosition(target)
    }
  }, [numPages, savePosition])

  const fitWidth = useCallback((): void => {
    const width = scrollRef.current?.clientWidth ?? 0
    const first = pageSizeRef.current[0] ?? sizes[0] ?? DEFAULT_PAGE
    if (width > 40) {
      for (const page of jobs.current.keys()) cancelJob(page)
      setScale(clampZoom((width - 28) / first.w))
    }
  }, [cancelJob, sizes])

  const zoomBy = useCallback((factor: number): void => {
    for (const page of jobs.current.keys()) cancelJob(page)
    setScale(previous => clampZoom(previous * factor))
  }, [cancelJob])

  const clearSelection = useCallback((): void => {
    setSelection(null)
    window.getSelection()?.removeAllRanges()
  }, [])

  /** Turn a browser selection that lives inside one page into the action bar. */
  const commitSelection = useCallback((browserSelection: Selection): boolean => {
    const quote = browserSelection.toString().trim()
    const anchorPage = pageOfNode(browserSelection.anchorNode, pageRefs.current)
    const focusPage = pageOfNode(browserSelection.focusNode, pageRefs.current)
    if (quote === '' || anchorPage === null || focusPage === null || anchorPage !== focusPage) {
      setSelection(null)
      return false
    }
    const rect = browserSelection.getRangeAt(0).getBoundingClientRect()
    const pane = scrollRef.current?.getBoundingClientRect()
    const left = pane?.left ?? 0
    const width = pane?.width ?? 360
    const x = Math.min(Math.max(rect.left + rect.width / 2, left + 12), left + width - 12)
    setSelection({ page: anchorPage, quote: quote.slice(0, 2000), x, y: Math.max(rect.top, 12) })
    return true
  }, [])

  /**
   * A drag that started before its page had a text layer selects nothing, because
   * the layer only appears during the drag. Once the build finishes, the caret at
   * both gesture points reconstructs the same range, so the action bar still
   * shows instead of the reader having to drag twice.
   */
  const replaySelection = useCallback((start: Gesture, endX: number, endY: number): void => {
    void buildTextLayer(start.page).then(() => {
      const scroller = scrollRef.current
      if (scroller === null || scroller.scrollTop !== start.scrollTop) return
      const from = caretRangeAt(start.x, start.y)
      const to = caretRangeAt(endX, endY)
      if (from === null || to === null) return
      const backwards = from.compareBoundaryPoints(Range.START_TO_START, to) > 0
      const range = document.createRange()
      try {
        range.setStart(
          backwards ? to.startContainer : from.startContainer,
          backwards ? to.startOffset : from.startOffset,
        )
        range.setEnd(
          backwards ? from.startContainer : to.startContainer,
          backwards ? from.startOffset : to.startOffset,
        )
      } catch {
        return
      }
      const browserSelection = window.getSelection()
      if (browserSelection === null) return
      browserSelection.removeAllRanges()
      browserSelection.addRange(range)
      if (!commitSelection(browserSelection)) browserSelection.removeAllRanges()
    })
  }, [buildTextLayer, commitSelection])

  // A fresh selection wins; a plain click on a painted highlight opens its note.
  const onMouseUp = useCallback((event: { clientX: number; clientY: number; button: number; target: EventTarget | null }): void => {
    const started = gesture.current
    gesture.current = null
    const browserSelection = window.getSelection()
    if (browserSelection !== null && !browserSelection.isCollapsed) {
      commitSelection(browserSelection)
      return
    }
    setSelection(null)
    const ids = highlightIdsOf(event.target)
    if (ids.length === 0) {
      // Nothing selected after a real drag means the layer was still being built
      // when the gesture began; replay it rather than failing silently.
      if (
        started !== null &&
        event.button === 0 &&
        !started.hadLayer &&
        (Math.abs(event.clientX - started.x) > 4 || Math.abs(event.clientY - started.y) > 4)
      ) {
        replaySelection(started, event.clientX, event.clientY)
      }
      return
    }
    const highlight = highlightsRef.current.find(candidate => candidate.id === ids[0])
    if (highlight === undefined) return
    const pane = scrollRef.current?.getBoundingClientRect()
    const left = pane?.left ?? 0
    const width = pane?.width ?? 360
    setNoteEditor({
      id: highlight.id,
      note: highlight.note,
      x: Math.max(8, Math.min(event.clientX, left + width - 240)),
      y: Math.max(8, event.clientY - 20),
    })
  }, [commitSelection, replaySelection])

  const selectionAction = useCallback((action: 'quote' | 'explain' | 'translate' | 'copy'): void => {
    if (selection === null) return
    if (action === 'quote') onQuote(selection.quote, selection.page)
    if (action === 'explain') onAsk(selection.quote, selection.page, 'explain')
    if (action === 'translate') onAsk(selection.quote, selection.page, 'translate')
    if (action === 'copy') void navigator.clipboard?.writeText(selection.quote).catch(() => undefined)
    clearSelection()
  }, [clearSelection, onAsk, onQuote, selection])

  const saveNote = useCallback((): void => {
    if (noteEditor !== null) onUpdateNote(noteEditor.id, noteEditor.note)
    setNoteEditor(null)
  }, [noteEditor, onUpdateNote])

  const scrollToHighlight = useCallback((highlight: Highlight): void => {
    jumpTo(highlight.page)
    const pane = scrollRef.current?.getBoundingClientRect()
    setNoteEditor({ id: highlight.id, note: highlight.note, x: Math.max(8, (pane?.left ?? 8) + 8), y: 120 })
    setShowNotes(false)
  }, [jumpTo])

  // The page list is rebuilt only when the document or zoom changes: a scroll
  // tick then re-renders the toolbar and indicator alone, not every wrapper.
  const pageElements = useMemo(() => Array.from({ length: numPages }, (_, index) => {
    const page = index + 1
    const size = sizes[index] ?? DEFAULT_PAGE
    return h('div', {
      key: page,
      className: 'pr-page',
      'data-page': page,
      ref: (element: HTMLDivElement | null): void => { pageRefs.current[index] = element },
      style: { width: `${size.w * scale}px`, height: `${size.h * scale}px` },
    },
      h('canvas', { className: 'pr-canvas', ref: (element: HTMLCanvasElement | null): void => { canvasRefs.current[index] = element } }),
      h('div', { className: 'pr-text', ref: (element: HTMLDivElement | null): void => { textRefs.current[index] = element } }),
    )
  }), [numPages, scale, sizes])

  return h('div', { className: 'pr-root', ref: rootRef },
    h('style', null, VIEWER_CSS),
    h('div', { className: 'pr-toolbar' },
      h('button', {
        type: 'button', className: 'pr-btn', title: t('outline'), 'aria-pressed': showOutline ? 'true' : 'false',
        onClick: () => { setShowOutline(value => !value); setShowSearch(false); setShowNotes(false) },
      }, t('outline')),
      h('button', {
        type: 'button', className: 'pr-btn', title: t('search'), 'aria-pressed': showSearch ? 'true' : 'false',
        onClick: () => { setShowSearch(value => !value); setShowOutline(false); setShowNotes(false) },
      }, t('search')),
      h('button', {
        type: 'button', className: 'pr-btn', title: t('notes'), 'aria-pressed': showNotes ? 'true' : 'false',
        onClick: () => { setShowNotes(value => !value); setShowSearch(false); setShowOutline(false) },
      }, t('notes')),
      h('span', { className: 'pr-spacer' }),
      h('button', { type: 'button', className: 'pr-btn', title: t('zoomOut'), onClick: () => zoomBy(1 / 1.2) }, '−'),
      h('span', { className: 'pr-num' }, `${currentPage} / ${numPages || '–'}`),
      h('button', { type: 'button', className: 'pr-btn', title: t('zoomIn'), onClick: () => zoomBy(1.2) }, '+'),
      h('button', { type: 'button', className: 'pr-btn', title: t('fitWidth'), onClick: fitWidth }, '⤢'),
    ),
    showSearch && h('div', { className: 'pr-bar' },
      h('input', {
        className: 'pr-input',
        placeholder: t('searchPlaceholder'),
        value: query,
        autoFocus: true,
        onChange: (event: { currentTarget: { value: string } }) => {
          const value = event.currentTarget.value
          setQuery(value)
          if (value.trim() === '') void runSearch('')
        },
        onKeyDown: (event: { key: string }) => { if (event.key === 'Enter') void runSearch(query) },
      }),
      h('button', { type: 'button', className: 'pr-btn', onClick: () => void runSearch(query) }, t('search')),
    ),
    showSearch && (searching || hits !== null) && h('div', { className: 'pr-list' },
      searching && h('div', { className: 'pr-hint' }, t('searchRunning')),
      hits !== null && hits.length === 0 && !searching && h('div', { className: 'pr-hint' }, t('searchNoResults')),
      hits !== null && hits.map(hit => h('button', {
        key: hit.page, type: 'button', className: 'pr-row',
        onClick: () => { jumpTo(hit.page); setShowSearch(false) },
      }, `${hit.page} · ${hit.count} ${t('searchCount')} — ${hit.snippet}`)),
    ),
    showOutline && h('div', { className: 'pr-list' },
      outline === null && h('div', { className: 'pr-hint' }, t('loading')),
      outline !== null && outline.length === 0 && h('div', { className: 'pr-hint' }, t('outlineEmpty')),
      outline !== null && outline.map((row, index) => h('button', {
        key: `${row.title}-${index}`,
        type: 'button',
        className: 'pr-row',
        style: { paddingLeft: `${8 + row.depth * 12}px` },
        onClick: () => { if (row.page !== null) { jumpTo(row.page); setShowOutline(false) } },
      }, row.title)),
    ),
    showNotes && h('div', { className: 'pr-list' },
      highlights.length === 0 && h('div', { className: 'pr-hint' }, t('notesEmpty')),
      highlights.map(highlight => h('button', {
        key: highlight.id,
        type: 'button',
        className: 'pr-row',
        onClick: () => scrollToHighlight(highlight),
      }, `p.${highlight.page} · ${highlight.quote.slice(0, 40)}${highlight.quote.length > 40 ? '…' : ''}${highlight.note === '' ? '' : ` — ${highlight.note}`}`)),
    ),
    h('div', { className: 'pr-pages', ref: scrollRef, onScroll, onMouseUp, onMouseDown },
      status === 'loading' && h('div', { className: 'pr-status' }, t('loading')),
      status === 'error' && h('div', { className: 'pr-status' }, failure),
      status === 'ready' && pageElements,
    ),
    selection !== null && h('div', {
      className: 'pr-sel',
      style: { left: `${selection.x}px`, top: `${selection.y - 10}px` },
      onMouseDown: (event: { preventDefault(): void }) => event.preventDefault(),
    },
      ...COLORS.map(color => h('button', {
        key: color,
        type: 'button',
        className: 'pr-swatch',
        'data-color': color,
        title: t('highlight'),
        onClick: () => { onCreateHighlight({ page: selection.page, color, quote: selection.quote }); clearSelection() },
      })),
      h('button', { type: 'button', className: 'pr-btn', onClick: () => selectionAction('quote') }, t('quoteAction')),
      h('button', { type: 'button', className: 'pr-btn', onClick: () => selectionAction('explain') }, t('explain')),
      h('button', { type: 'button', className: 'pr-btn', onClick: () => selectionAction('translate') }, t('translate')),
      h('button', { type: 'button', className: 'pr-btn', onClick: () => selectionAction('copy') }, t('copy')),
    ),
    noteEditor !== null && h('div', {
      className: 'pr-note',
      style: { left: `${Math.max(8, Math.min(noteEditor.x, window.innerWidth - 240))}px`, top: `${Math.max(8, noteEditor.y - 20)}px` },
    },
      h('textarea', {
        className: 'pr-note-input',
        value: noteEditor.note,
        placeholder: t('notePlaceholder'),
        autoFocus: true,
        onKeyDown: (event: { key: string; currentTarget: { blur(): void } }) => {
          if (event.key === 'Escape') { event.currentTarget.blur(); setNoteEditor(null) }
        },
        onChange: (event: { currentTarget: { value: string } }) => setNoteEditor({ ...noteEditor, note: event.currentTarget.value }),
      }),
      h('div', { className: 'pr-note-actions' },
        h('button', { type: 'button', className: 'pr-btn', onClick: saveNote }, t('noteSave')),
        h('button', {
          type: 'button', className: 'pr-btn',
          onClick: () => { onDeleteHighlight(noteEditor.id); setNoteEditor(null) },
        }, t('noteDelete')),
      ),
    ),
  )
}
