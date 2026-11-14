/**
 * Host half of the paper-reader bundle.
 *
 * It owns what the Client half cannot do itself:
 *  - the on-disk annotation store and the paper bytes the agent tools read,
 *    behind one loopback-only route on the same listener as the GUI;
 *  - the read-only agent tools (`paper_info`, `paper_outline`, `paper_read`,
 *    `paper_search`) over the paper open in the calling session.
 *
 * Storage lives under the DSH home, never in the user's workspace.
 */
import { unlink } from 'node:fs/promises'
import { ArxivRequestError, fetchArxivPaper, searchArxiv } from './arxiv.ts'
import { annotationPath, paperPaths, readBytes, readJson, writeBytes, writeJson } from './store.ts'
import { createTools, type CurrentPaper } from './tools.ts'

interface HostContext {
  effect(run: () => void | (() => void), label?: string): void
  tools: { register(definition: unknown): () => void }
  webServer: {
    register(route: {
      kind: 'exact' | 'prefix'
      path: string
      handler(request: IncomingMessageLike, response: ServerResponseLike): void | Promise<void>
    }): () => void
  }
}

interface IncomingMessageLike {
  readonly method?: string
  readonly url?: string
  readonly headers: Record<string, string | string[] | undefined>
  on(event: 'data', listener: (chunk: Uint8Array) => void): void
  on(event: 'end', listener: () => void): void
  on(event: 'error', listener: (error: Error) => void): void
  on(event: 'close', listener: () => void): void
  resume(): void
  destroy(): void
}

interface ServerResponseLike {
  writeHead(status: number, headers: Record<string, string | number>): void
  end(body?: string | Uint8Array): void
}

const ROUTE = '/paper-reader/api'
const JSON_BODY_LIMIT = 2 * 1024 * 1024
const PDF_BODY_LIMIT = 32 * 1024 * 1024
const COLORS = new Set(['yellow', 'green', 'blue', 'pink'])

interface Highlight {
  readonly id: string
  readonly page: number
  readonly quote: string
  readonly note: string
  readonly color: string
  readonly createdAt: number
}

/** Only a page served from this machine may reach the storage routes. */
function isLoopbackHost(host: string | string[] | undefined): boolean {
  if (typeof host !== 'string') return false
  const name = host.replace(/:\d+$/, '').toLowerCase()
  return name === '127.0.0.1' || name === 'localhost' || name === '[::1]'
}

/** Writes additionally require an Origin that matches the serving host. */
function sameOrigin(headers: IncomingMessageLike['headers']): boolean {
  const origin = headers.origin
  const host = headers.host
  if (typeof origin !== 'string' || typeof host !== 'string') return false
  try {
    const parsed = new URL(origin)
    return parsed.host === host && isLoopbackHost(parsed.host)
  } catch {
    return false
  }
}

function sendJson(response: ServerResponseLike, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  response.end(body)
}

class BodyTooLargeError extends Error {
  constructor() {
    super('body too large')
    this.name = 'BodyTooLargeError'
  }
}

function readBody(request: IncomingMessageLike, limit: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []
    let size = 0
    let settled = false
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      reject(error)
    }
    request.on('data', chunk => {
      if (settled) return
      size += chunk.length
      if (size > limit) {
        // Keep the socket alive long enough to answer 413; the caller drains it.
        fail(new BodyTooLargeError())
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (settled) return
      settled = true
      const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
      const body = new Uint8Array(total)
      let offset = 0
      for (const chunk of chunks) {
        body.set(chunk, offset)
        offset += chunk.length
      }
      resolve(body)
    })
    request.on('error', error => fail(error))
    // A client that walks away mid-body must not leave this promise pending.
    request.on('close', () => {
      if (!settled) fail(new Error('request closed'))
    })
  })
}

function parseJsonBody(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new BadRequestError('bad-json')
  }
}

class BadRequestError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'BadRequestError'
  }
}

function sanitizeHighlight(value: unknown): Highlight | null {
  if (value === null || typeof value !== 'object') return null
  const input = value as Record<string, unknown>
  const id = typeof input.id === 'string' && input.id.length <= 80 ? input.id : null
  const page = typeof input.page === 'number' && Number.isInteger(input.page) && input.page > 0 ? input.page : null
  const quote = typeof input.quote === 'string' ? input.quote.slice(0, 2000) : null
  if (id === null || page === null || quote === null || quote === '') return null
  return {
    id,
    page,
    quote,
    note: typeof input.note === 'string' ? input.note.slice(0, 4000) : '',
    color: typeof input.color === 'string' && COLORS.has(input.color) ? input.color : 'yellow',
    createdAt: typeof input.createdAt === 'number' && Number.isFinite(input.createdAt) ? input.createdAt : Date.now(),
  }
}

export const inject = ['webServer', 'tools']

export function apply(ctx: HostContext): void {
  const current = new Map<string, CurrentPaper>()

  for (const tool of createTools(current)) {
    ctx.effect(() => ctx.tools.register(tool), `paper-reader: tool ${tool.name}`)
  }

  const disposeRoute = ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE,
    handler: async (request, response) => {
      if (!isLoopbackHost(request.headers.host)) {
        sendJson(response, 403, { error: 'loopback-only' })
        return
      }
      const url = new URL(request.url ?? '/', 'http://localhost')
      try {
        if (request.method === 'GET' && url.pathname === `${ROUTE}/annotations`) {
          const key = url.searchParams.get('key') ?? ''
          if (key === '') {
            sendJson(response, 400, { error: 'missing-key' })
            return
          }
          const stored = await readJson<{ highlights?: unknown[] }>(annotationPath(key))
          const highlights = (stored?.highlights ?? []).map(sanitizeHighlight).filter((item): item is Highlight => item !== null)
          sendJson(response, 200, { key, highlights })
          return
        }

        if (request.method === 'PUT' && url.pathname === `${ROUTE}/annotations`) {
          if (!sameOrigin(request.headers)) {
            sendJson(response, 403, { error: 'bad-origin' })
            return
          }
          const body = parseJsonBody(await readBody(request, JSON_BODY_LIMIT)) as {
            key?: unknown
            highlights?: unknown
          }
          const key = typeof body.key === 'string' ? body.key.slice(0, 2000) : ''
          if (key === '') {
            sendJson(response, 400, { error: 'missing-key' })
            return
          }
          const highlights = (Array.isArray(body.highlights) ? body.highlights : [])
            .map(sanitizeHighlight)
            .filter((item): item is Highlight => item !== null)
          await writeJson(annotationPath(key), { key, highlights })
          sendJson(response, 200, { ok: true, count: highlights.length })
          return
        }

        if (request.method === 'POST' && url.pathname === `${ROUTE}/paper`) {
          if (!sameOrigin(request.headers)) {
            sendJson(response, 403, { error: 'bad-origin' })
            return
          }
          const key = url.searchParams.get('key') ?? ''
          const sessionId = url.searchParams.get('session') ?? ''
          if (key === '') {
            sendJson(response, 400, { error: 'missing-key' })
            return
          }
          const bytes = await readBody(request, PDF_BODY_LIMIT)
          if (bytes.length === 0) {
            sendJson(response, 400, { error: 'empty-paper' })
            return
          }
          await writeBytes(paperPaths(key).pdf, bytes)
          // Bytes changed: drop the cached extraction so the next tool call re-reads.
          await unlink(paperPaths(key).text).catch(() => undefined)
          const title = url.searchParams.get('title') ?? ''
          if (sessionId !== '') current.set(sessionId, { key, title })
          sendJson(response, 200, { ok: true, bytes: bytes.length })
          return
        }

        if (request.method === 'POST' && url.pathname === `${ROUTE}/current`) {
          if (!sameOrigin(request.headers)) {
            sendJson(response, 403, { error: 'bad-origin' })
            return
          }
          const body = parseJsonBody(await readBody(request, JSON_BODY_LIMIT)) as {
            sessionId?: unknown
            key?: unknown
            title?: unknown
          }
          const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
          const key = typeof body.key === 'string' ? body.key : ''
          if (sessionId === '' || key === '') {
            sendJson(response, 400, { error: 'missing-session-or-key' })
            return
          }
          current.set(sessionId, { key, title: typeof body.title === 'string' ? body.title : '' })
          sendJson(response, 200, { ok: true })
          return
        }

        if (request.method === 'DELETE' && url.pathname === `${ROUTE}/current`) {
          // Clearing the open-paper pointer is harmless state on a loopback-gated
          // route, and browsers do not send Origin on every same-origin DELETE.
          const sessionId = url.searchParams.get('session') ?? ''
          current.delete(sessionId)
          sendJson(response, 200, { ok: true })
          return
        }

        if (request.method === 'GET' && url.pathname === `${ROUTE}/paper/bytes`) {
          const key = url.searchParams.get('key') ?? ''
          if (key === '') {
            sendJson(response, 400, { error: 'missing-key' })
            return
          }
          const bytes = await readBytes(paperPaths(key).pdf)
          if (bytes === null) {
            sendJson(response, 404, { error: 'no-bytes' })
            return
          }
          response.writeHead(200, {
            'content-type': 'application/pdf',
            'content-length': bytes.length,
            'cache-control': 'no-store',
          })
          response.end(bytes)
          return
        }

        if (request.method === 'GET' && url.pathname === `${ROUTE}/arxiv/search`) {
          const query = url.searchParams.get('q') ?? ''
          if (query.trim() === '') {
            sendJson(response, 400, { error: 'missing-query' })
            return
          }
          const max = Number(url.searchParams.get('max') ?? '10')
          try {
            const entries = await searchArxiv(query, Number.isFinite(max) ? max : 10)
            sendJson(response, 200, { entries })
          } catch (error) {
            sendJson(response, 502, { error: error instanceof Error ? error.message : 'search failed' })
          }
          return
        }

        if (request.method === 'POST' && url.pathname === `${ROUTE}/arxiv/open`) {
          if (!sameOrigin(request.headers)) {
            sendJson(response, 403, { error: 'bad-origin' })
            return
          }
          const body = parseJsonBody(await readBody(request, JSON_BODY_LIMIT)) as {
            idOrUrl?: unknown
            sessionId?: unknown
          }
          const idOrUrl = typeof body.idOrUrl === 'string' ? body.idOrUrl : ''
          if (idOrUrl.trim() === '') {
            sendJson(response, 400, { error: 'missing-id' })
            return
          }
          try {
            const paper = await fetchArxivPaper(idOrUrl)
            // Reopening the same id replaces the bytes; the text cache must go with them.
            await unlink(paperPaths(paper.key).text).catch(() => undefined)
            const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
            if (sessionId !== '') current.set(sessionId, { key: paper.key, title: paper.title })
            sendJson(response, 200, paper)
          } catch (error) {
            if (error instanceof ArxivRequestError) {
              sendJson(response, error.status, { error: error.message })
              return
            }
            sendJson(response, 502, { error: error instanceof Error ? error.message : 'fetch failed' })
          }
          return
        }

        sendJson(response, 405, { error: 'method-not-allowed' })
      } catch (error) {
        if (error instanceof BodyTooLargeError) {
          request.resume()
          sendJson(response, 413, { error: 'body-too-large' })
          return
        }
        if (error instanceof BadRequestError) {
          sendJson(response, 400, { error: error.code })
          return
        }
        sendJson(response, 500, { error: error instanceof Error ? error.message : 'failed' })
      }
    },
  })
  ctx.effect(() => disposeRoute, 'paper-reader: routes')
}
