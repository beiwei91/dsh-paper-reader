/**
 * Painting stored highlights onto a rendered PDF.js text layer.
 *
 * A highlight is anchored by page and quote text. The text layer is rebuilt on
 * every zoom/render, so marks are recomputed from the text runs instead of
 * stored DOM. Matching runs over one whitespace-collapsed page string with an
 * index map back to the raw runs, so a quote crossing run boundaries (where the
 * boundary carries the space) still lands on the right runs.
 */
import type { Highlight } from '../annotations.ts'

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

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
    const quote = normalize(highlight.quote)
    if (quote === '') continue
    const from = text.collapsed.indexOf(quote)
    if (from < 0) continue
    const rawFrom = text.indexMap[from] ?? 0
    const rawTo = (text.indexMap[from + quote.length - 1] ?? rawFrom) + 1
    for (let index = 0; index < spans.length; index += 1) {
      const start = text.starts[index]
      const end = start + (spans[index].textContent ?? '').length
      if (end <= rawFrom || start >= rawTo) continue
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
