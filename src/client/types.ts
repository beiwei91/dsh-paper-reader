/**
 * Client-platform typing for this plugin.
 *
 * The augmented `Context` (ctx.slots, ctx.locale, ctx.sidebarRightTabs, ctx.remote)
 * and the locale namespace come from the real DSH Client packages installed as
 * dev dependencies — never from hand-written mirrors, so contract drift is a
 * type error instead of a runtime surprise.
 */
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-workspace-files/remote'
import type { Context } from '@deepseek-ai/cordis'

/** Every copy key this plugin's Client half uses. */
export type PaperReaderLocaleKey =
  | 'title'
  | 'guideTitle'
  | 'guideDescription'
  | 'emptyTitle'
  | 'emptyHint'
  | 'pathPlaceholder'
  | 'open'
  | 'dropHint'
  | 'changePaper'
  | 'loading'
  | 'errorNoSession'
  | 'errorRead'
  | 'errorNotText'
  | 'errorTooLarge'
  | 'errorOpen'
  | 'outline'
  | 'outlineEmpty'
  | 'search'
  | 'searchPlaceholder'
  | 'searchRunning'
  | 'searchNoResults'
  | 'searchCount'
  | 'zoomIn'
  | 'zoomOut'
  | 'fitWidth'
  | 'highlight'
  | 'quoteAction'
  | 'explain'
  | 'translate'
  | 'copy'
  | 'notes'
  | 'notesEmpty'
  | 'notePlaceholder'
  | 'noteSave'
  | 'noteDelete'
  | 'explainPrompt'
  | 'translatePrompt'
  | 'arxivIdPlaceholder'
  | 'arxivOpen'
  | 'arxivSearchPlaceholder'
  | 'arxivSearch'
  | 'arxivSearching'
  | 'arxivNoResult'
  | 'arxivOpenFailed'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    paperReader: PaperReaderLocaleKey
  }
}

export type DshClientContext = Context
