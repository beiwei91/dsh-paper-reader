/**
 * Highlight geometry on a rendered PDF.js text layer.
 *
 * A highlight is anchored by page and quote text; the text layer is rebuilt on
 * every zoom/render, so its marks are recomputed from the text runs instead of
 * stored DOM. Painting is character-exact: the quote is located in the page's
 * raw run text, the raw range is turned into a DOM Range over the layer's text
 * nodes, and the Range's client rects become one overlay box per line. A whole
 * text run (usually a whole line) is therefore only painted when the selection
 * really covers it.
 *
 * The quote comes from `window.getSelection()`, which is not always the exact
 * text PDF.js laid out: line breaks, hyphenation, ligatures, soft hyphens and
 * punctuation can differ from the runs. Locating a quote therefore falls back
 * from the exact folded match to a punctuation/space-insensitive match, and
 * finally to the longest matchable prefix of the quote.
 */
import type { Highlight } from '../annotations.ts'

/** One page-local overlay box (pixels from the page element's top-left). */
export interface HighlightBox {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/** One highlight's painted geometry on a page. */
export interface PaintedHighlight {
  readonly id: string
  readonly color: string
  readonly rects: readonly HighlightBox[]
}

/** One text node plus its [start, end) range in the page's raw run text. */
interface RawSegment {
  readonly node: Text
  readonly start: number
  readonly end: number
}

/** Case/width/space-folded text, trimmed. Used for quotes, never for indexes. */
function fold(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim()
}

/** Characters that carry no word identity for the loose fallback. */
const NOT_WORD = /[^\p{L}\p{N}]/u
const NOT_WORD_ALL = /[^\p{L}\p{N}]/gu

/** The layer's text in DOM order, split into text nodes with raw offsets. */
function collectRaw(container: HTMLElement): { raw: string; segments: RawSegment[] } {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const segments: RawSegment[] = []
  let raw = ''
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (!(node instanceof Text)) continue
    const value = node.nodeValue ?? ''
    if (value === '') continue
    segments.push({ node, start: raw.length, end: raw.length + value.length })
    raw += value
  }
  return { raw, segments }
}

/** Collapse whitespace for quoting, keeping a map from collapsed to raw offsets. */
function collapse(raw: string): { collapsed: string; indexMap: number[] } {
  const chars: string[] = []
  const indexMap: number[] = []
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]
    const space = /\s/.test(char)
    if (space) {
      if (chars.length === 0 || chars[chars.length - 1] === ' ') continue
      chars.push(' ')
    } else {
      chars.push(char)
    }
    indexMap.push(index)
  }
  return { collapsed: chars.join(''), indexMap }
}

/**
 * Fold the collapsed page string while keeping every folded character's
 * position in that collapsed string, so a match can be mapped back to raw runs.
 */
function foldPage(collapsed: string): { folded: string; toCollapsed: number[] } {
  const chars: string[] = []
  const toCollapsed: number[] = []
  for (let index = 0; index < collapsed.length; index += 1) {
    const folded = collapsed[index].normalize('NFKC').toLowerCase()
    for (const char of folded) {
      chars.push(char)
      toCollapsed.push(index)
    }
  }
  return { folded: chars.join(''), toCollapsed }
}

/**
 * Find the raw-offset range for one quote inside a page's raw run text.
 *
 * Tiers, strongest first: case/width/space-folded exact match, then a looser
 * match that ignores everything but letters and digits (hyphenation, line
 * breaks, punctuation, ligature spacing), then the longest prefix of the quote
 * (at least a few words) that still matches, and only then no match.
 *
 * @param raw - the page's raw run text.
 * @returns the half-open raw range, or null when nothing in the quote matches.
 */
function locate(raw: string, quote: string): { from: number; to: number } | null {
  const { collapsed, indexMap } = collapse(raw)
  const { folded, toCollapsed } = foldPage(collapsed)
  const foldedQuote = fold(quote)
  if (foldedQuote === '' || folded === '') return null

  const spanOf = (from: number, to: number): { from: number; to: number } => {
    const collapsedFrom = toCollapsed[from] ?? 0
    const collapsedTo = (toCollapsed[to - 1] ?? collapsedFrom) + 1
    const rawFrom = indexMap[collapsedFrom] ?? 0
    const rawTo = (indexMap[collapsedTo - 1] ?? rawFrom) + 1
    return { from: rawFrom, to: Math.max(rawTo, rawFrom + 1) }
  }

  const exact = folded.indexOf(foldedQuote)
  if (exact >= 0) return spanOf(exact, exact + foldedQuote.length)

  // Loose tier: fold away everything that is not a letter or digit (on both
  // sides) and map the hit back through the folded page's index map.
  const looseChars: string[] = []
  const looseMap: number[] = []
  for (let index = 0; index < folded.length; index += 1) {
    const char = folded[index]
    if (NOT_WORD.test(char)) continue
    looseChars.push(char)
    looseMap.push(index)
  }
  const looseQuote = foldedQuote.replace(NOT_WORD_ALL, '')
  if (looseQuote !== '') {
    const looseAt = looseChars.join('').indexOf(looseQuote)
    if (looseAt >= 0) return spanOf(looseMap[looseAt] ?? 0, (looseMap[looseAt + looseQuote.length - 1] ?? 0) + 1)
  }

  // Prefix tier: selection and layer may disagree only near one edit (a
  // hyphenation join, a ligature, a dropped line). Keep the longest leading run
  // of the quote that still matches — at least a few words — and mark that.
  const tokens = foldedQuote.split(' ')
  const minimum = Math.max(2, Math.ceil(tokens.length * 0.25))
  for (let count = tokens.length - 1; count >= minimum; count -= 1) {
    const candidate = fold(tokens.slice(0, count).join(' '))
    const at = folded.indexOf(candidate)
    if (at >= 0) return spanOf(at, at + candidate.length)
  }
  return null
}

/** Resolve one raw offset to a (text node, offset) point inside the layer. */
function pointAt(segments: readonly RawSegment[], offset: number): { node: Text; offset: number } | null {
  if (segments.length === 0) return null
  const first = segments[0]
  if (offset <= first.start) return { node: first.node, offset: 0 }
  let low = 0
  let high = segments.length - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    const segment = segments[middle]
    if (offset < segment.start) high = middle - 1
    else if (offset > segment.end) low = middle + 1
    else return { node: segment.node, offset: Math.min(offset - segment.start, segment.end - segment.start) }
  }
  const last = segments[segments.length - 1]
  return { node: last.node, offset: last.end - last.start }
}

/**
 * Compute one page's highlight overlay boxes in page-local coordinates.
 *
 * Only pages whose text layer is built reach this; each highlight costs one
 * Range and one `getClientRects()` call, and a quote that cannot be located is
 * logged and skipped — it still exists in the notes list.
 *
 * @param container - the built `.pr-text` layer of the page.
 * @param pageElement - the `.pr-page` element, for page-local coordinates.
 * @param pageHighlights - the stored highlights of this page, in paint order.
 * @returns the painted geometry of every located highlight.
 */
export function layoutHighlights(
  container: HTMLElement,
  pageElement: HTMLElement,
  pageHighlights: readonly Highlight[],
): PaintedHighlight[] {
  const painted: PaintedHighlight[] = []
  if (pageHighlights.length === 0) return painted
  const { raw, segments } = collectRaw(container)
  if (raw === '' || segments.length === 0) return painted
  const pageRect = pageElement.getBoundingClientRect()
  if (pageRect.width <= 0 || pageRect.height <= 0) return painted

  for (const highlight of pageHighlights) {
    const range = locate(raw, highlight.quote)
    if (range === null) {
      console.warn('[paper-reader] highlight text not found on page', highlight.page, highlight.quote.slice(0, 80))
      continue
    }
    const start = pointAt(segments, range.from)
    const end = pointAt(segments, range.to)
    if (start === null || end === null) continue
    const domRange = document.createRange()
    try {
      domRange.setStart(start.node, start.offset)
      domRange.setEnd(end.node, end.offset)
    } catch (error) {
      console.warn('[paper-reader] highlight range failed', highlight.page, error)
      continue
    }
    const rects: HighlightBox[] = []
    for (const rect of domRange.getClientRects()) {
      // Clip to the page box (the page clips anyway; this keeps hit-testing honest).
      const left = Math.max(rect.left, pageRect.left)
      const top = Math.max(rect.top, pageRect.top)
      const right = Math.min(rect.right, pageRect.right)
      const bottom = Math.min(rect.bottom, pageRect.bottom)
      const w = right - left
      const h = bottom - top
      if (w < 1 || h < 1) continue
      rects.push({ x: left - pageRect.left, y: top - pageRect.top, w, h })
    }
    if (rects.length === 0) continue
    painted.push({ id: highlight.id, color: highlight.color, rects })
  }
  return painted
}
