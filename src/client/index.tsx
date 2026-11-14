import { createElement } from 'react'
import { PapersBody } from './PapersBody.tsx'
import { LOCALE_NS, registerPapersLocale } from './locale.ts'
import type { DshClientContext } from './types.ts'

/** Stable identity of this implementation; the key its body and title register under. */
const TAB_ID = '@local/dsh-paper-reader'
/** Type discriminator the guide entry and `openTab` name. */
const PAPER_KIND = 'paper-reader'

export const inject = ['slots', 'locale', 'sidebarRightTabs', 'remote', 'remote.workspaceFiles']

export function apply(ctx: DshClientContext): void {
  ctx.effect(() => registerPapersLocale(ctx), 'paper-reader: locale')
  const t = ctx.locale.bind(LOCALE_NS)
  const reader = {
    readBytes: (sessionId: Parameters<typeof ctx.remote.workspaceFiles.readBytes>[0], path: string, options: Parameters<typeof ctx.remote.workspaceFiles.readBytes>[2], signal?: AbortSignal) =>
      ctx.remote.workspaceFiles.readBytes(sessionId, path, options, signal),
  }

  function PapersTitle() {
    return createElement('span', null, t('title'))
  }

  // Stage one: the tab type, its title thunk and the guide-page entry.
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: TAB_ID,
    kind: PAPER_KIND,
    multiple: true,
    // Hidden tabs unmount: a mounted viewer keeps a PDF worker, a document and
    // its canvas bitmaps alive, which makes many open tabs fight for memory.
    // The body remembers the open paper per tab (Host bytes + a localStorage
    // pointer), so a remount restores it instead of showing the empty state.
    keepMounted: false,
    title: () => t('title'),
    guide: [{
      id: 'papers',
      order: 20,
      title: () => t('guideTitle'),
      description: () => t('guideDescription'),
    }],
  }), 'paper-reader: tab type')

  // Stage two: the keyed body and its live title chip. The body receives the
  // Host read and the copy function through the seat's injection, so it never
  // reaches for the Cordis context itself.
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    {
      name: 'sidebar.right.pane.tab',
      key: TAB_ID,
      locale: LOCALE_NS,
      inject: () => ({ reader, t }),
    },
    PapersBody,
  )), 'paper-reader: tab body')

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab.title', key: TAB_ID, locale: LOCALE_NS },
    PapersTitle,
  )), 'paper-reader: tab title')
}
