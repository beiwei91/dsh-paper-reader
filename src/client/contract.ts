/**
 * The boundary between the always-loaded Client bundle and the lazily loaded
 * PDF chunk. Types only — importing this module must never pull PDF.js in.
 */
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { WorkspaceByteReadOptions, WorkspaceFileBytes } from '@deepseek-ai/dsh-api-workspace-files/types'
import type { InputActions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { UseSidebarRightTabInfo } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Highlight, HighlightColor } from './annotations.ts'
import type { PaperReaderLocaleKey } from './types.ts'

/** Props the reader chunk's exported viewer takes. */
export interface PdfViewerProps {
  /** Complete PDF bytes; the viewer copies them before transferring to the PDF worker. */
  bytes: Uint8Array<ArrayBuffer>
  /** Stable key for the remembered reading position and the annotation file. */
  storageKey: string
  /** The paper's display name, used in the digest prompt header. */
  name?: string
  /** The plugin's copy function, so the chunk needs no locale service of its own. */
  t: (key: PaperReaderLocaleKey) => string
  /** Every stored highlight of this paper; the viewer paints the ones on screen. */
  highlights: readonly Highlight[]
  /**
   * Whether the tab that hosts this viewer is actually on screen. The tab body
   * stays mounted while hidden and uses this to release the PDF worker,
   * document, canvases and text layers until the tab is shown again.
   */
  visible?: boolean
  onCreateHighlight(input: { page: number; color: HighlightColor; quote: string }): void
  onUpdateNote(id: string, note: string): void
  onDeleteHighlight(id: string): void
  /** Put a selection into the conversation composer as a quote. */
  onQuote(text: string, page: number): void
  /** Quote a selection and ask the agent about it. */
  onAsk(text: string, page: number, kind: 'explain' | 'translate'): void
  /**
   * Put a paper-digest prompt into the conversation composer as one draft
   * mutation, without sending it. Returns whether the composer took it; `false`
   * asks the viewer to fall back to the clipboard.
   */
  onDigest?: (prompt: string) => boolean
}

/** Props the tab body receives: the injected face, the copy, and the standard Session props. */
export interface PapersBodyProps {
  readonly reader: PaperReader
  readonly t: (key: PaperReaderLocaleKey) => string
  readonly inputActions?: InputActions
  readonly sessionId?: string
  /**
   * The standard tab-body hook the seat injects. `tab.id` identifies this tab
   * occurrence, which is what makes the open paper survive an unmount.
   */
  readonly useTabInfo: UseSidebarRightTabInfo
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
