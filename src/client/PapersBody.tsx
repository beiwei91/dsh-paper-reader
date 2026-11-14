import { createElement as h, useCallback, useEffect, useRef, useState } from 'react'
import type { ComponentType, DragEvent } from 'react'
import { useAnnotations } from './annotations.ts'
import { BODY_CSS } from './pdf/styles.ts'
import type { PapersBodyProps, PdfChunkModule, PdfViewerProps } from './contract.ts'
import type { PaperReaderLocaleKey } from './types.ts'

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

/**
 * The tab body: an empty state that opens a paper (absolute path through the
 * Host, or a dropped file read in the page), then the lazily loaded reader with
 * its annotation store and the conversation actions.
 */
export function PapersBody({ reader, t, inputActions, sessionId }: PapersBodyProps): ReturnType<typeof h> {
  const [paper, setPaper] = useState<OpenPaper | null>(null)
  const [viewer, setViewer] = useState<ComponentType<PdfViewerProps> | null>(null)
  const [pathInput, setPathInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dropping, setDropping] = useState(false)
  const alive = useRef(true)
  const abortRef = useRef<AbortController | null>(null)
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
    setPaper(null)
    setError(null)
    setPathInput('')
  }, [])

  // The Host needs the bytes to answer the agent's paper_* tools; a failure
  // here only costs those tools, never the reading experience.
  useEffect(() => {
    if (paper === null || sessionId === undefined || sessionId === '') return
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
      error !== null && h('div', { className: 'pr-error' }, error),
    ),
  )
}
