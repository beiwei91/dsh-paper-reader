/**
 * Painting stored highlights onto a rendered PDF.js text layer.
 *
 * A highlight is anchored by page and quote text. The text layer is rebuilt on
 * every zoom/render, so marks are recomputed from the text runs instead of
 * stored DOM. Offsets are computed once over one normalised page string so a
 * quote crossing run boundaries still lands on the right runs.
 */
import type { Highlight } from '../annotations.ts'

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** The text runs that carry page text, excluding PDF.js's structural wrappers. */
function textSpans(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('span:not(.markedContent)'))
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
  if (pageHighlights.length === 0) return

  // One normalised page string plus each run's slice of it: a boundary-crossing
  // quote matches here even when it matches no single run.
  const texts = spans.map(span => normalize(span.textContent ?? ''))
  const starts: number[] = []
  let cursor = 0
  for (const text of texts) {
    starts.push(cursor)
    cursor += text.length
  }
  const whole = texts.join('')

  for (const highlight of pageHighlights) {
    const quote = normalize(highlight.quote)
    if (quote === '') continue
    const from = whole.indexOf(quote)
    if (from < 0) continue
    const to = from + quote.length
    for (let index = 0; index < spans.length; index += 1) {
      const start = starts[index]
      const end = start + texts[index].length
      if (texts[index].length === 0 || end <= from || start >= to) continue
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
