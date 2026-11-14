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

/** The current text selection in the reading surface, anchored to its page. */
interface Selection {
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
const RENDER_MARGIN = 1
const PREFETCH_AHEAD = 2
const RENDER_DELAY_MS = 120
const DPR_CAP = 1.5
const MAX_CANVAS_DIM = 16384
const MAX_CANVAS_AREA = 16777216
const MAX_HITS = 60
const POSITION_PREFIX = 'dsh.paper-reader.pos.'

/** Let the browser paint before a text layer re-lays the page out. */
function idle(): Promise<void> {
  return new Promise(resolve => {
    const ric = (window as unknown as {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
    }).requestIdleCallback
    if (ric !== undefined) ric(() => resolve(), { timeout: 250 })
    else window.setTimeout(resolve, 16)
  })
}
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

/**
 * The reading surface: continuous scrolling pages, outline drawer, whole-paper
 * search, highlights with notes, zoom, and the remembered position for this paper.
 */
export function PdfViewer({
  bytes,
  storageKey,
  t,
  highlights,
  onCreateHighlight,
  onUpdateNote,
  onDeleteHighlight,
  onQuote,
  onAsk,
}: PdfViewerProps): ReturnType<typeof h> {
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

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
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
  const [selection, setSelection] = useState<Selection | null>(null)
  const [noteEditor, setNoteEditor] = useState<NoteEditor | null>(null)

  useEffect(() => { currentPageRef.current = currentPage }, [currentPage])
  useEffect(() => { scaleRef.current = scale }, [scale])
  useEffect(() => { highlightsRef.current = highlights }, [highlights])

  // Highlights are anchored to text runs, so every (re)rendered page repaints.
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

  const renderPage = useCallback(async (pageNumber: number): Promise<void> => {
    const doc = docRef.current
    if (doc === null) return
    const key = `${pageNumber}@${scale}`
    const running = jobs.current.get(pageNumber)
    if (running !== undefined && running.key === key) return
    running?.cancel()

    let renderTask: { cancel(): void; promise: Promise<void> } | null = null
    let layer: InstanceType<typeof pdfjs.TextLayer> | null = null
    const job: PageJob = {
      key,
      cancel(): void {
        renderTask?.cancel()
        layer?.cancel()
      },
    }
    jobs.current.set(pageNumber, job)
    const isCurrent = (): boolean => jobs.current.get(pageNumber) === job

    try {
      const page = await doc.getPage(pageNumber)
      if (!isCurrent()) return
      const viewport = page.getViewport({ scale })
      const canvas = canvasRefs.current[pageNumber - 1]
      const textEl = textRefs.current[pageNumber - 1]
      if (canvas === null || canvas === undefined || textEl === null || textEl === undefined) return
      const dpr = canvasDpr(viewport)
      canvas.width = Math.max(1, Math.floor(viewport.width * dpr))
      canvas.height = Math.max(1, Math.floor(viewport.height * dpr))
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      renderTask = page.render({
        canvas,
        viewport,
        transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
      })
      await renderTask.promise
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
      // The canvas is what the reader sees; the text layer is only needed for
      // selection and search marks, so it waits for an idle frame.
      await idle()
      if (!isCurrent()) return
      textEl.replaceChildren()
      textEl.style.width = `${viewport.width}px`
      textEl.style.height = `${viewport.height}px`
      // PDF.js lays text runs out in `--total-scale-factor` units; a standalone
      // text layer has to publish the factor itself.
      textEl.style.setProperty('--total-scale-factor', String(viewport.scale))
      const content = await page.getTextContent()
      if (!isCurrent()) return
      layer = new pdfjs.TextLayer({ textContentSource: content, container: textEl, viewport })
      await layer.render()
      layer = null
      if (!isCurrent()) { textEl.replaceChildren(); return }
      textCache.current.set(pageNumber, content.items.map(item => ('str' in item ? item.str : '')).join(' '))
      markSpans(textEl, highlightRef.current)
      paintHighlights(textEl, pageNumber, highlightsRef.current)
      measureOffsets()
      void page.cleanup()
    } catch (error) {
      if (isCurrent()) {
        jobs.current.delete(pageNumber)
        console.warn('[paper-reader] page render failed', pageNumber, error)
      }
    }
  }, [scale])

  // Load the document once per byte buffer; the worker lives exactly as long.
  useEffect(() => {
    let disposed = false
    jobs.current.clear()
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
      docRef.current = null
      const task = taskRef.current
      taskRef.current = null
      const worker = workerRef.current
      workerRef.current = null
      void task?.destroy()
      worker?.destroy()
    }
  }, [bytes, storageKey])

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

  // Re-render the pages around the reader once scrolling settles. Waiting for a
  // pause keeps fast scrolling from cancelling and restarting renders.
  useEffect(() => {
    if (status !== 'ready') return
    let cancelled = false
    const from = Math.max(1, currentPage - RENDER_MARGIN)
    const to = Math.min(numPages, currentPage + PREFETCH_AHEAD)
    if (renderTimer.current !== null) window.clearTimeout(renderTimer.current)
    renderTimer.current = window.setTimeout(() => {
      renderTimer.current = null
      void (async () => {
        // Release far-away bitmaps: a long paper must not keep every canvas alive.
        for (let page = 1; page <= numPages; page += 1) {
          if (page >= from - 2 && page <= to + 2) continue
          const canvas = canvasRefs.current[page - 1]
          if (canvas !== null && canvas !== undefined && canvas.width > 1) {
            canvas.width = 0
            canvas.height = 0
            jobs.current.delete(page)
          }
        }
        for (let page = from; page <= to && !cancelled; page += 1) await renderPage(page)
      })()
    }, RENDER_DELAY_MS)
    return () => {
      cancelled = true
      if (renderTimer.current !== null) {
        window.clearTimeout(renderTimer.current)
        renderTimer.current = null
      }
    }
  }, [status, currentPage, numPages, renderPage])

  // Persist the position on the way out, including the last pending scroll.
  useEffect(() => () => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    if (scrollRaf.current !== null) window.cancelAnimationFrame(scrollRaf.current)
    if (measureRaf.current !== null) window.cancelAnimationFrame(measureRaf.current)
    if (renderTimer.current !== null) window.clearTimeout(renderTimer.current)
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

  // A fresh selection wins; a plain click on a painted highlight opens its note.
  const onMouseUp = useCallback((event: { clientX: number; clientY: number; target: EventTarget | null }): void => {
    const browserSelection = window.getSelection()
    if (browserSelection !== null && !browserSelection.isCollapsed) {
      const quote = browserSelection.toString().trim()
      const anchorPage = pageOfNode(browserSelection.anchorNode, pageRefs.current)
      const focusPage = pageOfNode(browserSelection.focusNode, pageRefs.current)
      if (quote === '' || anchorPage === null || focusPage === null || anchorPage !== focusPage) {
        setSelection(null)
        return
      }
      const rect = browserSelection.getRangeAt(0).getBoundingClientRect()
      const pane = scrollRef.current?.getBoundingClientRect()
      const left = pane?.left ?? 0
      const width = pane?.width ?? 360
      const x = Math.min(Math.max(rect.left + rect.width / 2, left + 12), left + width - 12)
      setSelection({ page: anchorPage, quote: quote.slice(0, 2000), x, y: Math.max(rect.top, 12) })
      return
    }
    setSelection(null)
    const ids = highlightIdsOf(event.target)
    if (ids.length === 0) return
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
  }, [])

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

  return h('div', { className: 'pr-root' },
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
    h('div', { className: 'pr-pages', ref: scrollRef, onScroll, onMouseUp },
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
