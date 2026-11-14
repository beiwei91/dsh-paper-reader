import { createElement as h, useCallback, useEffect, useRef, useState } from 'react'
import type { ComponentType, DragEvent } from 'react'
import { useAnnotations } from './annotations.ts'
import { BODY_CSS } from './pdf/styles.ts'
import type { PapersBodyProps, PdfChunkModule, PdfViewerProps } from './contract.ts'
import type { PaperReaderLocaleKey } from './types.ts'

/** One arXiv search hit, as the Host's arXiv route returns it. */
interface ArxivHit {
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly published: string
  readonly authors: readonly string[]
}

/** How a failure the Host declares turns into a user-facing line. */
function errorLine(code: string | undefined, t: (key: PaperReaderLocaleKey) => string): string {
  if (code === 'workspace-file/too-large') return t('errorTooLarge')
  if (code === 'workspace-file/not-text') return t('errorNotText')
  return code === undefined ? t('errorRead') : `${t('errorRead')}: ${code}`
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

/** One document open in this tab: where it came from and the bytes to show. */
interface OpenPaper {
  readonly name: string
  readonly storageKey: string
  readonly bytes: Uint8Array<ArrayBuffer>
  /** The Host already stored these bytes (arXiv open), so the upload can be skipped. */
  readonly hostStored?: boolean
}

/** The chunk is fetched once per Client module, however many tabs open; a failed fetch may retry. */
let chunkPromise: Promise<PdfChunkModule> | null = null
function loadViewer(): Promise<PdfChunkModule> {
  chunkPromise ??= __dshRequireAsync('./client.pdf.js').then(module => module as PdfChunkModule).catch((error: unknown) => {
    chunkPromise = null
    throw error
  })
  return chunkPromise
}

/** The complete-file cap the Host applies to `readBytes`. */
const MAX_FILE_BYTES = 32 * 1024 * 1024

/** Where this tab's open paper is remembered across the body's unmount. */
const TAB_PAPER_PREFIX = 'dsh.paper-reader.tab.'

/** The durable pointer: the Host keeps the bytes, so the name is all the UI needs. */
interface StoredPaper {
  readonly key: string
  readonly name: string
  /** The session that opened it, so another session's leftover entry is never adopted. */
  readonly sessionId?: string
}

function readTabPaper(tabId: string): StoredPaper | null {
  try {
    const raw = window.localStorage.getItem(TAB_PAPER_PREFIX + tabId)
    if (raw === null) return null
    const parsed = JSON.parse(raw) as Partial<StoredPaper>
    if (typeof parsed.key !== 'string' || parsed.key === '') return null
    return {
      key: parsed.key,
      name: typeof parsed.name === 'string' ? parsed.name : '',
      sessionId: typeof parsed.sessionId === 'string' && parsed.sessionId !== '' ? parsed.sessionId : undefined,
    }
  } catch {
    return null
  }
}

function writeTabPaper(tabId: string, paper: StoredPaper): void {
  try {
    window.localStorage.setItem(TAB_PAPER_PREFIX + tabId, JSON.stringify(paper))
  } catch {
    // Storage can be full or disabled; restoring the paper is a convenience.
  }
}

function clearTabPaper(tabId: string): void {
  try {
    window.localStorage.removeItem(TAB_PAPER_PREFIX + tabId)
  } catch {
    // Same as above.
  }
}

/**
 * The tab body: an empty state that opens a paper (absolute path through the
 * Host, a dropped file read in the page, or arXiv), then the lazily loaded
 * reader with its annotation store and the conversation actions.
 */
export function PapersBody({ reader, t, inputActions, sessionId, useTabInfo }: PapersBodyProps): ReturnType<typeof h> {
  // A hidden tab unmounts this body (see the tab type's `keepMounted: false`), so
  // the open paper lives in the Host's bytes plus one localStorage pointer keyed
  // by this tab occurrence, and is restored on the next mount.
  const tabId = String(useTabInfo().tab.id)
  const restoreTried = useRef('')
  const [restoring, setRestoring] = useState<boolean>(() => {
    return readTabPaper(tabId) !== null && sessionId !== undefined && sessionId !== ''
  })
  const [paper, setPaper] = useState<OpenPaper | null>(null)
  const [viewer, setViewer] = useState<ComponentType<PdfViewerProps> | null>(null)
  const [pathInput, setPathInput] = useState('')
  const [arxivInput, setArxivInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<ArxivHit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dropping, setDropping] = useState(false)
  const alive = useRef(true)
  const abortRef = useRef<AbortController | null>(null)
  const openSeq = useRef(0)
  const searchSeq = useRef(0)
  const annotations = useAnnotations(paper?.storageKey ?? null)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      abortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void loadViewer().then(module => {
      if (!cancelled) setViewer(() => module.PdfViewer)
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { cancelled = true }
  }, [])

  // One restore attempt per mount. The Host keeps every opened paper's bytes, so
  // a hidden tab's viewer can be rebuilt from the pointer alone; a stale pointer
  // (Host lost the bytes, or another session wrote it) becomes the empty state
  // instead of a broken view, and is never retried in a loop.
  useEffect(() => {
    if (restoreTried.current === tabId) return
    const stored = readTabPaper(tabId)
    if (stored === null) {
      setRestoring(false)
      return
    }
    if (sessionId === undefined || sessionId === '') return
    if (stored.sessionId !== undefined && stored.sessionId !== sessionId) {
      clearTabPaper(tabId)
      setRestoring(false)
      return
    }
    restoreTried.current = tabId
    setRestoring(true)
    void (async () => {
      try {
        const response = await fetch(`/paper-reader/api/paper/bytes?key=${encodeURIComponent(stored.key)}`, {
          signal: AbortSignal.timeout(60_000),
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const bytes = new Uint8Array(await response.arrayBuffer())
        if (!alive.current) return
        setPaper({ name: stored.name || stored.key, storageKey: stored.key, bytes, hostStored: true })
        // The agent's paper_* tools answer about the session's current paper;
        // remounting the tab must not leave them without one.
        void fetch('/paper-reader/api/current', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId, key: stored.key, title: stored.name }),
        }).catch(() => undefined)
      } catch (reason) {
        if (!alive.current) return
        console.warn('[paper-reader] paper restore failed', reason)
        clearTabPaper(tabId)
        setPaper(null)
      } finally {
        if (alive.current) setRestoring(false)
      }
    })()
  }, [sessionId, tabId])

  // Remember this tab's paper while it is open; 换一篇 clears the pointer.
  useEffect(() => {
    if (paper === null) return
    writeTabPaper(tabId, {
      key: paper.storageKey,
      name: paper.name,
      sessionId: sessionId === undefined || sessionId === '' ? undefined : sessionId,
    })
  }, [paper, sessionId, tabId])

  const openPath = useCallback(async (): Promise<void> => {
    const path = pathInput.trim()
    if (path === '') return
    if (sessionId === undefined || sessionId === '') {
      setError(t('errorNoSession'))
      return
    }
    setBusy(true)
    setError(null)
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const result = await reader.readBytes(sessionId as never, path, {}, controller.signal)
      if (!result.ok) {
        setError(errorLine((result.error as { code?: string }).code, t))
        return
      }
      const bytes = result.value.data as Uint8Array<ArrayBuffer>
      if (!alive.current) return
      setPaper({ name: baseName(path), storageKey: result.value.absolutePath || path, bytes })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (alive.current) setBusy(false)
    }
  }, [pathInput, reader, sessionId, t])

  const openArxiv = useCallback(async (idOrUrl: string, knownTitle?: string): Promise<void> => {
    const input = idOrUrl.trim()
    if (input === '') return
    const sequence = openSeq.current + 1
    openSeq.current = sequence
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/paper-reader/api/arxiv/open', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idOrUrl: input, sessionId: sessionId ?? '' }),
        signal: AbortSignal.timeout(90_000),
      })
      if (!response.ok) {
        const detail = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(response.status === 413 ? t('errorTooLarge') : detail.error ?? t('arxivOpenFailed'))
      }
      const opened = (await response.json()) as { key?: string; title?: string; id?: string }
      if (typeof opened.key !== 'string' || opened.key === '') throw new Error(t('arxivOpenFailed'))
      const bytesResponse = await fetch(`/paper-reader/api/paper/bytes?key=${encodeURIComponent(opened.key)}`, {
        signal: AbortSignal.timeout(60_000),
      })
      if (!bytesResponse.ok) throw new Error(t('arxivOpenFailed'))
      const bytes = new Uint8Array(await bytesResponse.arrayBuffer())
      // A slower, earlier open must never replace the paper the user just asked for.
      if (!alive.current || sequence !== openSeq.current) return
      setPaper({ name: opened.title || knownTitle || opened.id || input, storageKey: opened.key, bytes, hostStored: true })
    } catch (reason) {
      if (alive.current && sequence === openSeq.current) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (alive.current && sequence === openSeq.current) setBusy(false)
    }
  }, [sessionId, t])

  const runSearch = useCallback(async (): Promise<void> => {
    const query = searchQuery.trim()
    if (query === '') return
    const sequence = searchSeq.current + 1
    searchSeq.current = sequence
    setSearching(true)
    setError(null)
    try {
      const response = await fetch(`/paper-reader/api/arxiv/search?q=${encodeURIComponent(query)}&max=10`, {
        signal: AbortSignal.timeout(60_000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const result = (await response.json()) as { entries?: ArxivHit[] }
      if (!alive.current || sequence !== searchSeq.current) return
      setSearchResults(Array.isArray(result.entries) ? result.entries : [])
    } catch (reason) {
      if (alive.current && sequence === searchSeq.current) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (alive.current && sequence === searchSeq.current) setSearching(false)
    }
  }, [searchQuery])

  const openFile = useCallback(async (file: File): Promise<void> => {
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      setError(t('errorOpen'))
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      setError(t('errorTooLarge'))
      return
    }
    setError(null)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (!alive.current) return
      setPaper({ name: file.name, storageKey: `drop:${file.name}:${file.size}:${file.lastModified}`, bytes })
    } catch (reason) {
      if (alive.current) setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [t])

  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    setDropping(true)
  }, [])

  const onDragLeave = useCallback((): void => setDropping(false), [])

  const onDrop = useCallback((event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    setDropping(false)
    const file = event.dataTransfer?.files?.[0]
    if (file !== undefined) void openFile(file)
  }, [openFile])

  const reset = useCallback((): void => {
    clearTabPaper(tabId)
    setPaper(null)
    setRestoring(false)
    setError(null)
    setPathInput('')
    setSearchResults(null)
    if (sessionId !== undefined && sessionId !== '') {
      void fetch(`/paper-reader/api/current?session=${encodeURIComponent(sessionId)}`, { method: 'DELETE' })
        .catch(() => undefined)
    }
  }, [sessionId, tabId])

  // The Host needs the bytes to answer the agent's paper_* tools; a failure
  // here only costs those tools, never the reading experience. arXiv opens are
  // already stored by the Host, so they must not upload the bytes twice.
  useEffect(() => {
    if (paper === null || sessionId === undefined || sessionId === '' || paper.hostStored === true) return
    const controller = new AbortController()
    void (async () => {
      try {
        const query = `key=${encodeURIComponent(paper.storageKey)}&session=${encodeURIComponent(sessionId)}&title=${encodeURIComponent(paper.name)}`
        const response = await fetch(`/paper-reader/api/paper?${query}`, {
          method: 'POST',
          headers: { 'content-type': 'application/pdf' },
          body: paper.bytes,
          signal: controller.signal,
        })
        if (!response.ok) console.warn('[paper-reader] paper upload failed', response.status)
      } catch (error) {
        if (!controller.signal.aborted) console.warn('[paper-reader] paper upload failed', error)
      }
    })()
    return () => controller.abort()
  }, [paper, sessionId])

  const cite = useCallback((text: string, page: number): string => {
    return `${text}\n\n— ${paper?.name ?? ''} p.${page}`
  }, [paper])

  const quote = useCallback((text: string, page: number): void => {
    inputActions?.insertQuote(cite(text, page))
  }, [cite, inputActions])

  const ask = useCallback((text: string, page: number, kind: 'explain' | 'translate'): void => {
    if (inputActions === undefined) return
    // Both edits are refusable (frozen composer, claimed command chip); a refused
    // quote must never fall through to submitting a bare prompt.
    if (!inputActions.insertQuote(cite(text, page))) return
    const span = inputActions.captureInsertion()
    if (!inputActions.insertText(` ${kind === 'explain' ? t('explainPrompt') : t('translatePrompt')}`, span)) return
    inputActions.submit()
  }, [cite, inputActions, t])

  if (paper !== null) {
    return h('div', { className: 'pr-body' },
      h('style', null, BODY_CSS),
      h('div', { className: 'pr-head' },
        h('span', { className: 'pr-name', title: paper.name }, paper.name),
        h('button', { type: 'button', className: 'pr-open-btn', onClick: reset }, t('changePaper')),
      ),
      error !== null && h('div', { className: 'pr-error' }, error),
      viewer === null
        ? h('div', { className: 'pr-status' }, t('loading'))
        : h(viewer, {
          bytes: paper.bytes,
          storageKey: paper.storageKey,
          t,
          highlights: annotations.highlights,
          onCreateHighlight: annotations.addHighlight,
          onUpdateNote: annotations.updateNote,
          onDeleteHighlight: annotations.removeHighlight,
          onQuote: quote,
          onAsk: ask,
        }),
    )
  }

  // A hidden tab unmounted the viewer; while its paper comes back from the Host,
  // keep the loading state rather than flashing the empty-paper state.
  if (restoring) {
    return h('div', { className: 'pr-body' },
      h('style', null, BODY_CSS),
      h('div', { className: 'pr-status' }, t('loading')),
    )
  }

  return h('div', {
    className: 'pr-body',
    onDragOver,
    onDragLeave,
    onDrop,
  },
    h('style', null, BODY_CSS),
    h('div', { className: 'pr-empty' },
      h('div', { className: 'pr-empty-title' }, t('emptyTitle')),
      h('div', { className: 'pr-empty-hint' }, t('emptyHint')),
      h('form', {
        className: 'pr-form',
        onSubmit: (event: { preventDefault(): void }) => { event.preventDefault(); void openPath() },
      },
        h('input', {
          className: 'pr-input',
          value: pathInput,
          placeholder: t('pathPlaceholder'),
          spellCheck: false,
          onChange: (event: { currentTarget: { value: string } }) => setPathInput(event.currentTarget.value),
        }),
        h('button', { type: 'submit', className: 'pr-open-btn', disabled: busy }, t('open')),
      ),
      h('div', { className: 'pr-drop', 'data-active': dropping ? 'true' : 'false' },
        h('div', { className: 'pr-empty-foot' }, t('dropHint')),
      ),
      h('form', {
        className: 'pr-form',
        onSubmit: (event: { preventDefault(): void }) => { event.preventDefault(); void openArxiv(arxivInput) },
      },
        h('input', {
          className: 'pr-input',
          value: arxivInput,
          placeholder: t('arxivIdPlaceholder'),
          spellCheck: false,
          onChange: (event: { currentTarget: { value: string } }) => setArxivInput(event.currentTarget.value),
        }),
        h('button', { type: 'submit', className: 'pr-open-btn', disabled: busy }, t('arxivOpen')),
      ),
      h('form', {
        className: 'pr-form',
        onSubmit: (event: { preventDefault(): void }) => { event.preventDefault(); void runSearch() },
      },
        h('input', {
          className: 'pr-input',
          value: searchQuery,
          placeholder: t('arxivSearchPlaceholder'),
          spellCheck: false,
          onChange: (event: { currentTarget: { value: string } }) => setSearchQuery(event.currentTarget.value),
        }),
        h('button', { type: 'submit', className: 'pr-open-btn', disabled: searching }, t('arxivSearch')),
      ),
      searching && h('div', { className: 'pr-empty-foot' }, t('arxivSearching')),
      searchResults !== null && searchResults.length === 0 && !searching && h('div', { className: 'pr-empty-foot' }, t('arxivNoResult')),
      searchResults !== null && searchResults.length > 0 && h('div', { className: 'pr-results' },
        ...searchResults.map(hit => h('button', {
          key: hit.id,
          type: 'button',
          className: 'pr-result',
          title: hit.summary,
          disabled: busy,
          onClick: () => void openArxiv(hit.id, hit.title),
        },
          h('span', { className: 'pr-result-title' }, hit.title),
          h('span', { className: 'pr-result-meta' }, `arXiv:${hit.id}${hit.published === '' ? '' : ` · ${hit.published}`}`),
        )),
      ),
      error !== null && h('div', { className: 'pr-error' }, error),
    ),
  )
}
