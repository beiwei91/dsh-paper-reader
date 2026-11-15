/**
 * Lazy chunk: everything that needs PDF.js lives here, so the always-loaded
 * Client bundle stays a few KiB. The main bundle reaches this module through
 * `require.async('./client.pdf.js')`; the loader serves it next to client.js
 * under the same artifact revision.
 */
import * as pdfjs from 'pdfjs-dist'
import { createElement as h, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import workerSource from '../../../.build/pdf-worker.txt'
import { ANNOTATION_COLORS, clampFraction } from '../../shared/annotationModel.ts'
import type { AnnotationKind, Highlight, HighlightColor } from '../annotations.ts'
import type { PdfViewerProps } from '../contract.ts'
import { createOcrScheduler, type OcrProgress, type OcrScheduler } from '../ocr/queue.ts'
import { pageTextLength, renderPagePng, type OcrDocument } from '../ocr/raster.ts'
import { layoutHighlights, type PaintedHighlight } from './marks.ts'
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

/** The open note editor: a margin note, or a text box's content. */
interface NoteEditor {
  readonly id: string
  readonly kind: AnnotationKind
  /** The note (highlight/underline) or the box's content (text). */
  readonly value: string
  readonly x: number
  readonly y: number
}

/** The annotation tool armed in the toolbar, if any. */
type ActiveTool = 'underline' | 'text'

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
/** Swatch order, shared with the Host allow-list. */
const COLORS = ANNOTATION_COLORS
/** Underline stroke thickness in page pixels (page-local, so it scales with zoom). */
const UNDERLINE_THICKNESS = 2
/** A text box anchors at the click point and grows inward past these fractions. */
const TEXT_BOX_ANCHOR_X = 0.6
const TEXT_BOX_ANCHOR_Y = 0.75
/** The underline tool starts on the palette's original blue accent. */
const DEFAULT_UNDERLINE_COLOR: HighlightColor = 'blue'
/**
 * Ctrl/Cmd+wheel zoom rate: one wheel delta unit scales by `exp(-delta * rate)`.
 * Fine enough for a trackpad pinch and still a sensible notch on a real wheel.
 */
const WHEEL_ZOOM_RATE = 0.0015
/** How far above a jumped-to highlight's first box the reader lands. */
const HIGHLIGHT_REVEAL_OFFSET = 40
/** Bounded wait for a highlight's geometry before falling back to its page top. */
const HIGHLIGHT_REVEAL_TIMEOUT_MS = 1200
/** Note-badge geometry in the right page margin (px). */
const BADGE_SIZE = 9
const BADGE_GAP = 3
/** Outline titles quoted in a digest prompt, so the prompt stays a reasonable size. */
const DIGEST_SECTION_LIMIT = 30

interface ZoomAnchor {
  /** The scale this anchor belongs to; applied the layout after it commits. */
  readonly scale: number
  readonly page: number
  /** The cursor's vertical position inside that page, as a 0–1 fraction. */
  readonly ratio: number
  /** The cursor's vertical offset from the scroller's top edge. */
  readonly viewportY: number
}

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
  name,
  t,
  highlights,
  visible = true,
  onCreateAnnotation,
  onUpdateNote,
  onUpdateTextBox,
  onDeleteAnnotation,
  onQuote,
  onAsk,
  onDigest,
}: PdfViewerProps): ReturnType<typeof h> {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const pageRefs = useRef<(HTMLDivElement | null)[]>([])
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([])
  const textRefs = useRef<(HTMLDivElement | null)[]>([])
  /** Per-page overlay holding the painted highlight rectangles and underline strokes. */
  const hlRefs = useRef<(HTMLDivElement | null)[]>([])
  /** Per-page overlay holding one note badge per annotated highlight. */
  const badgeRefs = useRef<(HTMLDivElement | null)[]>([])
  /** Per-page overlay holding the fraction-anchored text boxes. */
  const tbRefs = useRef<(HTMLDivElement | null)[]>([])
  /** Painted quote-anchored geometry per page, in page-local coordinates, for click hit-testing. */
  const hitRects = useRef<Map<number, readonly PaintedHighlight[]>>(new Map())
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
  /** Guards one pointer press from also running its synthetic click action. */
  const actionGuard = useRef(false)
  /** Background OCR of scanned pages: one scheduler per open document. */
  const ocrScheduler = useRef<OcrScheduler | null>(null)
  /** Where the cursor was when a ctrl+wheel zoom started, applied once the new sizes commit. */
  const zoomAnchor = useRef<ZoomAnchor | null>(null)
  /** The scale the latest wheel events asked for, so one frame's events compound correctly. */
  const pendingScale = useRef<number | null>(null)
  /** The newest ctrl+wheel handler, so the non-passive listener can stay registered once. */
  const wheelZoomRef = useRef<(event: WheelEvent) => void>(() => undefined)
  /** The latest copy function, so the painted badges stay localisable without repainting on every render. */
  const tRef = useRef(t)

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
  /** The armed annotation tool: selection underlines, or click places text boxes. */
  const [activeTool, setActiveTool] = useState<ActiveTool | null>(null)
  /** The underline stroke colour chosen in the toolbar's palette strip. */
  const [toolColor, setToolColor] = useState<HighlightColor>(DEFAULT_UNDERLINE_COLOR)
  /** One transient toolbar line, so a gesture never looks like it did nothing. */
  const [toast, setToast] = useState('')
  const toastTimer = useRef<number | null>(null)
  const [ocrProgress, setOcrProgress] = useState<OcrProgress | null>(null)
  /** Pages the Host's OCR cache already had when this document opened (for the digest prompt). */
  const [cachedOcrPages, setCachedOcrPages] = useState(0)

  useEffect(() => { currentPageRef.current = currentPage }, [currentPage])
  useEffect(() => {
    scaleRef.current = scale
    pendingScale.current = null
  }, [scale])
  useEffect(() => { highlightsRef.current = highlights }, [highlights])
  useEffect(() => { tRef.current = t }, [t])

  /** Show one transient line in the toolbar; the next message replaces it. */
  const announce = useCallback((message: string): void => {
    setToast(message)
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => {
      toastTimer.current = null
      setToast('')
    }, 2400)
  }, [])

  /** Clear the transient toolbar line early (e.g. when its action is undone). */
  const dismissToast = useCallback((): void => {
    if (toastTimer.current !== null) {
      window.clearTimeout(toastTimer.current)
      toastTimer.current = null
    }
    setToast('')
  }, [])

  /**
   * Open one annotation's editor at a viewport point (shared by boxes, underlines,
   * margin badges and the notes list). A text box is edited as its content; a
   * highlight/underline is edited as its margin note.
   */
  const openNoteEditor = useCallback((id: string, clientX: number, clientY: number): void => {
    const annotation = highlightsRef.current.find(candidate => candidate.id === id)
    if (annotation === undefined) return
    const pane = scrollRef.current?.getBoundingClientRect()
    const left = pane?.left ?? 0
    const width = pane?.width ?? 360
    setNoteEditor({
      id: annotation.id,
      kind: annotation.kind,
      value: annotation.kind === 'text' ? annotation.text ?? '' : annotation.note,
      x: Math.max(8, Math.min(clientX, left + width - 240)),
      y: Math.max(8, clientY - 20),
    })
  }, [])

  /**
   * Recompute one page's quote-anchored overlay from its built text layer.
   *
   * Painting is character-exact now: `layoutHighlights` turns each stored quote
   * into a DOM Range and its client rects (one box per line), so a partial
   * selection paints only the selected characters instead of the whole PDF.js
   * text run. A highlight fills each box; an underline rules a 2 px stroke along
   * the box's bottom edge and has no fill. The geometry is kept per page for
   * click hit-testing, because the overlay boxes themselves are
   * `pointer-events: none`. Pages without a built layer are never measured here;
   * text boxes never pass through here (they are fraction-anchored).
   *
   * Annotated cards also get a note badge in the right page margin, at the last
   * painted line's vertical centre (for an underline: at the ruled line): it must
   * sit outside the glyphs, so it starts just past the box and is clamped inside
   * the page's right edge. Badges are repainted (and removed) together with their
   * rectangles.
   */
  const paintPageHighlights = useCallback((pageNumber: number): void => {
    const textEl = textRefs.current[pageNumber - 1]
    const pageEl = pageRefs.current[pageNumber - 1]
    const layer = hlRefs.current[pageNumber - 1]
    const badgeLayer = badgeRefs.current[pageNumber - 1]
    if (textEl === null || textEl === undefined || pageEl === null || pageEl === undefined || layer === null || layer === undefined) {
      // The page's DOM is gone (released/unmounted): no boxes can show, and its
      // cached geometry must not survive to open a dead annotation's editor.
      hitRects.current.delete(pageNumber)
      if (badgeLayer !== null && badgeLayer !== undefined) badgeLayer.replaceChildren()
      return
    }
    const pageAnnotations = highlightsRef.current.filter(annotation =>
      annotation.page === pageNumber && annotation.kind !== 'text',
    )
    layer.replaceChildren()
    if (badgeLayer !== null && badgeLayer !== undefined) badgeLayer.replaceChildren()
    if (pageAnnotations.length === 0 || textEl.childElementCount === 0) {
      hitRects.current.set(pageNumber, [])
      return
    }
    const painted = layoutHighlights(textEl, pageEl, pageAnnotations)
    for (const annotation of painted) {
      for (const box of annotation.rects) {
        if (annotation.kind === 'underline') {
          // A 2 px stroke whose centre sits ~1 px above the box's bottom edge, so
          // the ruled line hugs the text's descender box.
          const line = document.createElement('div')
          line.className = 'pr-hl-line'
          line.setAttribute('data-color', annotation.color)
          line.style.left = `${box.x}px`
          line.style.top = `${box.bottom - UNDERLINE_THICKNESS}px`
          line.style.width = `${box.w}px`
          layer.append(line)
          continue
        }
        const rect = document.createElement('div')
        rect.className = 'pr-hl-rect'
        rect.setAttribute('data-color', annotation.color)
        rect.style.left = `${box.x}px`
        rect.style.top = `${box.y}px`
        rect.style.width = `${box.w}px`
        rect.style.height = `${box.h}px`
        layer.append(rect)
      }
    }
    if (badgeLayer !== null && badgeLayer !== undefined && painted.length > 0) {
      const pageWidth = pageEl.clientWidth || pageEl.offsetWidth
      const notes = new Map<string, string>()
      for (const annotation of pageAnnotations) notes.set(annotation.id, annotation.note)
      for (const annotation of painted) {
        const note = (notes.get(annotation.id) ?? '').trim()
        const last = annotation.rects[annotation.rects.length - 1]
        if (note === '' || last === undefined) continue
        const badge = document.createElement('button')
        badge.type = 'button'
        badge.className = 'pr-hl-badge'
        badge.setAttribute('data-color', annotation.color)
        badge.setAttribute('aria-label', tRef.current('noteBadge'))
        badge.title = note.length > 120 ? `${note.slice(0, 120)}…` : note
        // Right page margin, never over the glyphs: `BADGE_GAP` past the last box,
        // and at worst flush against the page's inner right edge.
        const anchorY = annotation.kind === 'underline' ? last.bottom - 2 : last.y + last.h / 2
        const left = Math.min(last.x + last.w + BADGE_GAP, Math.max(0, pageWidth - BADGE_SIZE - 1))
        const top = Math.max(0, anchorY - BADGE_SIZE / 2)
        badge.style.left = `${left}px`
        badge.style.top = `${top}px`
        badge.addEventListener('mousedown', (event: MouseEvent) => {
          // Keep the reader's gesture handling (and text selection) out of it.
          event.preventDefault()
          event.stopPropagation()
        })
        badge.addEventListener('click', (event: MouseEvent) => {
          event.preventDefault()
          event.stopPropagation()
          const box = badge.getBoundingClientRect()
          openNoteEditor(annotation.id, box.left, box.top)
        })
        badgeLayer.append(badge)
      }
    }
    hitRects.current.set(pageNumber, painted)
  }, [openNoteEditor])

  /**
   * Paint one page's text boxes (`kind: 'text'`) into their own overlay.
   *
   * A text box is anchored by a fraction of the page's unscaled size, so it needs
   * no text layer and is already zoom-independent: the same fractions place it at
   * the same spot at every scale. The overlay itself is `pointer-events: none` and
   * each box is `pointer-events: auto`, so a box only takes pointer events over its
   * own area and page text stays selectable everywhere else. Placement is exact at
   * the click point; dragging is deliberately not supported (a drag would fight
   * the text-selection gesture), so a box near an edge grows toward the page
   * interior instead of hanging off it.
   *
   * No layout reads: positions are percentages; only the click-to-edit path reads a
   * box's rect, and only when the user clicks one.
   */
  const paintPageTextBoxes = useCallback((pageNumber: number, boxes: readonly Highlight[]): void => {
    const layer = tbRefs.current[pageNumber - 1]
    if (layer === null || layer === undefined) return
    if (boxes.length === 0) {
      if (layer.childElementCount > 0) layer.replaceChildren()
      return
    }
    layer.replaceChildren()
    for (const annotation of boxes) {
      const text = (annotation.text ?? '').trim()
      if (text === '') continue
      const xPct = clampFraction(annotation.xPct)
      const yPct = clampFraction(annotation.yPct)
      const box = document.createElement('div')
      box.className = 'pr-tb'
      box.textContent = text
      box.setAttribute('role', 'button')
      box.setAttribute('aria-label', tRef.current('textBox'))
      box.style.left = `${xPct * 100}%`
      box.style.top = `${yPct * 100}%`
      box.style.transform = `translate(${xPct > TEXT_BOX_ANCHOR_X ? '-100%' : '0'},${yPct > TEXT_BOX_ANCHOR_Y ? '-100%' : '0'})`
      box.addEventListener('mousedown', (event: MouseEvent) => {
        // Keep the reader's gesture handling out of the box. Focus is allowed to
        // move, so an open editor commits its value through `blur`.
        event.stopPropagation()
      })
      box.addEventListener('click', (event: MouseEvent) => {
        event.preventDefault()
        event.stopPropagation()
        const rect = box.getBoundingClientRect()
        openNoteEditor(annotation.id, rect.left, rect.top)
      })
      layer.append(box)
    }
  }, [openNoteEditor])

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
    for (const element of hlRefs.current) {
      if (element !== null && element !== undefined && element.childElementCount > 0) element.replaceChildren()
    }
    for (const element of badgeRefs.current) {
      if (element !== null && element !== undefined && element.childElementCount > 0) element.replaceChildren()
    }
    // Text boxes are fraction-anchored, so they survive a zoom; dropping them here
    // and repainting from the fractions keeps their layer in step with the pages.
    for (const element of tbRefs.current) {
      if (element !== null && element !== undefined && element.childElementCount > 0) element.replaceChildren()
    }
    hitRects.current.clear()
  }, [scale])

  // Highlights are anchored to text runs, so every (re)built page repaints — and
  // so does every page that just lost its last highlight: skipping pages with no
  // highlights would leave a deleted mark's rectangle (and its click geometry)
  // painted until the next zoom or reload. Driven by state only, never by
  // scrolling; a page without a built text layer is not measured (the painter's
  // early return covers it, and the built-layer check keeps the loop cheap).
  useEffect(() => {
    if (status !== 'ready') return
    for (let index = 0; index < textRefs.current.length; index += 1) {
      const page = index + 1
      const built = (textRefs.current[index]?.childElementCount ?? 0) > 0
      if (!built && !hitRects.current.has(page)) continue
      paintPageHighlights(page)
    }
  }, [highlights, numPages, paintPageHighlights, scale, status, visible])

  // Text boxes are repainted from the stored fractions whenever the annotations,
  // the zoom or the page window changes: no text layer is needed, no layout is read,
  // and a released far page repaints itself when it comes back into the window.
  useEffect(() => {
    if (status !== 'ready') return
    const byPage = new Map<number, Highlight[]>()
    for (const annotation of highlights) {
      if (annotation.kind !== 'text') continue
      const list = byPage.get(annotation.page)
      if (list === undefined) byPage.set(annotation.page, [annotation])
      else list.push(annotation)
    }
    for (let index = 0; index < pageRefs.current.length; index += 1) {
      paintPageTextBoxes(index + 1, byPage.get(index + 1) ?? [])
    }
  }, [currentPage, highlights, numPages, paintPageTextBoxes, scale, status, visible])

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
        paintPageHighlights(pageNumber)
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
  }, [paintPageHighlights, scale])

  /** Drop one far page's bitmap and text layer, cancelling whatever is still in flight. */
  const releasePage = useCallback((pageNumber: number): void => {
    cancelJob(pageNumber)
    const textJob = textJobs.current.get(pageNumber)
    textJob?.cancel()
    textJobs.current.delete(pageNumber)
    builtLayers.current.delete(pageNumber)
    const textEl = textRefs.current[pageNumber - 1]
    if (textEl !== null && textEl !== undefined && textEl.childElementCount > 0) textEl.replaceChildren()
    const layer = hlRefs.current[pageNumber - 1]
    if (layer !== null && layer !== undefined && layer.childElementCount > 0) layer.replaceChildren()
    const badgeLayer = badgeRefs.current[pageNumber - 1]
    if (badgeLayer !== null && badgeLayer !== undefined && badgeLayer.childElementCount > 0) badgeLayer.replaceChildren()
    const tbLayer = tbRefs.current[pageNumber - 1]
    if (tbLayer !== null && tbLayer !== undefined && tbLayer.childElementCount > 0) tbLayer.replaceChildren()
    hitRects.current.delete(pageNumber)
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
    hitRects.current.clear()
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
    setActiveTool(null)
    setCachedOcrPages(0)
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
      hitRects.current.clear()
      for (const layer of hlRefs.current) {
        if (layer !== null && layer !== undefined && layer.childElementCount > 0) layer.replaceChildren()
      }
      for (const layer of badgeRefs.current) {
        if (layer !== null && layer !== undefined && layer.childElementCount > 0) layer.replaceChildren()
      }
      for (const layer of tbRefs.current) {
        if (layer !== null && layer !== undefined && layer.childElementCount > 0) layer.replaceChildren()
      }
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
      for (const annotation of highlights) {
        // Text boxes are fraction-anchored and need no text layer at all.
        if (annotation.kind === 'text') continue
        if (annotation.page >= from && annotation.page <= to) void buildTextLayer(annotation.page)
      }
      if (hits === null) return
      for (const hit of hits) {
        if (Math.abs(hit.page - currentPage) <= 3) void buildTextLayer(hit.page)
      }
    }, RENDER_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [buildTextLayer, currentPage, hits, highlights, numPages, status])

  // Starting a selection is what asks for a text layer on an arbitrary page. The
  // text-box tool is a click-to-place gesture, so it neither selects nor spends a
  // text-layer build on every press.
  const onMouseDown = useCallback((event: { target: EventTarget | null; clientX: number; clientY: number; button: number }): void => {
    if (activeTool === 'text') {
      gesture.current = null
      return
    }
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
  }, [activeTool, buildTextLayer])

  // Any armed tool is escapable, whether or not the reader focused the page.
  // A focused input/textarea keeps its own Escape (the note editor's close/commit).
  useEffect(() => {
    if (activeTool === null) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      const target = event.target
      if (target instanceof HTMLElement) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return
      }
      setActiveTool(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeTool])

  /** Arm or disarm one toolbar tool; arming one disarms the other and drops any open popover. */
  const toggleTool = useCallback((tool: ActiveTool): void => {
    setActiveTool(current => current === tool ? null : tool)
    setSelection(null)
  }, [])

  // Persist the position on the way out, including the last pending scroll.
  useEffect(() => () => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    if (scrollRaf.current !== null) window.cancelAnimationFrame(scrollRaf.current)
    if (measureRaf.current !== null) window.cancelAnimationFrame(measureRaf.current)
    if (renderTimer.current !== null) window.clearTimeout(renderTimer.current)
    if (prefetchTimer.current !== null) window.clearTimeout(prefetchTimer.current)
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current)
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
      // OCR yields to the reader: activity pushes the next page back.
      ocrScheduler.current?.noteActivity()
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

  // Scanned-page OCR. The scheduler rasterises a page only while the reader has
  // been still for a while, and the Host recognises it in a worker thread; OCR
  // text is merged into `textCache` for search only, never into a text layer.
  const ocrCachedText = useCallback((page: number): string | null => textCache.current.get(page) ?? null, [])
  const ocrProbeText = useCallback((page: number): Promise<number> => {
    const doc = docRef.current
    return doc === null ? Promise.resolve(0) : pageTextLength(doc as unknown as OcrDocument, page)
  }, [])
  const ocrRenderPage = useCallback((page: number, signal: AbortSignal): Promise<Blob | null> => {
    const doc = docRef.current
    return doc === null ? Promise.resolve(null) : renderPagePng(doc as unknown as OcrDocument, page, signal)
  }, [])
  const ocrMergeText = useCallback((page: number, text: string): void => {
    textCache.current.set(page, text)
  }, [])

  // One OCR pass per open document: pick up the Host's already-OCR'd pages
  // (so reopening never re-recognises), then queue the scanned pages around the
  // reader. Cleanup aborts the in-flight request/render when the paper changes,
  // the tab unmounts, or the document is released while hidden.
  useEffect(() => {
    if (status !== 'ready' || numPages === 0) return
    let disposed = false
    const cacheController = new AbortController()
    void (async () => {
      const alreadyOcred = new Set<number>()
      try {
        const response = await fetch(`/paper-reader/api/ocr?key=${encodeURIComponent(storageKey)}`, {
          signal: cacheController.signal,
        })
        if (response.ok) {
          const body = (await response.json()) as { done?: unknown; pages?: unknown }
          if (Array.isArray(body.done)) {
            for (const page of body.done) if (typeof page === 'number') alreadyOcred.add(page)
            if (!disposed) setCachedOcrPages(alreadyOcred.size)
          }
          if (Array.isArray(body.pages)) {
            for (const entry of body.pages) {
              const row = entry as { page?: unknown; text?: unknown }
              if (typeof row.page === 'number' && typeof row.text === 'string' && row.text.trim() !== '') {
                textCache.current.set(row.page, row.text)
              }
            }
          }
        }
      } catch (error) {
        if (!cacheController.signal.aborted) console.warn('[paper-reader] OCR cache unavailable', error)
      }
      if (disposed) return
      const scheduler = createOcrScheduler({
        numPages,
        storageKey,
        alreadyOcred,
        getCachedText: ocrCachedText,
        probeText: ocrProbeText,
        renderPage: ocrRenderPage,
        onText: ocrMergeText,
        onProgress: setOcrProgress,
        onError: error => console.warn('[paper-reader] OCR skipped a page', error),
      })
      ocrScheduler.current = scheduler
      // The reader may have been restored to a page other than the first one.
      scheduler.setCurrentPage(currentPageRef.current)
      scheduler.start()
    })()
    return () => {
      disposed = true
      cacheController.abort()
      const scheduler = ocrScheduler.current
      ocrScheduler.current = null
      scheduler?.stop()
    }
  }, [numPages, ocrCachedText, ocrMergeText, ocrProbeText, ocrRenderPage, status, storageKey])

  // The page under the reader goes first: reorder the remaining OCR queue on
  // every page change, and restart the loop when the queue had already drained.
  useEffect(() => {
    ocrScheduler.current?.setCurrentPage(currentPage)
  }, [currentPage])

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
      ocrScheduler.current?.noteActivity()
      for (const page of jobs.current.keys()) cancelJob(page)
      setScale(clampZoom((width - 28) / first.w))
    }
  }, [cancelJob, sizes])

  const zoomBy = useCallback((factor: number): void => {
    ocrScheduler.current?.noteActivity()
    for (const page of jobs.current.keys()) cancelJob(page)
    setScale(previous => clampZoom(previous * factor))
  }, [cancelJob])

  /**
   * Ctrl/Cmd+wheel zoom, as its own non-passive listener so `preventDefault()`
   * can stop the browser's own page zoom and so the gesture never scrolls the
   * reader. The content point under the cursor is remembered as a fraction of the
   * page under it; a layout effect applies the matching scroll once the new page
   * sizes are committed (no layout reads here beyond the one offsetHeight of the
   * page being anchored, and none in the scroll handler).
   */
  const applyWheelZoom = useCallback((event: WheelEvent): void => {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    const scroller = scrollRef.current
    if (scroller === null) return
    // deltaMode 1 = lines, 2 = pages: normalise both to a pixel-ish delta.
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? Math.max(1, scroller.clientHeight) : 1
    const factor = Math.exp(-event.deltaY * unit * WHEEL_ZOOM_RATE)
    // Compound from the last requested scale, not only from the committed one:
    // a trackpad pinch fires several wheel events before React re-renders.
    const previous = pendingScale.current ?? scaleRef.current
    const next = clampZoom(previous * factor)
    pendingScale.current = next
    if (next === previous) return
    const rect = scroller.getBoundingClientRect()
    const viewportY = event.clientY - rect.top
    const contentY = scroller.scrollTop + viewportY
    const offsets = offsetsRef.current
    let pageIndex = 0
    for (let index = 0; index < offsets.length && index < pageRefs.current.length; index += 1) {
      if ((offsets[index] ?? 0) <= contentY) pageIndex = index
    }
    const pageEl = pageRefs.current[pageIndex]
    const pageTop = offsets[pageIndex] ?? 0
    const pageHeight = pageEl?.offsetHeight ?? 0
    const ratio = pageHeight > 0 ? Math.min(1, Math.max(0, (contentY - pageTop) / pageHeight)) : 0
    zoomAnchor.current = { scale: next, page: pageIndex + 1, ratio, viewportY }
    ocrScheduler.current?.noteActivity()
    for (const page of jobs.current.keys()) cancelJob(page)
    setScale(next)
  }, [cancelJob])

  useEffect(() => { wheelZoomRef.current = applyWheelZoom }, [applyWheelZoom])

  // A fresh document reload swaps nothing in the DOM (the scroller is always
  // mounted), so one registration lasts the viewer's lifetime.
  useEffect(() => {
    const scroller = scrollRef.current
    if (scroller === null) return
    const onWheel = (event: WheelEvent): void => wheelZoomRef.current(event)
    scroller.addEventListener('wheel', onWheel, { passive: false })
    return () => scroller.removeEventListener('wheel', onWheel)
  }, [])

  // The pages have their new sizes by the layout phase, so the anchor can be
  // applied before the browser paints the zoom: no visible jump between the
  // scale change and the corrected scroll offset.
  useLayoutEffect(() => {
    const anchor = zoomAnchor.current
    if (anchor === null) return
    zoomAnchor.current = null
    if (anchor.scale !== scale) return
    const scroller = scrollRef.current
    const pageEl = pageRefs.current[anchor.page - 1]
    if (scroller === null || pageEl === null || pageEl === undefined) return
    const height = pageEl.offsetHeight
    if (height <= 0) return
    scroller.scrollTop = Math.max(0, pageEl.offsetTop + height * anchor.ratio - anchor.viewportY)
    measureOffsets()
    if (anchor.page !== currentPageRef.current) {
      setCurrentPage(anchor.page)
      savePosition(anchor.page)
    }
  }, [measureOffsets, savePosition, scale])

  const clearSelection = useCallback((): void => {
    setSelection(null)
    window.getSelection()?.removeAllRanges()
  }, [])

  /**
   * Read a browser selection that lives inside one page: its quote, its page and
   * the viewport point a popover should sit at. Null when the selection spans
   * pages, is empty, or is only a caret.
   */
  const describeSelection = useCallback((browserSelection: Selection): ReaderSelection | null => {
    if (browserSelection.isCollapsed) return null
    const quote = browserSelection.toString().trim()
    const anchorPage = pageOfNode(browserSelection.anchorNode, pageRefs.current)
    const focusPage = pageOfNode(browserSelection.focusNode, pageRefs.current)
    if (quote === '' || anchorPage === null || focusPage === null || anchorPage !== focusPage) return null
    const rect = browserSelection.getRangeAt(0).getBoundingClientRect()
    const pane = scrollRef.current?.getBoundingClientRect()
    const left = pane?.left ?? 0
    const width = pane?.width ?? 360
    const x = Math.min(Math.max(rect.left + rect.width / 2, left + 12), left + width - 12)
    return { page: anchorPage, quote: quote.slice(0, 2000), x, y: Math.max(rect.top, 12) }
  }, [])

  /** Turn a browser selection that lives inside one page into the action bar. */
  const commitSelection = useCallback((browserSelection: Selection): boolean => {
    const described = describeSelection(browserSelection)
    setSelection(described)
    return described !== null
  }, [describeSelection])

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

  /**
   * The topmost painted annotation under a viewport point on one page. The
   * overlay rectangles are `pointer-events: none` so text selection keeps
   * working, hence this geometric hit test instead of an event target. An
   * underline's click band is the whole untrimmed text box (the 2 px stroke alone
   * would be nearly impossible to hit).
   */
  const highlightAt = useCallback((page: number, clientX: number, clientY: number): string | null => {
    const painted = hitRects.current.get(page)
    const pageEl = pageRefs.current[page - 1]
    if (painted === undefined || pageEl === null || pageEl === undefined) return null
    const pageRect = pageEl.getBoundingClientRect()
    const x = clientX - pageRect.left
    const y = clientY - pageRect.top
    for (let index = painted.length - 1; index >= 0; index -= 1) {
      const underline = painted[index].kind === 'underline'
      for (const box of painted[index].rects) {
        const top = underline ? box.top : box.y
        const bottom = underline ? box.bottom : box.y + box.h
        if (x >= box.x && x <= box.x + box.w && y >= top && y <= bottom) return painted[index].id
      }
    }
    return null
  }, [])

  /** Create a quote-anchored annotation (highlight or underline) and confirm it visibly. */
  const createMark = useCallback((kind: 'highlight' | 'underline', color: HighlightColor, quote: string, page: number): void => {
    if (quote.trim() === '') return
    onCreateAnnotation({ page, kind, color, quote })
    clearSelection()
    // A page whose text layer was released gets it back before the mark can be
    // painted; buildTextLayer repaints annotations with the latest stored list.
    void buildTextLayer(page)
    announce(`${t(kind === 'underline' ? 'underlineSaved' : 'highlightSaved')} p.${page}`)
  }, [announce, buildTextLayer, clearSelection, onCreateAnnotation, t])

  /**
   * Place a text box at a viewport point on one page.
   *
   * The stored anchor is a fraction of the page's unscaled width/height — never a
   * pixel coordinate — so the same fraction puts the box back after any zoom. The
   * box starts with empty content and its editor opens immediately; committing
   * empty content deletes it again (and the Host drops empty boxes as well).
   * Dragging is deliberately not supported: a drag on the page is the
   * text-selection gesture, so a box is placed exactly where it was clicked and
   * grows toward the page's interior near an edge.
   */
  const createTextBox = useCallback((page: number, clientX: number, clientY: number): void => {
    const pageEl = pageRefs.current[page - 1]
    if (pageEl === null || pageEl === undefined) return
    const rect = pageEl.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const id = onCreateAnnotation({
      page,
      kind: 'text',
      color: toolColor,
      quote: '',
      text: '',
      xPct: clampFraction((clientX - rect.left) / rect.width),
      yPct: clampFraction((clientY - rect.top) / rect.height),
    })
    if (id === '') return
    setNoteEditor({ id, kind: 'text', value: '', x: clientX, y: clientY })
  }, [onCreateAnnotation, toolColor])

  // A fresh selection wins; a plain click opens the annotation under it (or, with
  // the text-box tool armed, places a box on an empty spot).
  const onMouseUp = useCallback((event: { clientX: number; clientY: number; button: number; target: EventTarget | null }): void => {
    const started = gesture.current
    gesture.current = null
    const browserSelection = window.getSelection()
    if (browserSelection !== null && !browserSelection.isCollapsed) {
      if (activeTool === 'underline') {
        // The underline tool turns a selection straight into a mark: no action bar.
        const described = describeSelection(browserSelection)
        if (described !== null) createMark('underline', toolColor, described.quote, described.page)
        return
      }
      commitSelection(browserSelection)
      return
    }
    setSelection(null)
    const page = pageOfNode(event.target as Node | null, pageRefs.current)
    const clickedId = page === null ? null : highlightAt(page, event.clientX, event.clientY)
    if (clickedId !== null) {
      openNoteEditor(clickedId, event.clientX, event.clientY)
      return
    }
    if (page !== null && event.button === 0 && activeTool === 'text') {
      createTextBox(page, event.clientX, event.clientY)
      return
    }
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
  }, [activeTool, commitSelection, createMark, createTextBox, describeSelection, highlightAt, openNoteEditor, replaySelection, toolColor])

  const selectionAction = useCallback((action: 'quote' | 'explain' | 'translate' | 'copy'): void => {
    if (selection === null) return
    if (action === 'quote') onQuote(selection.quote, selection.page)
    if (action === 'explain') onAsk(selection.quote, selection.page, 'explain')
    if (action === 'translate') onAsk(selection.quote, selection.page, 'translate')
    if (action === 'copy') void navigator.clipboard?.writeText(selection.quote).catch(() => undefined)
    clearSelection()
  }, [clearSelection, onAsk, onQuote, selection])

  /** Create a highlight from the action bar's current selection. */
  const createHighlight = useCallback((color: HighlightColor): void => {
    if (selection === null) return
    createMark('highlight', color, selection.quote, selection.page)
  }, [createMark, selection])

  /**
   * Run a selection-popover action on the press itself, with the press's default
   * prevented so the browser selection being quoted survives the click. The
   * click handler stays for keyboard activation, and a guard keeps a real
   * pointer press from running the same action twice.
   */
  const pressAction = useCallback((run: () => void) => {
    const press = (event: { preventDefault(): void; stopPropagation(): void }): void => {
      event.preventDefault()
      event.stopPropagation()
      if (actionGuard.current) return
      actionGuard.current = true
      run()
      window.setTimeout(() => { actionGuard.current = false }, 0)
    }
    return { onPointerDown: press, onClick: press }
  }, [])

  /**
   * Commit the open editor.
   *
   * A highlight/underline saves its margin note (the previous behaviour). A text
   * box saves its content and deletes itself when that content is empty: an empty
   * box would be an invisible annotation, and the Host drops one as well.
   */
  const saveNote = useCallback((): void => {
    if (noteEditor === null) return
    if (noteEditor.kind === 'text') {
      const value = noteEditor.value.trim()
      if (value === '') {
        onDeleteAnnotation(noteEditor.id)
        setNoteEditor(null)
        return
      }
      onUpdateTextBox(noteEditor.id, value)
      const page = highlightsRef.current.find(annotation => annotation.id === noteEditor.id)?.page
      if (page !== undefined) announce(`${t('textBoxSaved')} p.${page}`)
      setNoteEditor(null)
      return
    }
    onUpdateNote(noteEditor.id, noteEditor.value)
    setNoteEditor(null)
  }, [announce, noteEditor, onDeleteAnnotation, onUpdateNote, onUpdateTextBox, t])

  /**
   * Reveal one stored annotation: scroll it near the top of the pane, not to its
   * page top, and open its editor. A text box's position is a page fraction, so it
   * needs no text layer; a highlight/underline's geometry needs a built layer, so a
   * cold page gets one on demand, with a bounded retry that falls back to the page
   * jump when the quote cannot be located at all.
   */
  const revealAnnotation = useCallback((annotation: Highlight): void => {
    const page = Math.min(Math.max(1, annotation.page), Math.max(1, numPages))
    const openEditor = (): void => {
      const pane = scrollRef.current?.getBoundingClientRect()
      openNoteEditor(annotation.id, (pane?.left ?? 8) + 8, 140)
    }
    const reveal = (): boolean => {
      const scroller = scrollRef.current
      const pageEl = pageRefs.current[page - 1]
      if (scroller === null || pageEl === null || pageEl === undefined) return false
      const top = offsetsRef.current[page - 1] ?? pageEl.offsetTop
      let target: number
      if (annotation.kind === 'text') {
        target = top + clampFraction(annotation.yPct) * pageEl.offsetHeight
      } else {
        const painted = hitRects.current.get(page)?.find(entry => entry.id === annotation.id)
        if (painted === undefined || painted.rects.length === 0) return false
        target = top + painted.rects[0].y
      }
      scroller.scrollTop = Math.max(0, target - HIGHLIGHT_REVEAL_OFFSET)
      if (page !== currentPageRef.current) {
        setCurrentPage(page)
        savePosition(page)
      }
      return true
    }
    setShowNotes(false)
    if (reveal()) {
      openEditor()
      return
    }
    if (annotation.kind === 'text') {
      jumpTo(page)
      openEditor()
      return
    }
    void buildTextLayer(page).then(() => {
      const deadline = performance.now() + HIGHLIGHT_REVEAL_TIMEOUT_MS
      const attempt = (): void => {
        if (reveal()) {
          openEditor()
          return
        }
        if (performance.now() >= deadline) {
          jumpTo(page)
          openEditor()
          return
        }
        window.requestAnimationFrame(attempt)
      }
      window.requestAnimationFrame(attempt)
    })
  }, [buildTextLayer, jumpTo, numPages, openNoteEditor, savePosition])

  /** Build the paper-digest prompt from what the viewer already knows. */
  const buildDigestPrompt = useCallback((): string => {
    const sections = (outline ?? [])
      .map(row => row.title.trim())
      .filter(title => title !== '' && title !== '·')
      .slice(0, DIGEST_SECTION_LIMIT)
    const scanned = cachedOcrPages + (ocrProgress?.done ?? 0) > 0 ? t('digestOcrYes') : t('digestOcrNo')
    const chapters = sections.length > 0 ? sections.join(' / ') : outline === null ? t('digestUnavailable') : t('digestNone')
    return [
      t('digestIntro'),
      '',
      t('digestInfoHead'),
      `${t('digestTitleLabel')}${name === undefined || name.trim() === '' ? t('digestNone') : name.trim()}`,
      `${t('digestPagesLabel')}${numPages > 0 ? String(numPages) : '?'}`,
      `${t('digestSectionsLabel')}${chapters}`,
      `${t('digestOcrLabel')}${scanned}`,
      '',
      t('digestInstructions'),
    ].join('\n')
  }, [cachedOcrPages, name, numPages, ocrProgress, outline, t])

  /**
   * Deliver the digest prompt as one draft mutation, never an auto-send: the
   * user reviews the prompt in the composer. The clipboard is the visible
   * fallback when the conversation composer is not reachable.
   */
  const generateDigest = useCallback((): void => {
    const prompt = buildDigestPrompt()
    let drafted = false
    try {
      drafted = onDigest?.(prompt) === true
    } catch (error) {
      console.warn('[paper-reader] digest delivery failed', error)
      drafted = false
    }
    if (drafted) {
      announce(t('digestSent'))
      return
    }
    const clipboard: Clipboard | undefined = navigator.clipboard
    if (clipboard === undefined || typeof clipboard.writeText !== 'function') {
      announce(t('digestFailed'))
      return
    }
    void clipboard.writeText(prompt).then(
      () => announce(t('digestCopied')),
      () => announce(t('digestFailed')),
    )
  }, [announce, buildDigestPrompt, onDigest, t])

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
      // Character-exact highlight overlay: above the canvas, below the text
      // layer, never interactive (click hit-testing uses the stored rects).
      h('div', { className: 'pr-hl-layer', ref: (element: HTMLDivElement | null): void => { hlRefs.current[index] = element } }),
      h('div', { className: 'pr-text', ref: (element: HTMLDivElement | null): void => { textRefs.current[index] = element } }),
      // Note badges sit above the text layer (only the dots take pointer events),
      // in the right page margin, repainted with the rectangle overlay.
      h('div', { className: 'pr-badge-layer', ref: (element: HTMLDivElement | null): void => { badgeRefs.current[index] = element } }),
      // Text boxes ride above the text layer: a box only takes pointer events over
      // its own area, so the rest of the page stays selectable.
      h('div', { className: 'pr-tb-layer', ref: (element: HTMLDivElement | null): void => { tbRefs.current[index] = element } }),
    )
  }), [numPages, scale, sizes])

  /** The notes list's label for one annotation kind (distinguishable at a glance). */
  const annotationKindLabel = (kind: AnnotationKind): string => {
    if (kind === 'underline') return t('underline')
    if (kind === 'text') return t('textBox')
    return t('highlight')
  }

  /** One notes-list row: kind, page, the anchor text and the margin note when there is one. */
  const annotationRowText = (annotation: Highlight): string => {
    const body = annotation.kind === 'text' ? (annotation.text ?? '') : annotation.quote
    const clipped = body.length > 40 ? `${body.slice(0, 40)}…` : body
    const note = annotation.kind === 'text' || annotation.note === '' ? '' : ` — ${annotation.note}`
    return `${annotationKindLabel(annotation.kind)} · p.${annotation.page} · ${clipped}${note}`
  }

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
      // Annotation tools are exclusive toggles; a second click (or Escape) disarms them.
      h('button', {
        type: 'button', className: 'pr-btn', title: t('underlineHint'),
        'aria-pressed': activeTool === 'underline' ? 'true' : 'false',
        onClick: () => toggleTool('underline'),
      }, t('underline')),
      h('button', {
        type: 'button', className: 'pr-btn', title: t('textBoxHint'),
        'aria-pressed': activeTool === 'text' ? 'true' : 'false',
        onClick: () => toggleTool('text'),
      }, t('textBox')),
      h('button', {
        type: 'button', className: 'pr-btn', title: t('digest'), onClick: generateDigest,
      }, t('digest')),
      h('span', { className: 'pr-spacer' }),
      ocrProgress !== null && h('span', { className: 'pr-ocr', title: t('ocrHint') }, `${t('ocr')} ${ocrProgress.done}/${ocrProgress.total}`),
      h('button', { type: 'button', className: 'pr-btn', title: t('zoomOut'), onClick: () => zoomBy(1 / 1.2) }, '−'),
      h('span', { className: 'pr-num' }, `${currentPage} / ${numPages || '–'}`),
      h('button', { type: 'button', className: 'pr-btn', title: t('zoomIn'), onClick: () => zoomBy(1.2) }, '+'),
      h('button', { type: 'button', className: 'pr-btn', title: t('fitWidth'), onClick: fitWidth }, '⤢'),
      toast !== '' && h('span', { className: 'pr-toast', role: 'status' }, toast),
    ),
    // The underline tool's stroke colour: its own strip, so the toolbar itself
    // does not grow when the palette is shown.
    activeTool === 'underline' && h('div', { className: 'pr-bar pr-color-bar' },
      h('span', { className: 'pr-tool-label' }, t('underline')),
      ...COLORS.map(color => h('button', {
        key: color,
        type: 'button',
        className: 'pr-swatch',
        'data-color': color,
        title: t('underline'),
        'aria-pressed': toolColor === color ? 'true' : 'false',
        onClick: () => setToolColor(color),
      })),
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
      highlights.map(annotation => h('button', {
        key: annotation.id,
        type: 'button',
        className: 'pr-row',
        onClick: () => revealAnnotation(annotation),
      }, annotationRowText(annotation))),
    ),
    h('div', { className: 'pr-pages', ref: scrollRef, onScroll, onMouseUp, onMouseDown },
      status === 'loading' && h('div', { className: 'pr-status' }, t('loading')),
      status === 'error' && h('div', { className: 'pr-status' }, failure),
      // The inner column is `width:max-content`: centered while the pages fit, and
      // a real horizontally scrollable strip of pages when a zoomed page is wider.
      status === 'ready' && h('div', { className: 'pr-pages-inner' }, pageElements),
    ),
    selection !== null && h('div', {
      className: 'pr-sel',
      style: { left: `${selection.x}px`, top: `${selection.y - 10}px` },
      onMouseDown: (event: { preventDefault(): void }) => event.preventDefault(),
    },
      // Eight colours in a 4×2 palette keep the popover compact.
      h('div', { className: 'pr-swatches' },
        ...COLORS.map(color => h('button', {
          key: color,
          type: 'button',
          className: 'pr-swatch',
          'data-color': color,
          title: t('highlight'),
          ...pressAction(() => createHighlight(color)),
        })),
      ),
      h('button', { type: 'button', className: 'pr-btn', ...pressAction(() => selectionAction('quote')) }, t('quoteAction')),
      h('button', { type: 'button', className: 'pr-btn', ...pressAction(() => selectionAction('explain')) }, t('explain')),
      h('button', { type: 'button', className: 'pr-btn', ...pressAction(() => selectionAction('translate')) }, t('translate')),
      h('button', { type: 'button', className: 'pr-btn', ...pressAction(() => selectionAction('copy')) }, t('copy')),
    ),
    noteEditor !== null && h('div', {
      className: 'pr-note',
      style: { left: `${Math.max(8, Math.min(noteEditor.x, window.innerWidth - 240))}px`, top: `${Math.max(8, noteEditor.y - 20)}px` },
    },
      // The same editor serves both bodies: a margin note, or a text box's content.
      noteEditor.kind === 'text' && h('div', { className: 'pr-note-label' }, t('textBoxEditorLabel')),
      h('textarea', {
        className: 'pr-note-input',
        value: noteEditor.value,
        placeholder: noteEditor.kind === 'text' ? t('textBoxPlaceholder') : t('notePlaceholder'),
        autoFocus: true,
        onBlur: () => {
          // Blur commits a text box (empty content deletes it); a margin note keeps
          // its explicit Save/Escape behaviour.
          if (noteEditor.kind === 'text') saveNote()
        },
        onKeyDown: (event: { key: string; currentTarget: { blur(): void } }) => {
          if (event.key !== 'Escape') return
          if (noteEditor.kind === 'text') {
            saveNote()
            return
          }
          event.currentTarget.blur()
          setNoteEditor(null)
        },
        onChange: (event: { currentTarget: { value: string } }) => setNoteEditor({ ...noteEditor, value: event.currentTarget.value }),
      }),
      h('div', {
        className: 'pr-note-actions',
        // Keep focus in the textarea while a button is pressed, so a Save/Delete
        // click does not first trigger the blur commit and unmount its own button.
        onMouseDown: (event: { preventDefault(): void }) => event.preventDefault(),
      },
        h('button', { type: 'button', className: 'pr-btn', onClick: saveNote }, t('noteSave')),
        h('button', {
          type: 'button', className: 'pr-btn',
          onClick: () => { onDeleteAnnotation(noteEditor.id); setNoteEditor(null); dismissToast() },
        }, t('noteDelete')),
      ),
    ),
  )
}
