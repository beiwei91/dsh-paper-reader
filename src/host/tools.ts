/**
 * Read-only agent tools over the paper open in the calling session.
 *
 * The Client pushes the current paper (bytes + key) to this bundle's route, so a
 * tool needs no path from the model: it resolves the key from `exec.agent`'s
 * session and reads the cached text. Tool definitions are hand-written (the
 * registry accepts the plain shape) so the Host artifact carries no runtime
 * DSH dependency.
 */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { annotationPath, readJson } from './store.ts'
import { loadPaperText, type PaperText } from './text.ts'

export interface CurrentPaper {
  readonly key: string
  readonly title: string
}

const DEFAULT_MAX_CHARS = 12000
const MAX_MAX_CHARS = 30000
const DEFAULT_MATCHES = 20
const MAX_MATCHES = 50

function render(value: string) {
  return [{ type: 'text' as const, text: value }]
}

/** The session id the tool call runs for, from the agent the executor supplies. */
function sessionIdOf(exec: { agent?: unknown }): string | null {
  const agent = exec.agent as { readonly session?: { readonly id?: string }; readonly id?: string } | undefined
  return agent?.session?.id ?? agent?.id ?? null
}

function parsePages(spec: string | undefined, numPages: number): { from: number; to: number } {
  const clamp = (value: number): number => Math.min(numPages, Math.max(1, value))
  if (spec === undefined || spec.trim() === '' || spec.trim().toLowerCase() === 'all') return { from: 1, to: numPages }
  const match = /^(\d+)\s*(?:[-–~]\s*(\d+))?$/.exec(spec.trim())
  if (match === null) throw new Error(`Unsupported page range "${spec}"; use "3", "3-7" or "all".`)
  return { from: clamp(Number(match[1])), to: clamp(Number(match[2] ?? match[1])) }
}

function describe(text: PaperText): string {
  const withText = text.pages.filter(page => page.trim() !== '').length
  return [
    `标题: ${text.title === '' ? '(PDF 元数据没有标题)' : text.title}`,
    `页数: ${text.numPages}`,
    `有文本层: ${withText}/${text.numPages} 页`,
    `目录项: ${text.outline.length}`,
  ].join('\n')
}

export function createTools(current: ReadonlyMap<string, CurrentPaper>): ToolDefinition[] {
  const resolve = (exec: { agent?: unknown }): { paper: CurrentPaper; sessionId: string } => {
    const sessionId = sessionIdOf(exec)
    if (sessionId === null) throw new Error('This call has no session, so it cannot resolve the open paper.')
    const paper = current.get(sessionId)
    if (paper === undefined) {
      throw new Error(`No paper is open in this session (${sessionId}). Open one in the 「论文」 tab of the right sidebar first.`)
    }
    return { paper, sessionId }
  }

  const load = async (exec: { agent?: unknown; signal?: AbortSignal }): Promise<{ paper: CurrentPaper; text: PaperText }> => {
    const { paper } = resolve(exec)
    const text = await loadPaperText(paper.key, exec.signal)
    if (text === null) {
      throw new Error('The open paper has no stored bytes yet; reopen it in the 「论文」 tab so it can be read here.')
    }
    return { paper, text }
  }

  return [
    {
      name: 'paper_info',
      description:
        'Describe the paper currently open in the 论文 tab of this session: title, page count, how many pages carry a text layer, outline size, and how many highlights are saved.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: { schema: { type: 'string' }, render: (args: unknown, value: unknown) => render(String(value)) },
      async execute(_args: unknown, exec: { agent?: unknown; signal?: AbortSignal }): Promise<string> {
        const { paper, text } = await load(exec)
        const annotations = await readJson<{ highlights?: unknown[] }>(annotationPath(paper.key))
        const highlights = Array.isArray(annotations?.highlights) ? annotations.highlights.length : 0
        const described = text.title === '' && paper.title !== '' ? { ...text, title: paper.title } : text
        return [`key: ${paper.key}`, describe(described), `已存高亮: ${highlights}`].join('\n')
      },
    },
    {
      name: 'paper_outline',
      description:
        'List the outline (table of contents) of the paper currently open in this session, as indented entries with page numbers. Use it before paper_read to pick a page range.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: { schema: { type: 'string' }, render: (args: unknown, value: unknown) => render(String(value)) },
      async execute(_args: unknown, exec: { agent?: unknown; signal?: AbortSignal }): Promise<string> {
        const { text } = await load(exec)
        if (text.outline.length === 0) return '这篇论文没有可解析的目录。'
        return text.outline
          .map(entry => `${'  '.repeat(entry.depth)}${entry.title}${entry.page === null ? '' : ` — p.${entry.page}`}`)
          .join('\n')
      },
    },
    {
      name: 'paper_read',
      description:
        'Read the extracted text of pages from the paper currently open in this session. Output is bounded; omit pages for the first pages.',
      parameters: {
        type: 'object',
        properties: {
          pages: { type: 'string', description: 'Page range: "3", "3-7" or "all". Defaults to the first three pages.' },
          maxChars: { type: 'number', description: `Character budget, default ${DEFAULT_MAX_CHARS}, cap ${MAX_MAX_CHARS}.` },
        },
        additionalProperties: false,
      },
      output: { schema: { type: 'string' }, render: (args: unknown, value: unknown) => render(String(value)) },
      async execute(args: unknown, exec: { agent?: unknown; signal?: AbortSignal }): Promise<string> {
        const input = (args ?? {}) as { pages?: string; maxChars?: number }
        const { text } = await load(exec)
        const range = input.pages === undefined ? { from: 1, to: Math.min(3, text.numPages) } : parsePages(input.pages, text.numPages)
        const budget = Math.min(MAX_MAX_CHARS, Math.max(500, Math.floor(input.maxChars ?? DEFAULT_MAX_CHARS)))
        const parts: string[] = []
        let used = 0
        let truncated = false
        for (let page = range.from; page <= range.to; page += 1) {
          if (exec.signal?.aborted === true) throw new Error('Reading was cancelled.')
          const body = text.pages[page - 1] ?? ''
          const block = `\n[第 ${page} 页]\n${body.trim() === '' ? '(这一页没有文本层)' : body}`
          if (used + block.length > budget) {
            const room = budget - used
            if (room > 80) parts.push(`${block.slice(0, room)}…`)
            truncated = true
            break
          }
          used += block.length
          parts.push(block)
        }
        const header = `页码: ${range.from}–${range.to} / 共 ${text.numPages} 页`
        return `${header}${truncated ? '（已达字符上限，结果被截断）' : ''}\n${parts.join('\n')}`
      },
    },
    {
      name: 'paper_search',
      description:
        'Search the text of the paper currently open in this session for a keyword or phrase and return matching pages with a short snippet around each match.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Keyword or phrase, case-insensitive.' },
          maxResults: { type: 'number', description: `Maximum pages returned, default ${DEFAULT_MATCHES}, cap ${MAX_MATCHES}.` },
        },
        required: ['query'],
        additionalProperties: false,
      },
      output: { schema: { type: 'string' }, render: (args: unknown, value: unknown) => render(String(value)) },
      async execute(args: unknown, exec: { agent?: unknown; signal?: AbortSignal }): Promise<string> {
        const input = (args ?? {}) as { query?: string; maxResults?: number }
        const query = (input.query ?? '').trim()
        if (query === '') throw new Error('query must not be empty.')
        const { text } = await load(exec)
        const limit = Math.min(MAX_MATCHES, Math.max(1, Math.floor(input.maxResults ?? DEFAULT_MATCHES)))
        const needle = query.toLowerCase()
        const rows: string[] = []
        for (let page = 1; page <= text.numPages && rows.length < limit; page += 1) {
          if (exec.signal?.aborted === true) throw new Error('Search was cancelled.')
          const body = text.pages[page - 1] ?? ''
          const at = body.toLowerCase().indexOf(needle)
          if (at < 0) continue
          let count = 0
          let cursor = at
          while (cursor >= 0) {
            count += 1
            cursor = body.toLowerCase().indexOf(needle, cursor + needle.length)
          }
          const from = Math.max(0, at - 40)
          const snippet = `${from > 0 ? '…' : ''}${body.slice(from, Math.min(body.length, at + query.length + 60))}`
          rows.push(`p.${page} · ${count} 处 — ${snippet}`)
        }
        if (rows.length === 0) return `没有找到「${query}」。`
        return [`共 ${rows.length} 页匹配「${query}」:`, ...rows].join('\n')
      },
    },
  ]
}
