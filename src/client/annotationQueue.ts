/**
 * The save queue behind `useAnnotations`.
 *
 * Kept free of React, `window` and `fetch` so its ordering guarantees can be
 * driven headlessly (see `scripts/annotation-save-test.cjs`):
 *
 *  - one PUT is in flight at a time; a state that arrives meanwhile replaces the
 *    queued one, and the *newest* state is always what goes out next;
 *  - a failed PUT keeps the newest state and retries with bounded backoff, and the
 *    visible problem carries the HTTP status / Host error code;
 *  - a stale settle never restores an older snapshot over a newer one;
 *  - `flush(true)` sends the newest state immediately, for teardown paths, even
 *    while another PUT is in flight.
 */
export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink'

export interface Highlight {
  readonly id: string
  readonly page: number
  readonly color: HighlightColor
  readonly quote: string
  readonly note: string
  readonly createdAt: number
}

/** One save failure, in the shape the body turns into a visible status line. */
export interface AnnotationProblem {
  readonly kind: 'load' | 'save'
  /** HTTP status, or null when the request never got one (offline / aborted). */
  readonly status: number | null
  /** The Host's error code when it sent one (e.g. `bad-origin`). */
  readonly code: string | null
  /** Whether another attempt is already scheduled. */
  readonly retrying: boolean
}

export interface SaveResult {
  readonly ok: boolean
  readonly status: number | null
  readonly code: string | null
}

export interface PendingWrite {
  readonly key: string
  readonly highlights: Highlight[]
}

export interface SaveQueueDeps {
  /** PUT one snapshot. Never throws: a transport failure is `status: null`. */
  put(write: PendingWrite, keepalive: boolean): Promise<SaveResult>
  /** Report the current save failure, or null once a save succeeds. */
  report(problem: AnnotationProblem | null): void
  setTimer(handler: () => void, ms: number): number
  clearTimer(handle: number): void
}

export interface AnnotationSaveQueue {
  enqueue(key: string, highlights: Highlight[]): void
  flush(keepalive?: boolean): void
  /** A paper switch starts the new paper with a clean retry budget. */
  resetAttempts(): void
}

/** Bounded: after this many consecutive failures the error stays until the next edit. */
export const SAVE_ATTEMPTS = 6
const RETRY_BASE_MS = 500
const RETRY_MAX_MS = 8000

export function retryDelay(attempt: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1))
}

export function createAnnotationSaveQueue(deps: SaveQueueDeps): AnnotationSaveQueue {
  let pending: PendingWrite | null = null
  let inFlight = false
  let attempt = 0
  let timer: number | null = null
  /** Id of the newest dispatch; a settling older request is stale. */
  let newest = 0

  function dispatch(write: PendingWrite, keepalive: boolean): void {
    const id = newest + 1
    newest = id
    inFlight = true
    void deps.put(write, keepalive).then(result => {
      if (id !== newest) {
        // A newer snapshot was dispatched while this one was in flight — a teardown
        // flush overtook it. That request owns the queue now; only its failure is
        // still worth showing.
        if (!result.ok) deps.report({ kind: 'save', status: result.status, code: result.code, retrying: false })
        return
      }
      inFlight = false
      if (result.ok) {
        attempt = 0
        deps.report(null)
        if (pending !== null) pump()
        return
      }
      // Only restore this snapshot when nothing newer is waiting: restoring it over
      // a newer one would undo the newest edit.
      if (pending === null) pending = write
      attempt += 1
      const retrying = attempt < SAVE_ATTEMPTS
      deps.report({ kind: 'save', status: result.status, code: result.code, retrying })
      if (!retrying) return
      if (timer !== null) deps.clearTimer(timer)
      timer = deps.setTimer(() => {
        timer = null
        pump()
      }, retryDelay(attempt))
    })
  }

  function pump(): void {
    if (inFlight) return
    const write = pending
    if (write === null) return
    pending = null
    dispatch(write, false)
  }

  return {
    enqueue(key, highlights) {
      pending = { key, highlights }
      pump()
    },
    flush(keepalive = false) {
      if (timer !== null) {
        deps.clearTimer(timer)
        timer = null
      }
      const write = pending
      if (write === null) return
      pending = null
      if (!keepalive) {
        // The queue owns the single in-flight request and retries; this newest
        // state goes out as soon as the request in flight settles.
        pending = write
        pump()
        return
      }
      // Teardown: the page may never settle the request in flight, so the newest
      // snapshot (it contains every edit) is sent alongside it with keepalive.
      dispatch(write, true)
    },
    resetAttempts() {
      attempt = 0
    },
  }
}
