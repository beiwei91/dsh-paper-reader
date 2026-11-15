/**
 * Annotation vocabulary shared by the Client half and the Host half.
 *
 * The stored document is still `{ key, highlights: [...] }` behind
 * `/paper-reader/api/annotations`; the array name and the route are unchanged for
 * backward compatibility. Each entry is one annotation whose `kind` says what it
 * is:
 *
 *  - `highlight` fills the selected character rectangles (the original kind, and
 *    the value an entry without a `kind` reads as);
 *  - `underline` rules a line under the same character rectangles, with no fill;
 *  - `text` is a small note box placed on the page, anchored by a fraction of the
 *    page's unscaled size instead of by text (so it survives zoom and needs no
 *    text layer).
 *
 * This module has no imports and no platform APIs, so the always-loaded Client
 * bundle, the PDF chunk and the Host bundle can all use it. Keeping the colour
 * list and the sanitiser here is what makes the Client palette and the Host
 * allow-list impossible to drift apart.
 */

/** The annotation kinds, newest last so the original value stays first. */
export const ANNOTATION_KINDS = ['highlight', 'underline', 'text'] as const
export type AnnotationKind = (typeof ANNOTATION_KINDS)[number]

/**
 * The palette, in swatch order. The first four are the original colours and keep
 * their exact rendering; the Host accepts exactly this list.
 */
export const ANNOTATION_COLORS = ['yellow', 'green', 'blue', 'pink', 'orange', 'purple', 'cyan', 'red'] as const
export type AnnotationColor = (typeof ANNOTATION_COLORS)[number]

/** An entry without a `kind` is an old highlight; an unknown colour falls back to yellow. */
export const DEFAULT_ANNOTATION_KIND: AnnotationKind = 'highlight'
export const DEFAULT_ANNOTATION_COLOR: AnnotationColor = 'yellow'

/** Field limits shared by both halves' sanitiser, so one write cannot bloat the file. */
export const MAX_ANNOTATION_ID = 80
export const MAX_ANNOTATION_QUOTE = 2000
export const MAX_ANNOTATION_NOTE = 4000
export const MAX_ANNOTATION_TEXT = 4000

/** One stored annotation, as both halves read and write it. */
export interface StoredAnnotation {
  readonly id: string
  readonly kind: AnnotationKind
  readonly page: number
  readonly color: AnnotationColor
  /** Anchoring text: the selected passage. Empty for a text box. */
  readonly quote: string
  /** The margin note. Empty for a text box (its content is `text`). */
  readonly note: string
  readonly createdAt: number
  /** Text box only: horizontal anchor as a 0–1 fraction of the page's unscaled width. */
  readonly xPct?: number
  /** Text box only: vertical anchor as a 0–1 fraction of the page's unscaled height. */
  readonly yPct?: number
  /** Text box only: the box's own content. */
  readonly text?: string
}

/** Read a stored kind, treating anything unknown (or missing) as a highlight. */
export function annotationKindOf(value: unknown): AnnotationKind {
  return typeof value === 'string' && (ANNOTATION_KINDS as readonly string[]).includes(value)
    ? value as AnnotationKind
    : DEFAULT_ANNOTATION_KIND
}

/** Read a stored colour, falling back to the original yellow. */
export function annotationColorOf(value: unknown): AnnotationColor {
  return typeof value === 'string' && (ANNOTATION_COLORS as readonly string[]).includes(value)
    ? value as AnnotationColor
    : DEFAULT_ANNOTATION_COLOR
}

/** Clamp a page fraction into 0–1; a non-number becomes 0 so a box never flies off the page. */
export function clampFraction(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/**
 * Normalise one stored annotation, or reject it.
 *
 * This is the single migration point for the annotation JSON:
 *  - a missing or unknown `kind` reads as `highlight` (every file written before
 *    the field existed);
 *  - an unknown colour reads as `yellow`;
 *  - a highlight/underline needs a non-empty quote;
 *  - a text box needs a usable anchor in both fractions and non-empty content,
 *    so an abandoned empty box is dropped instead of persisting forever.
 *
 * The Host runs this on every read and every write; the Client runs it again on
 * load, so both halves always agree on one shape.
 */
export function sanitizeStoredAnnotation(value: unknown): StoredAnnotation | null {
  if (value === null || typeof value !== 'object') return null
  const input = value as Record<string, unknown>
  const id = typeof input.id === 'string' && input.id.length <= MAX_ANNOTATION_ID ? input.id : null
  const page = typeof input.page === 'number' && Number.isInteger(input.page) && input.page > 0 ? input.page : null
  if (id === null || page === null) return null
  const kind = annotationKindOf(input.kind)
  const color = annotationColorOf(input.color)
  const note = typeof input.note === 'string' ? input.note.slice(0, MAX_ANNOTATION_NOTE) : ''
  const createdAt = typeof input.createdAt === 'number' && Number.isFinite(input.createdAt) ? input.createdAt : Date.now()
  if (kind === 'text') {
    const anchored = typeof input.xPct === 'number' && Number.isFinite(input.xPct) &&
      typeof input.yPct === 'number' && Number.isFinite(input.yPct)
    const text = typeof input.text === 'string' ? input.text.slice(0, MAX_ANNOTATION_TEXT) : ''
    if (!anchored || text.trim() === '') return null
    return { id, kind, page, color, quote: '', note, createdAt, xPct: clampFraction(input.xPct), yPct: clampFraction(input.yPct), text }
  }
  const quote = typeof input.quote === 'string' ? input.quote.slice(0, MAX_ANNOTATION_QUOTE) : ''
  if (quote === '') return null
  return { id, kind, page, color, quote, note, createdAt }
}
