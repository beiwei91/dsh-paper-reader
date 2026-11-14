/**
 * Lazy chunk: everything that needs PDF.js lives here, so the always-loaded
 * Client bundle stays a few KiB. The main bundle reaches this module through
 * `require.async('./client.pdf.js')`; the loader serves it next to client.js
 * under the same artifact revision.
 */
import * as pdfjs from 'pdfjs-dist'
import { createElement as h, useCallback, useEffect, useRef, useState } from 'react'
import workerSource from '../../../.build/pdf-worker.txt'
import type { PdfViewerProps } from '../contract.ts'
import { VIEWER_CSS } from './styles.ts'

type PdfDoc = Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>
type PdfPage = Awaited<ReturnType<PdfDoc['getPage']>>
type PdfViewport = ReturnType<PdfPage['getViewport']>

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

const DEFAULT_PAGE: PageSize = { w: 612, h: 792 }
const MAX_ZOOM = 4
const MIN_ZOOM = 0.25
const RENDER_MARGIN = 1
const POSITION_PREFIX = 'dsh.paper-reader.pos.'

let workerStarted = false

/** One module worker for every document in the panel, fed from the inlined bundle. */
function ensureWorker(): void {
  if (workerStarted) return
  const url = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }))
  pdfjs.GlobalWorkerOptions.workerPort = new Worker(url, { type: 'module', name: 'dsh-paper-reader' })
  workerStarted = true
}

function readPosition(storageKey: string): StoredPosition | null {
  try {
    const raw = window.localStorage.getItem(POSITION_PREFIX + storageKey)
    if (raw === null) return null
    const parsed = JSON.parse(raw) as Partial<StoredPosition>
    if (typeof parsed.page !== 'number' || typeof parsed.scale !== 'number') return null
    return { page: Math.max(1, Math.floor(parsed.page)), scale: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, parsed.scale)) }
  } catch {
    return null
  }
}

function writePosition(storageKey: string, position: StoredPosition): void {
  try {
    window.localStorage.setItem(POSITION_PREFIX + storageKey, JSON.stringify(position))
  } catch {
    // Storage can be full or disabled; reading position is a convenience.
  }
}

function clampZoom(scale: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale))
}

function applyHighlight(container: HTMLElement, query: string): void {
  const needle = query.trim().toLowerCase()
  for (const span of container.querySelectorAll('span')) {
    const text = (span.textContent ?? '').toLowerCase()
    span.classList.toggle('pr-hit', needle !== '' && text.includes(needle))
  }
}

function snippetAround(text: string, query: string): string {
  const at = text.toLowerCase().indexOf(query.toLowerCase())
  if (at < 0) return text.slice(0, 90)
  const from = Math.max(0, at - 30)
  return (from > 0 ? '…' : '') + text.slice(from, Math.min(text.length, at + query.length + 50))
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

interface PdfOutlineNode {
  readonly title: string
  readonly dest: unknown
  readonly items?: readonly PdfOutlineNode[]
}

/**
 * The reading surface: continuous scrolling pages, outline drawer, whole-paper
 * search, zoom, and the remembered position for this paper.
 */
export function PdfViewer({ bytes, storageKey, t }: PdfViewerProps): ReturnType<typeof h> {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const pageRefs = useRef<(HTMLDivElement | null)[]>([])
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([])
  const textRefs = useRef<(HTMLDivElement | null)[]>([])
  const docRef = useRef<PdfDoc | null>(null)
  const loadingRef = useRef<{ destroy(): Promise<void> } | null>(null)
  const renderedKeys = useRef<Set<string>>(new Set())
  const textCache = useRef<Map<number, string>>(new Map())
  const highlightRef = useRef('')
  const saveTimer = useRef<number | null>(null)
  const restoreRef = useRef<StoredPosition | null>(null)
  const currentPageRef = useRef(1)

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [failure, setFailure] = useState('')
  const [numPages, setNumPages] = useState(0)
  const [sizes, setSizes] = useState<PageSize[]>([DEFAULT_PAGE])
  const [scale, setScale] = useState(1)
  const [currentPage, setCurrentPage] = useState(1)
  const [outline, setOutline] = useState<OutlineRow[] | null>(null)
  const [showOutline, setShowOutline] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [searching, setSearching] = useState(false)

  currentPageRef.current = currentPage

  const renderPage = useCallback(async (pageNumber: number): Promise<void> => {
    const doc = docRef.current
    if (doc === null) return
    const key = `${pageNumber}@${scale}`
    if (renderedKeys.current.has(key)) return
    const canvas = canvasRefs.current[pageNumber - 1]
    const textEl = textRefs.current[pageNumber - 1]
    if (canvas === null || textEl === null) return
    renderedKeys.current.add(key)
    try {
      const page = await doc.getPage(pageNumber)
      const viewport: PdfViewport = page.getViewport({ scale })
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.max(1, Math.floor(viewport.width * dpr))
      canvas.height = Math.max(1, Math.floor(viewport.height * dpr))
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      await page.render({
        canvas,
        viewport,
        transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
      }).promise
      textEl.replaceChildren()
      textEl.style.width = `${viewport.width}px`
      textEl.style.height = `${viewport.height}px`
      // PDF.js lays text runs out in `--total-scale-factor` units; a standalone
      // text layer has to publish the factor itself.
      textEl.style.setProperty('--total-scale-factor', String(scale))
      const content = await page.getTextContent()
      const layer = new pdfjs.TextLayer({ textContentSource: content, container: textEl, viewport })
      await layer.render()
      applyHighlight(textEl, highlightRef.current)
      setSizes(previous => {
        const next = previous.slice()
        next[pageNumber - 1] = { w: viewport.width / scale, h: viewport.height / scale }
        return next
      })
    } catch {
      renderedKeys.current.delete(key)
    }
  }, [scale])

  // Load the document once per byte buffer.
  useEffect(() => {
    let disposed = false
    renderedKeys.current.clear()
    textCache.current.clear()
    setStatus('loading')
    setFailure('')
    setOutline(null)
    setHits(null)
    setQuery('')
    setShowOutline(false)
    setShowSearch(false)
    restoreRef.current = readPosition(storageKey)
    void (async () => {
      try {
        ensureWorker()
        const task = pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false })
        loadingRef.current = task
        const doc = await task.promise
        if (disposed) {
          void task.destroy()
          return
        }
        docRef.current = doc
        const firstPage = await doc.getPage(1)
        const base = firstPage.getViewport({ scale: 1 })
        const all: PageSize[] = Array.from({ length: doc.numPages }, () => ({ w: base.width, h: base.height }))
        const width = scrollRef.current?.clientWidth ?? 0
        const fit = width > 40 ? (width - 28) / base.width : 1.2
        const restored = restoreRef.current
        setSizes(all)
        setNumPages(doc.numPages)
        setScale(clampZoom(restored?.scale ?? Math.min(2, Math.max(0.5, fit))))
        setCurrentPage(restored?.page ?? 1)
        setStatus('ready')
        const outlineRows: OutlineRow[] = []
        void flattenOutline(doc, ((await doc.getOutline()) ?? []) as unknown as readonly PdfOutlineNode[], 0, outlineRows).then(() => {
          if (!disposed) setOutline(outlineRows)
        })
      } catch (error) {
        if (disposed) return
        setFailure(error instanceof Error ? error.message : String(error))
        setStatus('error')
      }
    })()
    return () => {
      disposed = true
      renderedKeys.current.clear()
      docRef.current = null
      const task = loadingRef.current
      loadingRef.current = null
      if (task !== null) void task.destroy()
    }
  }, [bytes, storageKey])

  // Put the reader back where it was once the first pages have a size.
  useEffect(() => {
    const restored = restoreRef.current
    if (status !== 'ready' || restored === null) return
    restoreRef.current = null
    window.requestAnimationFrame(() => {
      const scroller = scrollRef.current
      const target = pageRefs.current[restored.page - 1]
      if (scroller !== null && target !== null && target !== undefined) scroller.scrollTop = target.offsetTop
    })
  }, [status])

  // Re-render the pages around the reader whenever the window or zoom changes.
  useEffect(() => {
    if (status !== 'ready') return
    let cancelled = false
    const from = Math.max(1, currentPage - RENDER_MARGIN)
    const to = Math.min(numPages, currentPage + RENDER_MARGIN)
    void (async () => {
      for (let page = from; page <= to && !cancelled; page += 1) await renderPage(page)
    })()
    return () => {
      cancelled = true
    }
  }, [status, currentPage, numPages, renderPage])

  const savePosition = useCallback((page: number): void => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => writePosition(storageKey, { page, scale }), 400)
  }, [storageKey, scale])

  const onScroll = useCallback((): void => {
    const scroller = scrollRef.current
    if (scroller === null) return
    const line = scroller.scrollTop + 60
    let page = 1
    for (let index = 0; index < pageRefs.current.length; index += 1) {
      const element = pageRefs.current[index]
      if (element === null || element === undefined) continue
      if (element.offsetTop <= line) page = index + 1
      else break
    }
    if (page !== currentPageRef.current) {
      setCurrentPage(page)
      savePosition(page)
    }
  }, [savePosition])

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
    if (trimmed === '') {
      setHits(null)
      return
    }
    setSearching(true)
    const found: SearchHit[] = []
    try {
      for (let page = 1; page <= numPages && found.length < 60; page += 1) {
        const text = await pageText(page)
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
      for (const element of textRefs.current) if (element !== null && element !== undefined) applyHighlight(element, trimmed)
    } finally {
      setSearching(false)
    }
  }, [numPages, pageText])

  const jumpTo = useCallback((page: number): void => {
    const target = Math.min(numPages, Math.max(1, page))
    setCurrentPage(target)
    const element = pageRefs.current[target - 1]
    const scroller = scrollRef.current
    if (element !== null && element !== undefined && scroller !== null) {
      scroller.scrollTop = element.offsetTop
      savePosition(target)
    }
  }, [numPages, savePosition])

  const fitWidth = useCallback((): void => {
    const width = scrollRef.current?.clientWidth ?? 0
    const first = sizes[0] ?? DEFAULT_PAGE
    if (width > 40) {
      renderedKeys.current.clear()
      setScale(clampZoom((width - 28) / first.w))
    }
  }, [sizes])

  const zoomBy = useCallback((factor: number): void => {
    renderedKeys.current.clear()
    setScale(previous => clampZoom(previous * factor))
  }, [])

  return h('div', { className: 'pr-root' },
    h('style', null, VIEWER_CSS),
    h('div', { className: 'pr-toolbar' },
      h('button', {
        type: 'button', className: 'pr-btn', title: t('outline'), 'aria-pressed': showOutline ? 'true' : 'false',
        onClick: () => { setShowOutline(value => !value); setShowSearch(false) },
      }, t('outline')),
      h('button', {
        type: 'button', className: 'pr-btn', title: t('search'), 'aria-pressed': showSearch ? 'true' : 'false',
        onClick: () => { setShowSearch(value => !value); setShowOutline(false) },
      }, t('search')),
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
        onChange: (event: { currentTarget: { value: string } }) => setQuery(event.currentTarget.value),
        onKeyDown: (event: { key: string }) => { if (event.key === 'Enter') void runSearch(query) },
      }),
      h('button', { type: 'button', className: 'pr-btn', onClick: () => void runSearch(query) }, t('search')),
    ),
    showSearch && (searching || hits !== null) && h('div', { className: 'pr-list' },
      searching && h('div', { className: 'pr-hint' }, t('searchRunning')),
      hits !== null && hits.length === 0 && h('div', { className: 'pr-hint' }, t('searchNoResults')),
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
    h('div', { className: 'pr-pages', ref: scrollRef, onScroll },
      status === 'loading' && h('div', { className: 'pr-status' }, t('loading')),
      status === 'error' && h('div', { className: 'pr-status' }, failure),
      status === 'ready' && Array.from({ length: numPages }, (_, index) => {
        const page = index + 1
        const size = sizes[index] ?? DEFAULT_PAGE
        return h('div', {
          key: page,
          className: 'pr-page',
          ref: (element: HTMLDivElement | null): void => { pageRefs.current[index] = element },
          style: { width: `${size.w * scale}px`, height: `${size.h * scale}px` },
        },
          h('canvas', { className: 'pr-canvas', ref: (element: HTMLCanvasElement | null): void => { canvasRefs.current[index] = element } }),
          h('div', { className: 'pr-text', ref: (element: HTMLDivElement | null): void => { textRefs.current[index] = element } }),
        )
      }),
    ),
  )
}
