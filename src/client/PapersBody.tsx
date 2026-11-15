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

/** A write the Client could not land, kept visible until the next successful one. */
interface WriteProblem {
  readonly status: number | null
  readonly code?: string | null
  readonly retrying: boolean
}

/** `label (HTTP 403 · bad-origin) · retrying` — the same shape for every write. */
function problemLine(label: string, problem: WriteProblem, t: (key: PaperReaderLocaleKey) => string): string {
  const status = problem.status === null ? '' : `HTTP ${problem.status}`
  const code = problem.code === undefined || problem.code === null || problem.code === '' ? '' : ` · ${problem.code}`
  const detail = status === '' ? '' : ` (${status}${code})`
  return `${label}${detail}${problem.retrying ? ` · ${t('retrying')}` : ''}`
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
  /** The absolute path this paper was opened from, when there is one to re-read. */
  readonly readPath?: string
  /** Where the bytes came from, for the recent list. */
  readonly kind: RecentKind
}

/** The last papers opened in this browser, for one-click reopening from the empty state. */
const RECENT_KEY = 'dsh.paper-reader.recent'
const RECENT_LIMIT = 12

/** Where a recent paper's bytes came from (all the ways a paper can be opened). */
type RecentKind = 'path' | 'drop' | 'arxiv' | 'host'

interface RecentPaper {
  readonly key: string
  readonly name: string
  /** The absolute local path, so a host that lost its bytes can be bypassed. */
  readonly path?: string
  readonly kind: RecentKind
  readonly openedAt: number
}

/** Infer the source of a paper from its storage key and whether a path is known. */
function recentKindOf(key: string, path?: string): RecentKind {
  if (key.startsWith('arxiv:')) return 'arxiv'
  if (key.startsWith('drop:')) return 'drop'
  return path === undefined ? 'host' : 'path'
}

function readRecentPapers(): RecentPaper[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const entries: RecentPaper[] = []
    for (const item of parsed) {
      const row = item as { key?: unknown; name?: unknown; path?: unknown; kind?: unknown; openedAt?: unknown }
      if (typeof row.key !== 'string' || row.key === '') continue
      // A malformed/unknown kind falls back to the safest possible one.
      const kind: RecentKind =
        row.kind === 'drop' || row.kind === 'arxiv' || row.kind === 'host' ? row.kind : 'path'
      entries.push({
        key: row.key,
        name: typeof row.name === 'string' && row.name !== '' ? row.name : row.key,
        path: typeof row.path === 'string' && row.path !== '' ? row.path : undefined,
        kind,
        openedAt: typeof row.openedAt === 'number' ? row.openedAt : 0,
      })
      if (entries.length >= RECENT_LIMIT) break
    }
    return entries
  } catch {
    return []
  }
}

function writeRecentPapers(entries: readonly RecentPaper[]): void {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(entries))
  } catch {
    // Storage can be full or disabled; the list is a convenience.
  }
}

/** Newest first, deduped by key, capped at `RECENT_LIMIT`. */
function addRecentPaper(
  entries: readonly RecentPaper[],
  entry: Omit<RecentPaper, 'openedAt'>,
): RecentPaper[] {
  return [
    { ...entry, openedAt: Date.now() },
    ...entries.filter(candidate => candidate.key !== entry.key),
  ].slice(0, RECENT_LIMIT)
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

/** Upload retries: a Host restart or a transient 5xx is worth retrying, a 4xx is not. */
const UPLOAD_ATTEMPTS = 5
const UPLOAD_RETRY_BASE_MS = 500

function uploadRetryDelay(attempt: number): number {
  return Math.min(8000, UPLOAD_RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1))
}

/** Where this tab's open paper is remembered across a page reload or restart. */
const TAB_PAPER_PREFIX = 'dsh.paper-reader.tab.'

/** The durable pointer: the Host keeps the bytes, so the name is all the UI needs. */
interface StoredPaper {
  readonly key: string
  readonly name: string
  /** The session that opened it, so another session's leftover entry is never adopted. */
  readonly sessionId?: string
  /** The absolute local path, so a restore can re-read the file when the Host lost its copy. */
  readonly path?: string
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
      path: typeof parsed.path === 'string' && parsed.path !== '' ? parsed.path : undefined,
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
  // The tab type keeps its body mounted while another right-sidebar tab is in
  // front (`keepMounted: true`), so the paper stays open; the viewer releases its
  // PDF worker/document/bitmaps after a pause instead. The localStorage pointer
  // below is the secondary path for a page reload or a Host restart.
  const { tab } = useTabInfo()
  const tabId = String(tab.id)
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
  /** A paper upload the Host rejected or never answered; agent tools need it. */
  const [uploadProblem, setUploadProblem] = useState<WriteProblem | null>(null)
  const [busy, setBusy] = useState(false)
  const [dropping, setDropping] = useState(false)
  const alive = useRef(true)
  const abortRef = useRef<AbortController | null>(null)
  const openSeq = useRef(0)
  const searchSeq = useRef(0)
  const annotations = useAnnotations(paper?.storageKey ?? null)
  /** Newest-first papers this browser opened; mirrors the localStorage list. */
  const [recent, setRecent] = useState<RecentPaper[]>(() => readRecentPapers())

  /** Remember one open in the recent list (newest first, deduped, capped). */
  const recordRecent = useCallback((entry: Omit<RecentPaper, 'openedAt'>): void => {
    setRecent(previous => {
      const next = addRecentPaper(previous, entry)
      writeRecentPapers(next)
      return next
    })
  }, [])

  /** Drop one entry; the rest of the history is untouched. */
  const forgetRecent = useCallback((key: string): void => {
    setRecent(previous => {
      const next = previous.filter(entry => entry.key !== key)
      writeRecentPapers(next)
      return next
    })
  }, [])

  /** Make `next` the open paper and write the durable per-tab pointer immediately. */
  const remember = useCallback((next: OpenPaper): void => {
    setPaper(next)
    writeTabPaper(tabId, {
      key: next.storageKey,
      name: next.name,
      path: next.readPath,
      sessionId: sessionId === undefined || sessionId === '' ? undefined : sessionId,
    })
    // Independent of the tab pointer: this list survives "change paper".
    recordRecent({
      key: next.storageKey,
      name: next.name,
      path: next.readPath,
      kind: next.kind,
    })
  }, [recordRecent, sessionId, tabId])

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

  // Secondary path, one attempt per mount: after a page reload or a Host restart
  // the body comes back with no paper state, so the durable pointer reopens it.
  // The Host keeps every opened paper's bytes; a local-path open can also be
  // re-read through the injected reader when the Host lost its copy. A pointer
  // that cannot be honoured (stale session, missing bytes and no path) becomes
  // the empty state instead of a broken view, and is never retried in a loop.
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
      const title = stored.name || stored.key
      try {
        let bytes: Uint8Array<ArrayBuffer> | null = null
        let hostStored = true
        try {
          const response = await fetch(`/paper-reader/api/paper/bytes?key=${encodeURIComponent(stored.key)}`, {
            signal: AbortSignal.timeout(60_000),
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          bytes = new Uint8Array(await response.arrayBuffer())
        } catch (hostError) {
          // The Host may not have the bytes (restart, or an upload that never
          // finished). A local path is the one case we can re-read ourselves.
          if (stored.path === undefined) throw hostError
          const result = await reader.readBytes(sessionId as never, stored.path, {})
          if (!result.ok) throw new Error('read failed')
          bytes = result.value.data as Uint8Array<ArrayBuffer>
          hostStored = false
        }
        if (!alive.current || bytes === null) return
        remember({
          name: title,
          storageKey: stored.key,
          bytes,
          hostStored,
          readPath: stored.path,
          kind: recentKindOf(stored.key, stored.path),
        })
        // The agent's paper_* tools answer about the session's current paper;
        // restoring the viewer must not leave them without one.
        void fetch('/paper-reader/api/current', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId, key: stored.key, title }),
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
  }, [reader, remember, sessionId, tabId])

  const openPath = useCallback(async (): Promise<void> => {
    const path = pathInput.trim()
    if (path === '') return
    if (sessionId === undefined || sessionId === '') {
      setError(t('errorNoSession'))
      return
    }
    // A second open supersedes this one; a slower, earlier read must not replace
    // the paper the user asked for last (the same rule openArxiv follows).
    const sequence = openSeq.current + 1
    openSeq.current = sequence
    setBusy(true)
    setError(null)
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const result = await reader.readBytes(sessionId as never, path, {}, controller.signal)
      if (sequence !== openSeq.current) return
      if (!result.ok) {
        setError(errorLine((result.error as { code?: string }).code, t))
        return
      }
      const bytes = result.value.data as Uint8Array<ArrayBuffer>
      if (!alive.current) return
      const absolutePath = result.value.absolutePath || path
      remember({ name: baseName(path), storageKey: absolutePath, bytes, readPath: absolutePath, kind: 'path' })
    } catch (reason) {
      if (alive.current && sequence === openSeq.current) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (alive.current && sequence === openSeq.current) setBusy(false)
    }
  }, [pathInput, reader, remember, sessionId, t])

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
      remember({ name: opened.title || knownTitle || opened.id || input, storageKey: opened.key, bytes, hostStored: true, kind: 'arxiv' })
    } catch (reason) {
      if (alive.current && sequence === openSeq.current) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (alive.current && sequence === openSeq.current) setBusy(false)
    }
  }, [remember, sessionId, t])

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
      // A dropped file has no path to re-read; its bytes live in the Host from here on.
      remember({ name: file.name, storageKey: `drop:${file.name}:${file.size}:${file.lastModified}`, bytes, kind: 'drop' })
    } catch (reason) {
      if (alive.current) setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [remember, t])

  /**
   * Reopen one recently opened paper.
   *
   * The Host keeps every paper whose bytes it was given, so that copy is the
   * primary path; a 404 is the one case where the entry's stored local path can
   * re-read the file itself. A failure stays visible and keeps the entry: a
   * transient Host restart must never silently erase the user's history.
   */
  const openRecent = useCallback(async (entry: RecentPaper): Promise<void> => {
    const sequence = openSeq.current + 1
    openSeq.current = sequence
    setBusy(true)
    setError(null)
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    try {
      let bytes: Uint8Array<ArrayBuffer>
      let hostStored = true
      let readPath = entry.path
      const response = await fetch(`/paper-reader/api/paper/bytes?key=${encodeURIComponent(entry.key)}`, {
        signal: controller.signal,
      })
      if (response.ok) {
        bytes = new Uint8Array(await response.arrayBuffer())
      } else if (response.status === 404 && entry.path !== undefined && sessionId !== undefined && sessionId !== '') {
        // The Host lost its copy (restart, or an upload that never finished):
        // re-read the original file through the injected workspace reader.
        const result = await reader.readBytes(sessionId as never, entry.path, {}, controller.signal)
        if (!result.ok) throw new Error(errorLine((result.error as { code?: string }).code, t))
        bytes = result.value.data as Uint8Array<ArrayBuffer>
        hostStored = false
        readPath = result.value.absolutePath || entry.path
      } else {
        throw new Error(`HTTP ${response.status}`)
      }
      if (!alive.current || sequence !== openSeq.current) return
      remember({ name: entry.name, storageKey: entry.key, bytes, hostStored, readPath, kind: entry.kind })
      // The agent's paper_* tools answer about the session's current paper; a
      // host-stored reopen skips the upload that would otherwise point them here.
      if (hostStored && sessionId !== undefined && sessionId !== '') {
        void fetch('/paper-reader/api/current', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId, key: entry.key, title: entry.name }),
        }).catch(() => undefined)
      }
    } catch (reason) {
      if (!alive.current || sequence !== openSeq.current) return
      console.warn('[paper-reader] recent paper reopen failed', reason)
      // Keep the entry: the failure may be temporary, and losing history is worse.
      setError(`${t('recentOpenFailed')} · ${entry.name}`)
    } finally {
      if (alive.current && sequence === openSeq.current) setBusy(false)
    }
  }, [reader, remember, sessionId, t])

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
    // The last highlight or note edit must reach the Host before the paper goes
    // away; the hook owns the queue, so ask it to send the newest state now.
    annotations.flush()
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
  }, [annotations.flush, sessionId, tabId])

  // The Host needs the bytes to answer the agent's paper_* tools; a failure
  // here only costs those tools, never the reading experience. It must still be
  // visible: a 403 here means the agent cannot see the paper at all. arXiv opens
  // are already stored by the Host, so they must not upload the bytes twice.
  useEffect(() => {
    if (paper === null || sessionId === undefined || sessionId === '' || paper.hostStored === true) {
      setUploadProblem(null)
      return
    }
    const controller = new AbortController()
    let cancelled = false
    setUploadProblem(null)
    void (async () => {
      for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt += 1) {
        let retrying = false
        try {
          const query = `key=${encodeURIComponent(paper.storageKey)}&session=${encodeURIComponent(sessionId)}&title=${encodeURIComponent(paper.name)}`
          const response = await fetch(`/paper-reader/api/paper?${query}`, {
            method: 'POST',
            headers: { 'content-type': 'application/pdf' },
            body: paper.bytes,
            signal: controller.signal,
          })
          if (response.ok) {
            if (!cancelled) setUploadProblem(null)
            return
          }
          if (cancelled) return
          // A 4xx is this request's fault (permission/limits/shape); only a
          // transient server error or a network failure is worth another try.
          retrying = attempt < UPLOAD_ATTEMPTS && response.status >= 500
          setUploadProblem({ status: response.status, retrying })
          if (!retrying) return
        } catch {
          if (cancelled || controller.signal.aborted) return
          retrying = attempt < UPLOAD_ATTEMPTS
          setUploadProblem({ status: null, retrying })
          if (!retrying) return
        }
        await new Promise(resolve => { window.setTimeout(resolve, uploadRetryDelay(attempt)) })
        if (cancelled || controller.signal.aborted) return
      }
    })()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [paper, sessionId])

  const cite = useCallback((text: string, page: number): string => {
    return `${text}\n\n— ${paper?.name ?? ''} p.${page}`
  }, [paper])

  const quote = useCallback((text: string, page: number): void => {
    inputActions?.insertQuote(cite(text, page))
  }, [cite, inputActions])

  /**
   * Quote a passage and ask about it in ONE deterministic editor mutation.
   *
   * The old two-step (insertQuote, then insertText over a captured span) relied
   * on two editor projections settling before `submit()` snapshotted the draft;
   * when the instruction did not land, the sent message carried only the quote
   * and the agent naturally explained instead of translating. One setDraft writes
   * the whole message — blockquote + attribution + explicit instruction outside
   * the quote — so submit always sends both halves in the right order.
   */
  const ask = useCallback((text: string, page: number, kind: 'explain' | 'translate'): void => {
    if (inputActions === undefined) {
      setError(t('errorNoActions'))
      return
    }
    const instruction = kind === 'explain' ? t('explainPrompt') : t('translatePrompt')
    const quoted = cite(text, page).split('\n').map(line => `> ${line}`).join('\n')
    inputActions.setDraft(`${quoted}\n\n${instruction}`)
    inputActions.submit()
  }, [cite, inputActions, t])

  /**
   * Put the viewer's paper-digest prompt into the composer in ONE mutation,
   * without sending: the user reviews it first. `false` tells the viewer the
   * composer is unavailable so it can fall back to the clipboard and say so.
   */
  const deliverDigest = useCallback((prompt: string): boolean => {
    const actions = inputActions
    if (actions === undefined || typeof actions.setDraft !== 'function') return false
    actions.setDraft(prompt)
    return true
  }, [inputActions])

  // Visible, non-blocking lines for writes the Host rejected: a hidden console
  // warning was exactly how the annotation bug stayed invisible.
  const warnings: string[] = []
  if (uploadProblem !== null) warnings.push(problemLine(t('paperUploadFailed'), uploadProblem, t))
  if (annotations.loadProblem !== null) warnings.push(problemLine(t('annotationLoadFailed'), annotations.loadProblem, t))
  if (annotations.saveProblem !== null) warnings.push(problemLine(t('annotationSaveFailed'), annotations.saveProblem, t))

  if (paper !== null) {
    return h('div', { className: 'pr-body' },
      h('style', null, BODY_CSS),
      h('div', { className: 'pr-head' },
        h('span', { className: 'pr-name', title: paper.name }, paper.name),
        h('button', { type: 'button', className: 'pr-open-btn', onClick: reset }, t('changePaper')),
      ),
      ...warnings.map(line => h('div', { className: 'pr-warn', key: line }, line)),
      error !== null && h('div', { className: 'pr-error' }, error),
      viewer === null
        ? h('div', { className: 'pr-status' }, t('loading'))
        : h(viewer, {
          bytes: paper.bytes,
          storageKey: paper.storageKey,
          name: paper.name,
          t,
          highlights: annotations.highlights,
          // The tab type keeps this body mounted while another right-sidebar tab
          // is in front; the viewer uses this to release its heavy resources.
          visible: tab.visible,
          onCreateAnnotation: annotations.addAnnotation,
          onUpdateNote: annotations.updateNote,
          onUpdateTextBox: annotations.updateTextBox,
          onDeleteAnnotation: annotations.removeAnnotation,
          onQuote: quote,
          onAsk: ask,
          onDigest: deliverDigest,
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
      // Newest first, and only when there is history: an empty state with a
      // "recently opened" heading over nothing would just add noise.
      recent.length > 0 && h('div', { className: 'pr-recent' },
        h('div', { className: 'pr-recent-title' }, t('recentTitle')),
        ...recent.map(entry => h('div', { key: entry.key, className: 'pr-recent-row' },
          h('button', {
            type: 'button',
            className: 'pr-recent-open',
            title: entry.path ?? entry.key,
            disabled: busy,
            onClick: () => void openRecent(entry),
          }, h('span', { className: 'pr-recent-name' }, entry.name)),
          h('button', {
            type: 'button',
            className: 'pr-recent-x',
            title: t('recentRemove'),
            'aria-label': t('recentRemove'),
            onClick: () => forgetRecent(entry.key),
          }, '×'),
        )),
      ),
      error !== null && h('div', { className: 'pr-error' }, error),
      ...warnings.map(line => h('div', { className: 'pr-warn', key: line }, line)),
    ),
  )
}
