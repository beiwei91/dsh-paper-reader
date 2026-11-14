/**
 * Turning PDF pages into OCR input, in the reader's page.
 *
 * Two cheap jobs live here, both driven by `ocr/queue.ts`:
 *  - `pageTextLength` counts the visible characters of a page's text layer, the
 *    test for "this page is a scan" (a scanned page has no text items at all).
 *  - `renderPagePng` rasterises a page at a fixed OCR scale on a canvas that is
 *    never attached to the document, so the OCR bitmap never touches the
 *    reader's own page canvases.
 *
 * No text layer is built from OCR text: OCR only feeds search, translation and
 * the agent tools through the Host's text cache.
 */

/** Fixed scale for OCR bitmaps: ~150 DPI for a letter-size page, independent of zoom. */
export const OCR_SCALE = 2
/** A page with fewer visible characters than this is treated as scanned. */
export const OCR_MIN_CHARS = 20
/** Upper bound on the OCR bitmap; a huge/oversized page is downscaled to fit. */
const OCR_MAX_PIXELS = 4_000_000
const MAX_CANVAS_DIM = 16384

interface OcrViewport {
  readonly width: number
  readonly height: number
}

interface OcrPage {
  getViewport(params: { scale: number }): OcrViewport
  getTextContent(): Promise<{ items: readonly unknown[] }>
  render(params: { canvas: HTMLCanvasElement; viewport: OcrViewport; annotationMode?: number }): {
    readonly promise: Promise<void>
    cancel(): void
  }
}

/** The part of the PDF.js document this module needs. */
export interface OcrDocument {
  getPage(pageNumber: number): Promise<unknown>
}

function visibleChars(items: readonly unknown[]): number {
  let count = 0
  for (const item of items) {
    const text = (item as { str?: unknown }).str
    if (typeof text !== 'string') continue
    count += text.replace(/\s+/g, '').length
  }
  return count
}

/** Count the visible characters of one page's text layer (0 for a scan). */
export async function pageTextLength(doc: OcrDocument, pageNumber: number): Promise<number> {
  // No page.cleanup() here: PDFPageProxy.cleanup() triggers document-wide
  // resource cleanup and is not safe to interleave with the reader's painting.
  const page = (await doc.getPage(pageNumber)) as OcrPage
  return visibleChars((await page.getTextContent()).items)
}

function blobOf(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise(resolve => {
    if (typeof canvas.toBlob !== 'function') {
      resolve(null)
      return
    }
    canvas.toBlob(blob => resolve(blob), 'image/png')
  })
}

/**
 * Rasterise one page to PNG bytes for OCR. Returns null when the page could not
 * be rendered, including when the caller aborted (tab unmount / paper change).
 */
export async function renderPagePng(
  doc: OcrDocument,
  pageNumber: number,
  signal: AbortSignal,
): Promise<Blob | null> {
  const page = (await doc.getPage(pageNumber)) as OcrPage
  let canvas: HTMLCanvasElement | null = null
  try {
    const base = page.getViewport({ scale: OCR_SCALE })
    let scale = OCR_SCALE
    const area = base.width * base.height
    if (area > OCR_MAX_PIXELS) scale = OCR_SCALE * Math.sqrt(OCR_MAX_PIXELS / area)
    const viewport = page.getViewport({ scale })
    if (viewport.width > MAX_CANVAS_DIM || viewport.height > MAX_CANVAS_DIM) return null
    canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.floor(viewport.width))
    canvas.height = Math.max(1, Math.floor(viewport.height))
    const task = page.render({ canvas, viewport, annotationMode: 0 })
    const onAbort = (): void => task.cancel()
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      await task.promise
    } catch {
      return null
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
    if (signal.aborted) return null
    return await blobOf(canvas)
  } catch {
    return null
  } finally {
    if (canvas !== null) {
      canvas.width = 0
      canvas.height = 0
    }
  }
}
