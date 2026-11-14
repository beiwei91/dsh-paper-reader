import type { LocaleDictOf } from '@deepseek-ai/dsh-client-ui-slots'
import type { DshClientContext } from './types.ts'

/** This plugin's Client copy namespace. */
export const LOCALE_NS = 'paperReader'

const zh: LocaleDictOf<'paperReader'> = {
  title: '论文',
  guideTitle: '论文阅读器',
  guideDescription: '打开本地 PDF 或 arXiv 论文',
  skeleton: '论文阅读器 · 骨架已就位，阅读层在下一阶段接入',
}

const en: LocaleDictOf<'paperReader'> = {
  title: 'Papers',
  guideTitle: 'Paper Reader',
  guideDescription: 'Open a local PDF or an arXiv paper',
  skeleton: 'Paper Reader · skeleton installed, the reading layer lands next',
}

/** Register this plugin's dictionaries; the returned disposer lives in one effect. */
export function registerPapersLocale(ctx: DshClientContext): () => void {
  const disposeZh = ctx.locale.register(LOCALE_NS, 'zh', zh)
  const disposeEn = ctx.locale.register(LOCALE_NS, 'en', en)
  return () => {
    disposeEn()
    disposeZh()
  }
}
