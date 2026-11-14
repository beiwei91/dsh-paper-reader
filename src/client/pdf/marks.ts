/**
 * Painting stored highlights onto a rendered PDF.js text layer.
 *
 * A highlight is anchored by page and quote text. The text layer is rebuilt on
 * every zoom/render, so marks are recomputed from the text runs instead of
 * stored DOM. Matching runs over one whitespace-collapsed page string with an
 * index map back to the raw runs, so a quote crossing run boundaries (where the
 * boundary carries the space) still lands on the right runs.
 *
 * The quote comes from `window.getSelection()`, which is not always the exact
 * text PDF.js laid out: line breaks, hyphenation, ligatures, soft hyphens and
 * punctuation can differ from the runs. Matching therefore falls back from the
 * exact folded match to a punctuation/space-insensitive match, and finally to
 * the longest matchable prefix of the quote, so a highlight is not lost just
 * because the selection and the layer disagree about one character.
 */
import type { Highlight } from '../annotations.ts'

/** Case/width/space-folded text, trimmed. Used for quotes, never for indexes. */
function fold(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim()
}

/** Characters that carry no word identity for the loose fallback. */
const NOT_WORD = /[^\p{L}\p{N}]/u
const NOT_WORD_ALL = /[^\p{L}\p{N}]/gu

/** The text runs that carry page text, excluding PDF.js's structural wrappers. */
function textSpans(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('span:not(.markedContent)'))
}

/** The page's runs plus one collapsed string and a map from its indices to raw offsets. */
function pageText(spans: readonly HTMLElement[]): { raw: string; starts: number[]; collapsed: string; indexMap: number[] } {
  const rawSpans = spans.map(span => span.textContent ?? '')
  const starts: number[] = []
  let offset = 0
  for (const text of rawSpans) {
    starts.push(offset)
    offset += text.length
  }
  const raw = rawSpans.join('')
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
  return { raw, starts, collapsed: chars.join(''), indexMap }
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
 * Find the best raw-offset range for one quote inside a page's collapsed text.
 *
 * Tiers, strongest first: case/width/space-folded exact match, then a looser
 * match that ignores everything but letters and digits (hyphenation, line
 * breaks, punctuation, ligature spacing), then the longest prefix of the quote
 * (at least a few words) that still matches, and only then no match.
 *
 * @returns the raw offset range, or null when nothing in the quote can be located.
 */
function locate(text: ReturnType<typeof pageText>, quote: string): { from: number; to: number } | null {
  const { folded, toCollapsed } = foldPage(text.collapsed)
  const foldedQuote = fold(quote)
  if (foldedQuote === '' || folded === '') return null

  const spanOf = (from: number, to: number): { from: number; to: number } => {
    const collapsedFrom = toCollapsed[from] ?? 0
    const collapsedTo = (toCollapsed[to - 1] ?? collapsedFrom) + 1
    const rawFrom = text.indexMap[collapsedFrom] ?? 0
    const rawTo = (text.indexMap[collapsedTo - 1] ?? rawFrom) + 1
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

/** Remove every mark and rebuild the page's highlights. */
export function paintHighlights(container: HTMLElement, page: number, highlights: readonly Highlight[]): void {
  const spans = textSpans(container)
  for (const span of spans) {
    span.classList.remove('pr-hl')
    span.removeAttribute('data-color')
    span.removeAttribute('data-hl')
  }
  const pageHighlights = highlights.filter(highlight => highlight.page === page)
  if (pageHighlights.length === 0 || spans.length === 0) return

  const text = pageText(spans)
  for (const highlight of pageHighlights) {
    const quote = highlight.quote
    if (fold(quote) === '') continue
    const range = locate(text, quote)
    if (range === null) {
      console.warn('[paper-reader] highlight text not found on page', page, quote.slice(0, 80))
      continue
    }
    for (let index = 0; index < spans.length; index += 1) {
      const start = text.starts[index]
      const end = start + (spans[index].textContent ?? '').length
      if (end <= range.from || start >= range.to) continue
      const span = spans[index]
      span.classList.add('pr-hl')
      span.setAttribute('data-color', highlight.color)
      const previous = span.getAttribute('data-hl')
      span.setAttribute('data-hl', previous === null ? highlight.id : `${previous},${highlight.id}`)
    }
  }
}

/** The highlight ids under a click target, if any. */
export function highlightIdsOf(target: EventTarget | null): string[] {
  if (!(target instanceof Element)) return []
  const span = target.closest('span[data-hl]')
  const value = span instanceof HTMLElement ? span.dataset.hl : undefined
  return value === undefined || value === '' ? [] : value.split(',')
}
