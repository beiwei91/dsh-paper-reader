/**
 * The annotation store: one JSON document per paper, behind the Host's
 * `/paper-reader/api/annotations` route.
 *
 * Every mutation is handed to the save queue immediately (no debounce): one PUT is
 * in flight, a state that arrives meanwhile is coalesced into the next one, and the
 * newest state is never dropped. Teardown paths — paper switch, `pagehide`, a
 * hidden tab, unmount — flush it with `keepalive` so the browser gets one last
 * chance to deliver it. A failed load or save becomes a visible problem and is
 * retried with bounded backoff instead of only reaching the console.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createAnnotationSaveQueue, retryDelay } from './annotationQueue.ts'
import type { AnnotationProblem, AnnotationSaveQueue, Highlight, HighlightColor, SaveResult } from './annotationQueue.ts'

export type { AnnotationProblem, Highlight, HighlightColor } from './annotationQueue.ts'

const API = '/paper-reader/api/annotations'
const LOAD_ATTEMPTS = 3

export interface UseAnnotationsResult {
  readonly highlights: Highlight[]
  addHighlight(input: { page: number; color: HighlightColor; quote: string }): void
  updateNote(id: string, note: string): void
  removeHighlight(id: string): void
  /**
   * Send the newest state now. The normal queue retries and reports failures;
   * pass `true` on a teardown path so the request survives the page going away.
   */
  flush(keepalive?: boolean): void
  readonly loadProblem: AnnotationProblem | null
  readonly saveProblem: AnnotationProblem | null
}

type LoadResult =
  | { readonly ok: true; readonly highlights: Highlight[] }
  | { readonly ok: false; readonly status: number | null; readonly code: string | null }

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `hl-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

async function putAnnotations(write: { key: string; highlights: Highlight[] }, keepalive: boolean): Promise<SaveResult> {
  try {
    const response = await fetch(API, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: write.key, highlights: write.highlights }),
      keepalive,
    })
    if (response.ok) return { ok: true, status: response.status, code: null }
    const detail = (await response.json().catch(() => null)) as { error?: unknown } | null
    return { ok: false, status: response.status, code: typeof detail?.error === 'string' ? detail.error : null }
  } catch {
    return { ok: false, status: null, code: null }
  }
}

async function fetchAnnotations(key: string): Promise<LoadResult> {
  try {
    const response = await fetch(`${API}?key=${encodeURIComponent(key)}`)
    if (!response.ok) {
      const detail = (await response.json().catch(() => null)) as { error?: unknown } | null
      return { ok: false, status: response.status, code: typeof detail?.error === 'string' ? detail.error : null }
    }
    const body = (await response.json()) as { highlights?: unknown }
    // The Host already sanitises every stored highlight before it answers.
    return { ok: true, highlights: Array.isArray(body.highlights) ? body.highlights as Highlight[] : [] }
  } catch {
    return { ok: false, status: null, code: null }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => { window.setTimeout(resolve, ms) })
}

/** Load one paper's annotations, and write them back after edits. */
export function useAnnotations(storageKey: string | null): UseAnnotationsResult {
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const [loadProblem, setLoadProblem] = useState<AnnotationProblem | null>(null)
  const [saveProblem, setSaveProblem] = useState<AnnotationProblem | null>(null)
  const current = useRef<Highlight[]>([])
  const keyRef = useRef<string | null>(storageKey)
  /** An edit for the current key happened since its load started. */
  const edited = useRef(false)
  const alive = useRef(true)

  const report = useCallback((problem: AnnotationProblem | null): void => {
    if (alive.current) setSaveProblem(problem)
  }, [])

  const queueRef = useRef<AnnotationSaveQueue | null>(null)
  queueRef.current ??= createAnnotationSaveQueue({
    put: putAnnotations,
    report,
    setTimer: (handler, ms) => window.setTimeout(handler, ms),
    clearTimer: handle => { window.clearTimeout(handle) },
  })

  const flush = useCallback((keepalive = false): void => {
    queueRef.current?.flush(keepalive)
  }, [])

  useEffect(() => {
    // Switching papers flushes the previous paper's last edit first; while the
    // body stays mounted the queue keeps retrying it.
    flush()
    queueRef.current?.resetAttempts()
    keyRef.current = storageKey
    current.current = []
    edited.current = false
    setHighlights([])
    setLoadProblem(null)
    if (storageKey === null || storageKey === '') return
    let cancelled = false
    void (async () => {
      for (let attempt = 1; attempt <= LOAD_ATTEMPTS; attempt += 1) {
        const result = await fetchAnnotations(storageKey)
        if (cancelled || keyRef.current !== storageKey) return
        if (result.ok) {
          if (edited.current) {
            // An edit landed before the load: keep it and push it over the stored copy.
            current.current = [
              ...result.highlights.filter(item => !current.current.some(local => local.id === item.id)),
              ...current.current,
            ]
            setHighlights(current.current)
            queueRef.current?.enqueue(storageKey, current.current)
          } else {
            current.current = result.highlights
            setHighlights(result.highlights)
          }
          setLoadProblem(null)
          return
        }
        // Keep whatever is in memory: a failed load must not look like "no
        // annotations", which is exactly what the user would otherwise believe.
        const retrying = attempt < LOAD_ATTEMPTS
        setLoadProblem({ kind: 'load', status: result.status, code: result.code, retrying })
        if (!retrying) return
        await sleep(retryDelay(attempt))
        if (cancelled || keyRef.current !== storageKey) return
      }
    })()
    return () => { cancelled = true }
  }, [flush, storageKey])

  // The tab can be hidden, navigated away or unmounted at any moment; each of
  // those paths gets one guaranteed keepalive send of the newest state.
  useEffect(() => {
    alive.current = true
    const flushTeardown = (): void => flush(true)
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') flush(true)
    }
    window.addEventListener('pagehide', flushTeardown)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      alive.current = false
      window.removeEventListener('pagehide', flushTeardown)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      flush(true)
    }
  }, [flush])

  const commit = useCallback((next: Highlight[]): void => {
    current.current = next
    setHighlights(next)
    edited.current = true
    const key = keyRef.current
    if (key === null || key === '') return
    queueRef.current?.enqueue(key, next)
  }, [])

  const addHighlight = useCallback((input: { page: number; color: HighlightColor; quote: string }): void => {
    const quote = input.quote.trim()
    if (quote === '') return
    commit([...current.current, {
      id: newId(),
      page: input.page,
      color: input.color,
      quote,
      note: '',
      createdAt: Date.now(),
    }])
  }, [commit])

  const updateNote = useCallback((id: string, note: string): void => {
    commit(current.current.map(highlight => highlight.id === id ? { ...highlight, note } : highlight))
  }, [commit])

  const removeHighlight = useCallback((id: string): void => {
    commit(current.current.filter(highlight => highlight.id !== id))
  }, [commit])

  return { highlights, addHighlight, updateNote, removeHighlight, flush, loadProblem, saveProblem }
}
