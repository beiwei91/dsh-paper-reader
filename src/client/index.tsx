import { createElement } from 'react'
import { LOCALE_NS, registerPapersLocale } from './locale.ts'
import type { DshClientContext } from './types.ts'

/** Stable identity of this implementation; the key its body and title register under. */
const TAB_ID = '@local/dsh-paper-reader'
/** Type discriminator the guide entry and `openTab` name. */
const PAPER_KIND = 'paper-reader'

const bodyStyle = {
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '24px',
  textAlign: 'center' as const,
  fontSize: '13px',
  lineHeight: 1.6,
  color: 'var(--dsw-alias-label-secondary, #57606a)',
}

export const inject = ['slots', 'locale', 'sidebarRightTabs']

export function apply(ctx: DshClientContext): void {
  ctx.effect(() => registerPapersLocale(ctx), 'paper-reader: locale')
  const t = ctx.locale.bind(LOCALE_NS)

  function PapersBody() {
    return createElement('div', { style: bodyStyle, 'data-paper-reader-phase': 'skeleton' }, t('skeleton'))
  }

  function PapersTitle() {
    return createElement('span', null, t('title'))
  }

  // Stage one: the tab type, its title thunk and the guide-page entry.
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: TAB_ID,
    kind: PAPER_KIND,
    multiple: true,
    keepMounted: true,
    title: () => t('title'),
    guide: [{
      id: 'papers',
      order: 20,
      title: () => t('guideTitle'),
      description: () => t('guideDescription'),
    }],
  }), 'paper-reader: tab type')

  // Stage two: the keyed body and its live title chip.
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: TAB_ID, locale: LOCALE_NS },
    PapersBody,
  )), 'paper-reader: tab body')

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab.title', key: TAB_ID, locale: LOCALE_NS },
    PapersTitle,
  )), 'paper-reader: tab title')
}
