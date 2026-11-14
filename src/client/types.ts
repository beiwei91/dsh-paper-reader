/**
 * Client-platform typing for this plugin.
 *
 * The augmented `Context` (ctx.slots, ctx.locale, ctx.sidebarRightTabs) and the
 * locale namespace come from the real DSH Client packages, installed as dev
 * dependencies — never from hand-written mirrors, so contract drift is a type
 * error instead of a runtime surprise.
 */
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    paperReader: 'title' | 'guideTitle' | 'guideDescription' | 'skeleton'
  }
}

export type DshClientContext = Context
