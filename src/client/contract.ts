/**
 * The boundary between the always-loaded Client bundle and the lazily loaded
 * PDF chunk. Types only — importing this module must never pull PDF.js in.
 */
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { WorkspaceByteReadOptions, WorkspaceFileBytes } from '@deepseek-ai/dsh-api-workspace-files/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PaperReaderLocaleKey } from './types.ts'

/** Props the reader chunk's exported viewer takes. */
export interface PdfViewerProps {
  /** Complete PDF bytes; the viewer copies them before transferring to the PDF worker. */
  bytes: Uint8Array<ArrayBuffer>
  /** Stable key for the remembered reading position (absolute path or dropped-file identity). */
  storageKey: string
  /** The plugin's copy function, so the chunk needs no locale service of its own. */
  t: (key: PaperReaderLocaleKey) => string
}

/** Props the tab body receives: the two injected faces plus the standard Session prop. */
export interface PapersBodyProps {
  readonly reader: PaperReader
  readonly t: (key: PaperReaderLocaleKey) => string
  readonly sessionId?: string
}

/** The one Host read the body performs, injected so the body never names the Remote. */
export interface PaperReader {
  readBytes(
    sessionId: SessionId,
    path: string,
    options: WorkspaceByteReadOptions,
    signal?: AbortSignal,
  ): Promise<RemoteResult<WorkspaceFileBytes>>
}

/** The chunk's module shape, as `require.async('./client.pdf.js')` resolves it. */
export interface PdfChunkModule {
  PdfViewer: import('react').ComponentType<PdfViewerProps>
}
