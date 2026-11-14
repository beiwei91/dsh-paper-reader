/**
 * arXiv fetch and keyword search, host side.
 *
 * The page cannot fetch arxiv.org itself (no CORS, and the paper bytes must be
 * stored next to the annotations anyway), so both operations run here and the
 * Client only ever talks to this listener.
 */
import { paperPaths, writeBytes } from './store.ts'

const ARXIV_PDF = 'https://arxiv.org/pdf/'
const ARXIV_API = 'https://export.arxiv.org/api/query'
const TIMEOUT_MS = 45000
const METADATA_TIMEOUT_MS = 10000
const MAX_PDF_BYTES = 32 * 1024 * 1024

/** A failure the caller's request caused, with the status the route should send. */
export class ArxivRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'ArxivRequestError'
  }
}

export interface ArxivEntry {
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly published: string
  readonly authors: readonly string[]
}

export interface ArxivPaper {
  readonly id: string
  readonly key: string
  readonly title: string
  readonly bytes: number
}

/** A bare id, an arxiv pdf/abs URL, or a link with a version suffix. */
export function normalizeArxivId(input: string): string | null {
  const text = input
    .trim()
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
    .replace(/^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\//i, '')
    .replace(/\.pdf$/i, '')
    .replace(/v\d+$/i, '')
    .trim()
  if (/^\d{4}\.\d{4,5}$/.test(text)) return text
  // Legacy identifiers keep their archive prefix, e.g. cond-mat.mes-hall/0601001.
  if (/^[a-z-]+(?:\.[A-Z]{2})?\/\d{7}$/.test(text)) return text
  return null
}

function decodeXml(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

async function getText(url: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(url, {
    signal: AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), ...(signal === undefined ? [] : [signal])]),
    headers: { 'user-agent': 'dsh-paper-reader/0.1' },
  })
  if (!response.ok) throw new Error(`arXiv replied ${response.status}`)
  return await response.text()
}

/** One Atom feed entry, parsed with a deliberately small regex reader. */
function parseEntries(xml: string): ArxivEntry[] {
  const entries: ArxivEntry[] = []
  for (const block of xml.split('<entry>').slice(1)) {
    const body = block.split('</entry>')[0] ?? ''
    const id = /<id>([^<]+)<\/id>/.exec(body)?.[1] ?? ''
    const title = decodeXml(/<title>([\s\S]*?)<\/title>/.exec(body)?.[1] ?? '')
    const summary = decodeXml(/<summary>([\s\S]*?)<\/summary>/.exec(body)?.[1] ?? '')
    const published = (/<published>([^<]+)<\/published>/.exec(body)?.[1] ?? '').slice(0, 10)
    const authors = Array.from(body.matchAll(/<name>([\s\S]*?)<\/name>/g)).map(match => decodeXml(match[1] ?? ''))
    const normalized = normalizeArxivId(id)
    if (normalized === null) continue
    entries.push({ id: normalized, title, summary, published, authors })
  }
  return entries
}

/** Fetch the paper's metadata from the Atom API. */
export async function fetchArxivMetadata(id: string, signal?: AbortSignal): Promise<ArxivEntry | null> {
  const xml = await getText(`${ARXIV_API}?id_list=${encodeURIComponent(id)}`, signal)
  return parseEntries(xml)[0] ?? null
}

/** Download one paper and store its bytes under the `arxiv:<id>` key. */
export async function fetchArxivPaper(input: string, signal?: AbortSignal): Promise<ArxivPaper> {
  const id = normalizeArxivId(input)
  if (id === null) throw new ArxivRequestError('That does not look like an arXiv id or link.', 400)
  const response = await fetch(`${ARXIV_PDF}${encodeURIComponent(id)}`, {
    signal: AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), ...(signal === undefined ? [] : [signal])]),
    headers: { 'user-agent': 'dsh-paper-reader/0.1' },
  })
  if (!response.ok) throw new Error(`arXiv replied ${response.status}`)
  const declared = Number(response.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > MAX_PDF_BYTES) {
    throw new ArxivRequestError('The PDF is larger than the 32 MiB cap.', 413)
  }
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType !== '' && !/pdf/i.test(contentType)) {
    throw new ArxivRequestError('arXiv did not return a PDF.', 502)
  }
  const buffer = new Uint8Array(await response.arrayBuffer())
  if (buffer.length === 0) throw new Error('arXiv returned an empty PDF.')
  if (buffer.length > MAX_PDF_BYTES) throw new ArxivRequestError('The PDF is larger than the 32 MiB cap.', 413)
  if (!(buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46)) {
    throw new ArxivRequestError('arXiv did not return a PDF.', 502)
  }
  const key = `arxiv:${id}`
  await writeBytes(paperPaths(key).pdf, buffer)
  let title = ''
  try {
    // Metadata is a nicety: never let it hold the open behind the PDF itself.
    title = (await fetchArxivMetadata(id, AbortSignal.any([AbortSignal.timeout(METADATA_TIMEOUT_MS), ...(signal === undefined ? [] : [signal])])))?.title ?? ''
  } catch {
    title = ''
  }
  return { id, key, title, bytes: buffer.length }
}

/** Keyword search over arXiv metadata. */
export async function searchArxiv(query: string, max: number, signal?: AbortSignal): Promise<ArxivEntry[]> {
  const trimmed = query.trim()
  if (trimmed === '') return []
  const xml = await getText(
    `${ARXIV_API}?search_query=${encodeURIComponent(`all:${trimmed}`)}&start=0&max_results=${Math.min(20, Math.max(1, max))}`,
    signal,
  )
  return parseEntries(xml)
}
