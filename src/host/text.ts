/**
 * PDF text extraction for the agent tools.
 *
 * PDF.js's legacy build is bundled into the Host artifact so the bundle needs no
 * runtime dependency in the profile. Text is extracted once per paper and
 * cached beside the bytes, because a 300-page paper costs seconds to walk.
 */
// Must evaluate before PDF.js so its Node-canvas import warnings stay out of the
// Host log; it restores `console.warn` on the next microtask.
import './pdfjsQuiet.ts'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { paperPaths, readBytes, readJson, writeJson } from './store.ts'

// The bundled artifact lives in lib/, and the worker ships beside it: PDF.js's
// fake worker in Node imports this file URL instead of spawning a real worker.
GlobalWorkerOptions.workerSrc = new URL('./pdf.worker.mjs', import.meta.url).href

export interface OutlineEntry {
  readonly title: string
  readonly page: number | null
  readonly depth: number
}

export interface PaperText {
  readonly numPages: number
  readonly title: string
  readonly pages: readonly string[]
  readonly outline: readonly OutlineEntry[]
  /**
   * Pages whose text came (or was attempted) from OCR. Present once the reader
   * has OCR'd anything; older caches simply lack the field.
   */
  readonly ocrPages?: readonly number[]
}

type PdfDocument = Awaited<ReturnType<typeof getDocument>['promise']>

interface OutlineNode {
  readonly title: string
  readonly dest: unknown
  readonly items?: readonly OutlineNode[]
}

async function flattenOutline(doc: PdfDocument, nodes: readonly OutlineNode[], depth: number, out: OutlineEntry[]): Promise<void> {
  for (const node of nodes) {
    let page: number | null = null
    try {
      let dest: unknown = node.dest
      if (typeof dest === 'string') dest = await doc.getDestination(dest)
      if (Array.isArray(dest) && dest.length > 0 && typeof dest[0] === 'object' && dest[0] !== null) {
        page = (await doc.getPageIndex(dest[0] as Parameters<PdfDocument['getPageIndex']>[0])) + 1
      }
    } catch {
      page = null
    }
    out.push({ title: node.title || '·', page, depth })
    if (node.items !== undefined && node.items.length > 0) await flattenOutline(doc, node.items, depth + 1, out)
  }
}

/** Extract (or read the cached) text of one paper. */
export function loadPaperText(key: string, signal?: AbortSignal): Promise<PaperText | null> {
  // OCR merges and tool extractions share one cache file, so they take turns.
  return withTextLock(key, () => loadPaperTextUnlocked(key, signal))
}

/** One paper's cache mutations in flight, so two writers never interleave. */
const textLocks = new Map<string, Promise<unknown>>()

function withTextLock<T>(key: string, run: () => Promise<T>): Promise<T> {
  const previous = textLocks.get(key) ?? Promise.resolve()
  const result = previous.then(run, run)
  const tail = result.then(() => undefined, () => undefined)
  textLocks.set(key, tail)
  void tail.then(() => {
    if (textLocks.get(key) === tail) textLocks.delete(key)
  })
  return result
}

async function loadPaperTextUnlocked(key: string, signal?: AbortSignal): Promise<PaperText | null> {
  const paths = paperPaths(key)
  const cached = await readJson<PaperText>(paths.text)
  if (cached !== null && Array.isArray(cached.pages)) return cached
  const bytes = await readBytes(paths.pdf)
  if (bytes === null) return null
  const task = getDocument({ data: bytes, useSystemFonts: false })
  try {
    const doc = await task.promise
    const pages: string[] = []
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      if (signal?.aborted === true) return null
      const page = await doc.getPage(pageNumber)
      const content = await page.getTextContent()
      pages.push(content.items.map(item => ('str' in item ? item.str : '')).join(' '))
      page.cleanup()
    }
    const outline: OutlineEntry[] = []
    let metadata: { info?: { Title?: string }; metadata?: { get(name: string): unknown } | null } | null = null
    try {
      metadata = await doc.getMetadata()
    } catch {
      metadata = null
    }
    const title =
      typeof metadata?.info?.Title === 'string' && metadata.info.Title.trim() !== ''
        ? metadata.info.Title.trim()
        : ''
    await flattenOutline(doc, ((await doc.getOutline()) ?? []) as unknown as readonly OutlineNode[], 0, outline)
    const text: PaperText = { numPages: doc.numPages, title, pages, outline }
    await writeJson(paths.text, text)
    return text
  } finally {
    void task.destroy()
  }
}

export interface OcrMergeResult {
  readonly text: string
  readonly numPages: number
  readonly ocrPages: readonly number[]
}

/**
 * Merge one OCR'd page into the paper's text cache, creating the cache first if
 * the agent tools never asked for it. An OCR run that produced no text still
 * marks the page, so a blank scan is not re-recognised on every open.
 */
export function mergeOcrPage(key: string, page: number, text: string): Promise<OcrMergeResult | null> {
  return withTextLock(key, async () => {
    const paper = await loadPaperTextUnlocked(key)
    if (paper === null) return null
    if (!Number.isInteger(page) || page < 1 || page > paper.numPages) return null
    const pages = [...paper.pages]
    const trimmed = text.trim()
    if (trimmed !== '') pages[page - 1] = trimmed
    const ocrPages = [...new Set([...(paper.ocrPages ?? []), page])].sort((left, right) => left - right)
    await writeJson(paperPaths(key).text, { ...paper, pages, ocrPages })
    return { text: pages[page - 1] ?? '', numPages: paper.numPages, ocrPages }
  })
}
