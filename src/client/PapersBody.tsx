import { createElement as h, useCallback, useEffect, useRef, useState } from 'react'
import type { ComponentType, DragEvent } from 'react'
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

/** The chunk is fetched once per Client module, however many tabs open. */
let chunkPromise: Promise<PdfChunkModule> | null = null
function loadViewer(): Promise<PdfChunkModule> {
  chunkPromise ??= __dshRequireAsync('./client.pdf.js') as Promise<PdfChunkModule>
  return chunkPromise
}

/**
 * The tab body: an empty state that opens a paper (absolute path through the
 * Host, or a dropped file read in the page), then the lazily loaded reader.
 */
export function PapersBody({ reader, t, sessionId }: PapersBodyProps): ReturnType<typeof h> {
  const [paper, setPaper] = useState<OpenPaper | null>(null)
  const [viewer, setViewer] = useState<ComponentType<PdfViewerProps> | null>(null)
  const [pathInput, setPathInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dropping, setDropping] = useState(false)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
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
    try {
      const result = await reader.readBytes(sessionId as never, path, {})
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
    setError(null)
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (!alive.current) return
    setPaper({ name: file.name, storageKey: `drop:${file.name}:${file.size}`, bytes })
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
        : h(viewer, { bytes: paper.bytes, storageKey: paper.storageKey, t }),
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
