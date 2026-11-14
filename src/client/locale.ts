import type { LocaleDictOf } from '@deepseek-ai/dsh-client-ui-slots'
import type { DshClientContext } from './types.ts'

/** This plugin's Client copy namespace. */
export const LOCALE_NS = 'paperReader'

const zh: LocaleDictOf<'paperReader'> = {
  title: '论文',
  guideTitle: '论文阅读器',
  guideDescription: '打开本地 PDF 或 arXiv 论文',
  skeleton: '论文阅读器 · 骨架已就位，阅读层在下一阶段接入',
  emptyTitle: '还没有打开论文',
  emptyHint: '把 PDF 拖到这里，或填写本机绝对路径',
  pathPlaceholder: 'D:\\papers\\attention-is-all-you-need.pdf',
  open: '打开',
  dropHint: '支持 .pdf，拖拽即开',
  changePaper: '换一篇',
  loading: '正在载入论文…',
  errorNoSession: '当前会话不可用，无法读取本地文件',
  errorRead: '读取失败',
  errorNotText: '这不是文本文件，无法作为论文打开',
  errorTooLarge: '文件超过 32 MiB 上限',
  errorOpen: '只支持 PDF 文件',
  outline: '目录',
  outlineEmpty: '这篇论文没有目录',
  search: '搜索',
  searchPlaceholder: '在全文里搜索',
  searchRunning: '正在搜索…',
  searchNoResults: '没有匹配',
  searchCount: '匹配',
  zoomIn: '放大',
  zoomOut: '缩小',
  fitWidth: '适宽',
  pageOf: '页',
}

const en: LocaleDictOf<'paperReader'> = {
  title: 'Papers',
  guideTitle: 'Paper Reader',
  guideDescription: 'Open a local PDF or an arXiv paper',
  skeleton: 'Paper Reader · skeleton installed, the reading layer lands next',
  emptyTitle: 'No paper open yet',
  emptyHint: 'Drop a PDF here, or paste an absolute path',
  pathPlaceholder: 'D:\\papers\\attention-is-all-you-need.pdf',
  open: 'Open',
  dropHint: 'PDF only — dropping opens it',
  changePaper: 'Change',
  loading: 'Loading paper…',
  errorNoSession: 'No active session, so local files cannot be read',
  errorRead: 'Read failed',
  errorNotText: 'That file is not text and cannot open as a paper',
  errorTooLarge: 'The file exceeds the 32 MiB limit',
  errorOpen: 'PDF files only',
  outline: 'Outline',
  outlineEmpty: 'This paper has no outline',
  search: 'Search',
  searchPlaceholder: 'Search the whole paper',
  searchRunning: 'Searching…',
  searchNoResults: 'No matches',
  searchCount: 'matches',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  fitWidth: 'Fit',
  pageOf: 'of',
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
