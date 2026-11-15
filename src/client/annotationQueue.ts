/**
 * The save queue behind `useAnnotations`.
 *
 * Kept free of React, `window` and `fetch` so its ordering guarantees can be
 * driven headlessly (see `scripts/annotation-save-test.cjs`):
 *
 *  - the queue is **per paper key**: each paper has its own in-flight slot,
 *    pending snapshot, retry budget and timer, so switching papers while a PUT is
 *    in flight can never make the new paper's state replace (or be replaced by)
 *    the old paper's final snapshot;
 *  - within one key, one PUT is in flight at a time; a state that arrives meanwhile
 *    replaces the queued one, and the *newest* state is always what goes out next;
 *  - a failed PUT keeps that key's newest state and retries with bounded backoff,
 *    and the visible problem carries the HTTP status / Host error code;
 *  - a stale settle never restores an older snapshot over a newer one;
 *  - `flush(true)` sends every key's newest state immediately, for teardown paths,
 *    even while another PUT is in flight.
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
  /** Send the newest state now; `keepalive` is for teardown paths. */
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

/** One paper's slice of the queue. */
interface KeyState {
  pending: PendingWrite | null
  inFlight: boolean
  attempt: number
  timer: number | null
  /** Id of this key's newest dispatch; a settling older request is stale. */
  newest: number
}

export function createAnnotationSaveQueue(deps: SaveQueueDeps): AnnotationSaveQueue {
  const states = new Map<string, KeyState>()

  function stateOf(key: string): KeyState {
    let state = states.get(key)
    if (state === undefined) {
      state = { pending: null, inFlight: false, attempt: 0, timer: null, newest: 0 }
      states.set(key, state)
    }
    return state
  }

  /** Drop a paper's slice once it has nothing in flight, queued or scheduled. */
  function retire(key: string, state: KeyState): void {
    if (state.inFlight || state.pending !== null || state.timer !== null) return
    if (states.get(key) === state) states.delete(key)
  }

  function dispatch(state: KeyState, write: PendingWrite, keepalive: boolean): void {
    const id = state.newest + 1
    state.newest = id
    state.inFlight = true
    void deps.put(write, keepalive).then(result => {
      if (id !== state.newest) {
        // A newer snapshot was dispatched while this one was in flight — a teardown
        // flush overtook it. That request owns the key now; only its failure is still
        // worth showing.
        if (!result.ok) deps.report({ kind: 'save', status: result.status, code: result.code, retrying: false })
        return
      }
      state.inFlight = false
      if (result.ok) {
        state.attempt = 0
        deps.report(null)
        if (state.pending !== null) pump(state)
        else retire(write.key, state)
        return
      }
      // Only restore this snapshot when nothing newer is waiting: restoring it over
      // a newer one would undo the newest edit.
      if (state.pending === null) state.pending = write
      state.attempt += 1
      const retrying = state.attempt < SAVE_ATTEMPTS
      deps.report({ kind: 'save', status: result.status, code: result.code, retrying })
      if (!retrying) return
      if (state.timer !== null) deps.clearTimer(state.timer)
      state.timer = deps.setTimer(() => {
        state.timer = null
        pump(state)
      }, retryDelay(state.attempt))
    })
  }

  function pump(state: KeyState): void {
    if (state.inFlight) return
    const write = state.pending
    if (write === null) return
    state.pending = null
    dispatch(state, write, false)
  }

  return {
    enqueue(key, highlights) {
      const state = stateOf(key)
      state.pending = { key, highlights }
      pump(state)
    },
    flush(keepalive = false) {
      for (const [key, state] of states) {
        if (state.timer !== null) {
          deps.clearTimer(state.timer)
          state.timer = null
        }
        const write = state.pending
        if (write === null) {
          retire(key, state)
          continue
        }
        state.pending = null
        if (!keepalive) {
          // Each paper keeps its own single in-flight request and retries; this
          // newest state goes out as soon as that paper's request in flight settles.
          state.pending = write
          pump(state)
          continue
        }
        // Teardown: the page may never settle a request in flight, so each paper's
        // newest snapshot (it contains every edit) is sent alongside it with keepalive.
        dispatch(state, write, true)
      }
    },
    resetAttempts() {
      for (const state of states.values()) state.attempt = 0
    },
  }
}
