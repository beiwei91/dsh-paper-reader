/**
 * Annotated-PDF export: paint the stored annotations onto a copy of the original
 * PDF and hand the result to the browser as a download.
 *
 * This module is reached through `import('./exportPdf.ts')` from the reader's
 * export button, so pdf-lib and its bundled dependencies execute only when a user
 * actually exports — the PDF chunk itself stays as lazy as before.
 *
 * Geometry. The reader measures every annotated page off-screen: it rebuilds the
 * page's text layer at scale 1 and runs the same character-exact matcher the
 * on-screen overlay uses (`marks.ts`), then supplies the boxes in page-local CSS
 * pixels plus the page's PDF.js viewport transform. At scale 1 one CSS pixel is
 * one PDF point, and `toPdf` is the only conversion: it maps the viewer's
 * top-left origin to the PDF's bottom-left user space and applies the page
 * rotation. Highlight/underline boxes therefore become PDF-space rectangles
 * directly (page rotations are multiples of 90°, so a rotated rectangle stays
 * axis-aligned); a text box image is drawn with the same rotation.
 *
 * Text boxes are rasterised with the page's UI font stack (canvas → PNG), never
 * with pdf-lib's standard fonts, which cannot draw CJK. The browser's own font
 * fallback supplies the CJK glyphs.
 *
 * Saving is a browser download only: no Host route, no write, no network.
 */
import { PDFDocument, degrees, rgb } from 'pdf-lib'
import { clampFraction } from '../../shared/annotationModel.ts'
import type { Highlight, HighlightColor } from '../annotations.ts'
import type { HighlightBox } from './marks.ts'

/**
 * One point in PDF user space (the coordinate system page content operators
 * use: origin at the page's bottom-left, y growing upwards).
 */
export interface PdfPoint {
  readonly x: number
  readonly y: number
}

/** One annotated page's geometry, as measured by the reader. */
export interface MeasuredPage {
  /** Normalised page rotation in degrees (0, 90, 180 or 270). */
  readonly rotation: number
  /** On-screen page size at scale 1, in CSS pixels (= PDF points). */
  readonly width: number
  readonly height: number
  /** Map one page-local point (top-left origin, scale 1) to PDF user space. */
  toPdf(x: number, y: number): PdfPoint
  /** Painted quote boxes per annotation id, in page-local pixels at scale 1. */
  readonly boxes: ReadonlyMap<string, readonly HighlightBox[]>
}

/** Why an export stopped, so the reader can localise the message. */
export type PdfExportErrorCode = 'empty' | 'encrypted' | 'load' | 'canvas' | 'save'

/** A failed export, tagged with a stable code the reader turns into copy. */
export class PdfExportError extends Error {
  readonly code: PdfExportErrorCode

  constructor(code: PdfExportErrorCode, message: string) {
    super(message)
    this.name = 'PdfExportError'
    this.code = code
  }
}

export interface ExportPdfOptions {
  /** The original PDF bytes the viewer already holds. */
  readonly bytes: Uint8Array<ArrayBuffer>
  /** The paper's display name, used for the download file name. */
  readonly name?: string
  /** Every stored annotation of the paper, all kinds. */
  readonly annotations: readonly Highlight[]
  /** Measure one page; `withText` asks for quote-anchor geometry (a text layer). */
  readonly measurePage: (page: number, withText: boolean) => Promise<MeasuredPage>
  /** CSS font-family stack of the reading surface, for rasterised text boxes. */
  readonly fontFamily: string
  /** Called once per annotated page, for the reader's toast. */
  readonly onProgress?: (done: number, total: number) => void
}

export interface ExportPdfResult {
  readonly fileName: string
  readonly bytes: Uint8Array<ArrayBuffer>
  /** Annotated pages that were written. */
  readonly pages: number
  /** Highlight/underline annotations drawn. */
  readonly marks: number
  /** Text-box annotations rasterised and drawn. */
  readonly textBoxes: number
}

/**
 * The on-screen palette, copied from `styles.ts` (`.pr-hl-rect` fills and
 * `.pr-hl-line` accents). PDF viewers paint page content on white, which is what
 * the CSS `rgba()` colours are composited over too, so the same rgb + alpha gives
 * the same visible tint. Keep both lists in step when the palette changes.
 */
const HIGHLIGHT_FILL: Record<HighlightColor, { readonly r: number; readonly g: number; readonly b: number; readonly alpha: number }> = {
  yellow: { r: 255, g: 214, b: 0, alpha: 0.35 },
  green: { r: 56, g: 200, b: 120, alpha: 0.35 },
  blue: { r: 80, g: 150, b: 255, alpha: 0.32 },
  pink: { r: 255, g: 120, b: 180, alpha: 0.35 },
  orange: { r: 255, g: 160, b: 40, alpha: 0.35 },
  purple: { r: 168, g: 120, b: 255, alpha: 0.35 },
  cyan: { r: 60, g: 200, b: 220, alpha: 0.35 },
  red: { r: 240, g: 80, b: 80, alpha: 0.32 },
}

/** The dark accent shades the reader rules under glyphs, one per swatch. */
const UNDERLINE_ACCENT: Record<HighlightColor, { readonly r: number; readonly g: number; readonly b: number }> = {
  yellow: { r: 201, g: 161, b: 0 },
  green: { r: 39, g: 153, b: 90 },
  blue: { r: 59, g: 123, b: 216 },
  pink: { r: 212, g: 86, b: 140 },
  orange: { r: 217, g: 122, b: 18 },
  purple: { r: 124, g: 83, b: 214 },
  cyan: { r: 21, g: 150, b: 168 },
  red: { r: 201, g: 43, b: 43 },
}

/** Underline stroke in PDF points: the on-screen 2 px stroke at scale 1. */
const UNDERLINE_THICKNESS = 2

/** Text-box look, matching `.pr-tb` closely enough to read as the same box. */
const TEXT_BOX_FONT_SIZE = 11
const TEXT_BOX_LINE_HEIGHT = 1.4
const TEXT_BOX_PADDING_X = 6
const TEXT_BOX_PADDING_Y = 4
const TEXT_BOX_BORDER = 1
const TEXT_BOX_RADIUS = 5
const TEXT_BOX_MAX_WIDTH_FRACTION = 0.4
const TEXT_BOX_FILL = '#f4f6f8'
const TEXT_BOX_EDGE = '#b9c0c9'
const TEXT_BOX_INK = '#1f2328'
/** PNG pixels per PDF point: 3× keeps 11 pt text crisp when zoomed in a viewer. */
const TEXT_BOX_PIXELS_PER_POINT = 3
/** A text box anchors at its page fraction and grows inward past these fractions. */
const TEXT_BOX_ANCHOR_X = 0.6
const TEXT_BOX_ANCHOR_Y = 0.75

function toRgb(color: { readonly r: number; readonly g: number; readonly b: number }): ReturnType<typeof rgb> {
  return rgb(color.r / 255, color.g / 255, color.b / 255)
}

/** One box as a PDF-space rectangle, whichever way the page is rotated. */
function pdfRect(
  measured: MeasuredPage,
  x: number,
  y: number,
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } {
  const first = measured.toPdf(x, y)
  const second = measured.toPdf(x + width, y + height)
  return {
    x: Math.min(first.x, second.x),
    y: Math.min(first.y, second.y),
    width: Math.abs(second.x - first.x),
    height: Math.abs(second.y - first.y),
  }
}

interface RasterTextBox {
  readonly bytes: Uint8Array
  /** Logical size in PDF points (the PNG is `TEXT_BOX_PIXELS_PER_POINT`× larger). */
  readonly width: number
  readonly height: number
}

/** Greedy line wrapping that breaks at spaces when it can and anywhere for CJK. */
function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    const characters = Array.from(paragraph)
    let line = ''
    let index = 0
    while (index < characters.length) {
      const character = characters[index]
      if (line !== '' && context.measureText(line + character).width > maxWidth) {
        const space = line.lastIndexOf(' ')
        if (character !== ' ' && space > 0) {
          lines.push(line.slice(0, space).trimEnd())
          line = line.slice(space + 1).trimStart()
          continue
        }
        lines.push(line.trimEnd())
        line = ''
        continue
      }
      line += character
      index += 1
    }
    lines.push(line.trimEnd())
  }
  return lines
}

/** A rounded rectangle path on a 2D canvas (border centred on the edge). */
function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2))
  context.beginPath()
  context.moveTo(x + r, y)
  context.lineTo(x + width - r, y)
  context.arcTo(x + width, y, x + width, y + r, r)
  context.lineTo(x + width, y + height - r)
  context.arcTo(x + width, y + height, x + width - r, y + height, r)
  context.lineTo(x + r, y + height)
  context.arcTo(x, y + height, x, y + height - r, r)
  context.lineTo(x, y + r)
  context.arcTo(x, y, x + r, y, r)
  context.closePath()
}

/**
 * Draw one text-box annotation into an offscreen canvas and encode it as PNG.
 *
 * The canvas uses the reading surface's font stack so Chinese renders through
 * the browser's normal system-font fallback (chromium shapes CJK in canvas the
 * same way it does in the DOM). The text is laid out at 11 pt in page units and
 * supersampled 3×; pdf-lib embeds the PNG with its alpha preserved.
 */
async function rasterizeTextBox(text: string, fontFamily: string, pageWidth: number): Promise<RasterTextBox> {
  const hasCanvas = typeof document !== 'undefined' && typeof document.createElement === 'function'
  if (!hasCanvas) throw new PdfExportError('canvas', 'canvas is unavailable in this environment')
  const stack = fontFamily.trim() === '' ? 'system-ui, sans-serif' : fontFamily
  const maxContentWidth = Math.max(
    TEXT_BOX_FONT_SIZE * 4,
    pageWidth * TEXT_BOX_MAX_WIDTH_FRACTION - 2 * (TEXT_BOX_PADDING_X + TEXT_BOX_BORDER),
  )
  const measureCanvas = document.createElement('canvas')
  const measureContext = measureCanvas.getContext('2d')
  if (measureContext === null) throw new PdfExportError('canvas', 'a 2d canvas context is unavailable')
  measureContext.font = `${TEXT_BOX_FONT_SIZE}px ${stack}`
  const lines = wrapText(measureContext, text, maxContentWidth)
  let contentWidth = 0
  for (const line of lines) contentWidth = Math.max(contentWidth, measureContext.measureText(line).width)
  const width = Math.max(
    TEXT_BOX_FONT_SIZE + 2 * (TEXT_BOX_PADDING_X + TEXT_BOX_BORDER),
    Math.ceil(contentWidth) + 2 * (TEXT_BOX_PADDING_X + TEXT_BOX_BORDER),
  )
  const height = Math.max(
    Math.ceil(TEXT_BOX_FONT_SIZE * TEXT_BOX_LINE_HEIGHT) + 2 * (TEXT_BOX_PADDING_Y + TEXT_BOX_BORDER),
    Math.ceil(lines.length * TEXT_BOX_FONT_SIZE * TEXT_BOX_LINE_HEIGHT) + 2 * (TEXT_BOX_PADDING_Y + TEXT_BOX_BORDER),
  )

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(width * TEXT_BOX_PIXELS_PER_POINT))
  canvas.height = Math.max(1, Math.ceil(height * TEXT_BOX_PIXELS_PER_POINT))
  const context = canvas.getContext('2d')
  if (context === null) throw new PdfExportError('canvas', 'a 2d canvas context is unavailable')
  context.scale(TEXT_BOX_PIXELS_PER_POINT, TEXT_BOX_PIXELS_PER_POINT)
  roundedRect(context, 0.5, 0.5, width - 1, height - 1, TEXT_BOX_RADIUS)
  context.fillStyle = TEXT_BOX_FILL
  context.fill()
  context.strokeStyle = TEXT_BOX_EDGE
  context.lineWidth = TEXT_BOX_BORDER
  context.stroke()
  context.fillStyle = TEXT_BOX_INK
  context.font = `${TEXT_BOX_FONT_SIZE}px ${stack}`
  context.textBaseline = 'top'
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line === '') continue
    context.fillText(line, TEXT_BOX_PADDING_X + TEXT_BOX_BORDER, TEXT_BOX_PADDING_Y + TEXT_BOX_BORDER + index * TEXT_BOX_FONT_SIZE * TEXT_BOX_LINE_HEIGHT)
  }

  const blob = await new Promise<Blob | null>(resolve => { canvas.toBlob(resolve, 'image/png') })
  if (blob === null) throw new PdfExportError('canvas', 'the text box could not be rendered to PNG')
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height }
}

/** The name the browser downloads: `<paper>.annotated.pdf` (or `annotated.pdf`). */
export function annotatedFileName(name: string | undefined): string {
  const base = (name ?? '')
    .trim()
    .replace(/\.pdf$/iu, '')
    // A download name must be a single path segment on every platform.
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/gu, '-')
    .trim()
  return base === '' ? 'annotated.pdf' : `${base}.annotated.pdf`
}

/**
 * Deliver the generated bytes as a browser download.
 *
 * The object URL is revoked on a later turn: revoking in the same task can abort
 * the download before the browser has claimed the blob.
 */
export function downloadPdf(bytes: Uint8Array, fileName: string): void {
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.style.display = 'none'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => { URL.revokeObjectURL(url) }, 10_000)
}

/**
 * Write every annotation of the paper onto a copy of the original PDF.
 *
 * Pages are handled in ascending order and one at a time: each quote-anchored
 * page needs its text layer rebuilt by the reader, and rasterising a text box is
 * main-thread canvas work, so a page-at-a-time loop keeps the tab responsive
 * between pages (and lets the toast show progress).
 */
export async function exportAnnotatedPdf(options: ExportPdfOptions): Promise<ExportPdfResult> {
  const { annotations, bytes, fontFamily, measurePage, name, onProgress } = options
  if (annotations.length === 0) throw new PdfExportError('empty', 'there are no annotations to export')

  let document: PDFDocument
  try {
    document = await PDFDocument.load(bytes)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // pdf-lib throws `EncryptedPDFError`; it cannot decrypt content streams, and a
    // copy with unreadable pages would be worse than a clear refusal.
    if (/encrypt/iu.test(message)) throw new PdfExportError('encrypted', message)
    throw new PdfExportError('load', message)
  }

  const byPage = new Map<number, Highlight[]>()
  for (const annotation of annotations) {
    const pageAnnotations = byPage.get(annotation.page)
    if (pageAnnotations === undefined) byPage.set(annotation.page, [annotation])
    else pageAnnotations.push(annotation)
  }
  const pages = [...byPage.entries()].sort(([left], [right]) => left - right)
  const pdfPages = document.getPages()
  let done = 0
  let marks = 0
  let textBoxes = 0

  for (const [pageNumber, pageAnnotations] of pages) {
    const pdfPage = pdfPages[pageNumber - 1]
    if (pdfPage === undefined) continue
    const quoteAnnotations = pageAnnotations.filter(annotation => annotation.kind !== 'text')
    const measured = await measurePage(pageNumber, quoteAnnotations.length > 0)

    for (const annotation of pageAnnotations) {
      if (annotation.kind === 'text') continue
      const boxes = measured.boxes.get(annotation.id)
      if (boxes === undefined) {
        // The quote no longer occurs on the page's text layer (e.g. an OCR-only
        // page); the mark still exists in the notes list, so say so rather than
        // silently exporting a shorter mark set.
        console.warn('[paper-reader] export skipped an unlocated mark', annotation.page, annotation.id)
        continue
      }
      if (annotation.kind === 'underline') {
        const color = toRgb(UNDERLINE_ACCENT[annotation.color])
        for (const box of boxes) {
          pdfPage.drawLine({
            start: measured.toPdf(box.x, box.bottom),
            end: measured.toPdf(box.x + box.w, box.bottom),
            thickness: UNDERLINE_THICKNESS,
            color,
          })
        }
      } else {
        const fill = HIGHLIGHT_FILL[annotation.color]
        for (const box of boxes) {
          const rect = pdfRect(measured, box.x, box.y, box.w, box.h)
          pdfPage.drawRectangle({ ...rect, color: toRgb(fill), opacity: fill.alpha, borderWidth: 0 })
        }
      }
      marks += 1
    }

    for (const annotation of pageAnnotations) {
      if (annotation.kind !== 'text') continue
      const text = (annotation.text ?? '').trim()
      if (text === '') continue
      const raster = await rasterizeTextBox(text, fontFamily, measured.width)
      const image = await document.embedPng(raster.bytes)
      const xPct = clampFraction(annotation.xPct)
      const yPct = clampFraction(annotation.yPct)
      const left = xPct > TEXT_BOX_ANCHOR_X ? xPct * measured.width - raster.width : xPct * measured.width
      const top = yPct > TEXT_BOX_ANCHOR_Y ? yPct * measured.height - raster.height : yPct * measured.height
      // Keep the whole box on the page, exactly like the on-screen layer's clamp.
      const clampedLeft = Math.min(Math.max(0, left), Math.max(0, measured.width - raster.width))
      const clampedTop = Math.min(Math.max(0, top), Math.max(0, measured.height - raster.height))
      // The image's own bottom-left anchor; with the page rotation the image then
      // appears upright and in the same place the reader shows the box.
      const anchor = measured.toPdf(clampedLeft, clampedTop + raster.height)
      pdfPage.drawImage(image, {
        x: anchor.x,
        y: anchor.y,
        width: raster.width,
        height: raster.height,
        rotate: degrees(measured.rotation),
      })
      textBoxes += 1
    }

    done += 1
    onProgress?.(done, pages.length)
    // Let the toolbar toast repaint between pages of a long paper.
    await new Promise<void>(resolve => { window.setTimeout(resolve, 0) })
  }

  let output: Uint8Array
  try {
    output = await document.save()
  } catch (error) {
    throw new PdfExportError('save', error instanceof Error ? error.message : String(error))
  }
  return {
    fileName: annotatedFileName(name),
    bytes: output as Uint8Array<ArrayBuffer>,
    pages: done,
    marks,
    textBoxes,
  }
}
