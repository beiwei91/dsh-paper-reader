/**
 * Background OCR queue for scanned pages.
 *
 * The reader feeds this scheduler pages that have no text layer; the scheduler
 * rasterises them (through `raster.ts`) one at a time, only while the reader has
 * been idle for a while, and posts each PNG to the Host's `/ocr` route, which
 * runs tesseract and merges the text into the paper's text cache.
 *
 * Constraints this file exists to enforce:
 *  - at most one rasterisation/OCR request in flight, so the main thread never
 *    queues several page paints at once (the panel froze that way before);
 *  - nothing starts while the user is scrolling or while the tab is hidden;
 *  - the queue is bounded, and the page under the reader is always first;
 *  - stopping (tab unmount, paper change) aborts the request and the render.
 */

import { OCR_MIN_CHARS } from './raster.ts'

export interface OcrProgress {
  /** Pages whose OCR text was stored by the Host in this reader session. */
  readonly done: number
  /** Pages discovered as scanned so far (grows if the queue refills). */
  readonly total: number
}

export interface OcrSchedulerDeps {
  readonly numPages: number
  /** Host key of the open paper: the OCR route and its text cache are keyed by it. */
  readonly storageKey: string
  /** Pages the Host already OCR'd (its cache reports them), so never send them again. */
  readonly alreadyOcred: ReadonlySet<number>
  /** Text the reader already knows for a page: its text layer output or earlier OCR. */
  getCachedText(page: number): string | null
  /** Visible character count of the page's PDF text layer. */
  probeText(page: number): Promise<number>
  /** Rasterise one page for OCR; null when cancelled or unrenderable. */
  renderPage(page: number, signal: AbortSignal): Promise<Blob | null>
  /** New OCR text of a page, merged into the reader's search cache. */
  onText(page: number, text: string): void
  /** null when there is nothing to show. */
  onProgress(progress: OcrProgress | null): void
  onError?(error: unknown): void
}

export interface OcrScheduler {
  start(): void
  stop(): void
  /** Reorder the remaining work around the page the reader is looking at. */
  setCurrentPage(page: number): void
  /** The reader scrolled/zoomed; hold OCR until it is still again. */
  noteActivity(): void
}

/** Pages queued at once; a scan never turns into an unbounded background job. */
export const OCR_QUEUE_LIMIT = 30
const IDLE_QUIET_MS = 700
const MAX_CONSECUTIVE_FAILURES = 3
const NO_BYTES_RETRY_MS = 1500
const NO_BYTES_MAX_ATTEMPTS = 4
const API = '/paper-reader/api/ocr'

/** A page whose OCR request raced the paper's bytes upload. */
class NoBytesError extends Error {
  constructor() {
    super('no-paper-bytes')
    this.name = 'NoBytesError'
  }
}

function requestIdle(): Promise<void> {
  return new Promise(resolve => {
    const ric = (window as unknown as {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
    }).requestIdleCallback
    if (typeof ric === 'function') ric(() => resolve(), { timeout: 800 })
    else window.setTimeout(resolve, 120)
  })
}

export function createOcrScheduler(deps: OcrSchedulerDeps): OcrScheduler {
  const decided = new Set<number>()
  const attempts = new Map<number, number>()
  const controller = new AbortController()
  let pending: number[] = []
  let needFill = true
  let currentPage = 1
  let started = false
  let stopped = false
  let running = false
  let failures = 0
  let done = 0
  let total = 0
  let lastActivity = performance.now()

  const signal = (): AbortSignal => controller.signal

  function publish(): void {
    deps.onProgress(total > 0 ? { done, total } : null)
  }

  /** A page with text (or cached OCR text) never reaches OCR. */
  function hasText(page: number): boolean {
    if (deps.alreadyOcred.has(page)) return true
    const cached = deps.getCachedText(page)
    return cached !== null && cached.trim().length >= OCR_MIN_CHARS
  }

  /** Fill the queue with undecided pages, nearest to the reader first. */
  function fill(): boolean {
    const next: number[] = []
    for (let distance = 0; distance < deps.numPages && next.length < OCR_QUEUE_LIMIT; distance += 1) {
      const candidates = distance === 0 ? [currentPage] : [currentPage - distance, currentPage + distance]
      for (const page of candidates) {
        if (page < 1 || page > deps.numPages) continue
        if (decided.has(page) || next.includes(page) || hasText(page)) continue
        next.push(page)
      }
    }
    pending = next.slice(0, OCR_QUEUE_LIMIT)
    return pending.length > 0
  }

  /** Wait until the reader has not scrolled for `IDLE_QUIET_MS`. */
  async function waitUntilQuiet(): Promise<boolean> {
    while (!stopped) {
      await requestIdle()
      if (stopped) return false
      if (performance.now() - lastActivity >= IDLE_QUIET_MS) return true
    }
    return false
  }

  /** Rasterise and recognise one page. False when the page could not be rendered. */
  async function recognize(page: number): Promise<boolean> {
    const pageSignal = signal()
    const blob = await deps.renderPage(page, pageSignal)
    if (blob === null || stopped) return false
    const url = `${API}?key=${encodeURIComponent(deps.storageKey)}&page=${page}`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: blob,
      signal: pageSignal,
    })
    if (response.status === 409) throw new NoBytesError()
    if (!response.ok) throw new Error(`OCR request failed: HTTP ${response.status}`)
    const body = (await response.json()) as { text?: unknown }
    const text = typeof body.text === 'string' ? body.text : ''
    if (text.trim() !== '') deps.onText(page, text)
    return true
  }

  async function run(): Promise<void> {
    if (running || stopped) return
    running = true
    try {
      while (!stopped) {
        if (pending.length === 0) {
          // One batch per fill: draining the queue must not silently turn into a
          // whole-document scan. A page change asks for the next batch.
          if (!needFill) break
          needFill = false
          if (!fill()) break
        }
        const page = pending.shift()
        if (page === undefined) break
        if (!(await waitUntilQuiet())) break
        if (stopped) break
        if (decided.has(page) || hasText(page)) {
          decided.add(page)
          continue
        }
        decided.add(page)
        let chars: number
        try {
          chars = await deps.probeText(page)
        } catch (error) {
          deps.onError?.(error)
          continue
        }
        if (stopped) break
        if (chars >= OCR_MIN_CHARS) continue
        total += 1
        publish()
        try {
          const produced = await recognize(page)
          if (!produced) {
            // The page left the screen (render cancelled) or could not be
            // rasterised: do not count it as recognised, and do not retry it in
            // this pass.
            total -= 1
            publish()
            if (stopped) break
            continue
          }
          failures = 0
          done += 1
          publish()
        } catch (error) {
          if (stopped) break
          // The page did not yield OCR text: take it back out of the totals so
          // the hint keeps matching done/total, then decide whether to retry.
          total -= 1
          publish()
          if (error instanceof NoBytesError) {
            // The paper might still be uploading to the Host: retry later
            // instead of declaring the page done.
            decided.delete(page)
            const tried = (attempts.get(page) ?? 0) + 1
            attempts.set(page, tried)
            if (tried <= NO_BYTES_MAX_ATTEMPTS) {
              window.setTimeout(() => {
                if (stopped) return
                pending.push(page)
                void run()
              }, NO_BYTES_RETRY_MS * tried)
            }
            continue
          }
          failures += 1
          deps.onError?.(error)
          if (failures >= MAX_CONSECUTIVE_FAILURES) {
            stopped = true
            deps.onProgress(null)
            break
          }
        }
      }
    } finally {
      running = false
    }
  }

  return {
    start(): void {
      if (started || stopped) return
      started = true
      void run()
    },
    stop(): void {
      if (stopped) return
      stopped = true
      controller.abort()
      pending = []
      deps.onProgress(null)
    },
    setCurrentPage(page: number): void {
      if (!Number.isInteger(page) || page < 1 || page > deps.numPages || page === currentPage) return
      currentPage = page
      if (stopped) return
      needFill = true
      if (pending.length > 1) {
        pending = [...pending].sort((left, right) => Math.abs(left - page) - Math.abs(right - page))
      }
      if (!running) void run()
    },
    noteActivity(): void {
      lastActivity = performance.now()
    },
  }
}
