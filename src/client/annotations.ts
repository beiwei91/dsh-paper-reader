/**
 * The annotation store: one JSON document per paper, behind the Host's
 * `/paper-reader/api/annotations` route. The Client keeps the array in memory
 * and writes it back debounced after every edit; a pending write is flushed when
 * the paper (or the tab) goes away so the last note is never lost.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink'

export interface Highlight {
  readonly id: string
  readonly page: number
  readonly color: HighlightColor
  readonly quote: string
  readonly note: string
  readonly createdAt: number
}

const API = '/paper-reader/api/annotations'
const SAVE_DELAY_MS = 300
const RETRY_DELAY_MS = 2000

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `hl-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

interface PendingWrite {
  readonly key: string
  readonly highlights: Highlight[]
}

function putAnnotations(write: PendingWrite, keepalive = false): Promise<boolean> {
  return fetch(API, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: write.key, highlights: write.highlights }),
    keepalive,
  }).then(response => response.ok).catch((error: unknown) => {
    console.warn('[paper-reader] annotation save failed', error)
    return false
  })
}

/** Load one paper's annotations, and write them back after edits. */
export function useAnnotations(storageKey: string | null): {
  highlights: Highlight[]
  addHighlight(input: { page: number; color: HighlightColor; quote: string }): void
  updateNote(id: string, note: string): void
  removeHighlight(id: string): void
} {
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const current = useRef<Highlight[]>([])
  const keyRef = useRef<string | null>(storageKey)
  const saveTimer = useRef<number | null>(null)
  const pending = useRef<PendingWrite | null>(null)
  const dirty = useRef(false)

  const flush = useCallback((keepalive = false): void => {
    const write = pending.current
    pending.current = null
    if (write === null) return
    void putAnnotations(write, keepalive).then(ok => {
      if (ok) {
        dirty.current = false
        return
      }
      // Keep the last draft and retry once; the panel keeps showing it either way.
      if (pending.current === null) pending.current = write
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => flush(false), RETRY_DELAY_MS)
    })
  }, [])

  useEffect(() => {
    // Switching papers flushes the previous paper's last edit first.
    flush(true)
    keyRef.current = storageKey
    current.current = []
    setHighlights([])
    dirty.current = false
    if (storageKey === null || storageKey === '') return
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch(`${API}?key=${encodeURIComponent(storageKey)}`)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const body = await response.json() as { highlights?: Highlight[] }
        if (cancelled || keyRef.current !== storageKey) return
        const stored = Array.isArray(body.highlights) ? body.highlights : []
        if (dirty.current) {
          // An edit landed before the load: keep it and push it over the stored copy.
          current.current = [...stored.filter(item => !current.current.some(local => local.id === item.id)), ...current.current]
          setHighlights(current.current)
          pending.current = { key: storageKey, highlights: current.current }
          flush()
          return
        }
        current.current = stored
        setHighlights(stored)
      } catch (error) {
        if (!cancelled) console.warn('[paper-reader] annotations unavailable', error)
      }
    })()
    return () => { cancelled = true }
  }, [flush, storageKey])

  // Leaving the tab flushes whatever the debounce still holds.
  useEffect(() => () => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    const write = pending.current
    if (write !== null) void putAnnotations(write, true)
  }, [])

  const commit = useCallback((next: Highlight[]): void => {
    current.current = next
    setHighlights(next)
    const key = keyRef.current
    if (key === null || key === '') return
    dirty.current = true
    pending.current = { key, highlights: next }
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => flush(), SAVE_DELAY_MS)
  }, [flush])

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

  return { highlights, addHighlight, updateNote, removeHighlight }
}
