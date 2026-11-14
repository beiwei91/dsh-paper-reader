/**
 * PDF text extraction for the agent tools.
 *
 * PDF.js's legacy build is bundled into the Host artifact so the bundle needs no
 * runtime dependency in the profile. Text is extracted once per paper and
 * cached beside the bytes, because a 300-page paper costs seconds to walk.
 */
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { paperPaths, readBytes, readJson, writeJson } from './store.ts'

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
export async function loadPaperText(key: string, signal?: AbortSignal): Promise<PaperText | null> {
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
