#!/usr/bin/env node
/**
 * Browser-free end-to-end check of the scanned-PDF OCR pipeline.
 *
 * What it proves, in order:
 *  1. every OCR asset a fresh profile needs is committed under lib/ocr/ and the
 *     runtime bundles carry no external npm dependency;
 *  2. the bundled engine recognises a synthetic scanned page offline with
 *     `eng+chi_sim` (tesseract worker thread, local traineddata, no network);
 *  3. the Host routes work end to end: the image-only PDF is stored, the PNG is
 *     POSTed to /paper-reader/api/ocr, the recognised text is merged into
 *     papers/<sha1>.text.json, and the cached page is never re-OCR'd;
 *  4. the agent tools see it: `paper_info` reports the OCR page count,
 *     `paper_read` marks the page as OCR, and `paper_search` finds the text.
 *
 * Usage, from the repository root:
 *
 *   python scripts/ocr-fixture.py .build/ocr-fixture
 *   node scripts/ocr-check.mjs .build/ocr-fixture/scan.png .build/ocr-fixture/scan.pdf
 *
 * Node 20+ only (global fetch, worker_threads).
 */
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { builtinModules, createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const BUILTINS = new Set(builtinModules)
const root = fileURLToPath(new URL('..', import.meta.url))
const imagePath = resolve(process.argv[2] ?? join(root, '.build/ocr-fixture/scan.png'))
const pdfPath = resolve(process.argv[3] ?? join(root, '.build/ocr-fixture/scan.pdf'))

let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === '' ? '' : ` — ${detail}`}`)
  if (!ok) failures += 1
}

async function fileSize(path) {
  try {
    return (await stat(path)).size
  } catch {
    return -1
  }
}

function kib(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`
}

// 1. Committed runtime assets -------------------------------------------------
const OCR_DIR = join(root, 'lib', 'ocr')
const ASSETS = [
  'worker.cjs',
  'engine.cjs',
  'engine-impl.cjs',
  'tesseract-core-simd-lstm.wasm',
  'tesseract-core-lstm.wasm',
  join('lang', 'eng.traineddata.gz'),
  join('lang', 'chi_sim.traineddata.gz'),
]
let totalBytes = 0
for (const name of ASSETS) {
  const size = await fileSize(join(OCR_DIR, name))
  check(`asset lib/ocr/${name}`, size > 0, kib(Math.max(0, size)))
  totalBytes += Math.max(0, size)
}
console.log(`      OCR runtime assets total ${(totalBytes / 1024 / 1024).toFixed(2)} MiB`)
// node-fetch (bundled for API compatibility, never used for OCR) optionally
// requires `encoding` inside a try/catch for non-UTF-8 responses; it is absent
// on purpose and its failure is handled by that package.
const OPTIONAL_REQUIRES = new Set(['encoding'])
for (const bundle of ['worker.cjs', 'engine.cjs']) {
  const source = await readFile(join(OCR_DIR, bundle), 'utf8')
  const external = (source.match(/require\("(?!\.|node:)[^"]+"\)/g) ?? [])
    .map(specifier => specifier.slice('require("'.length, -2))
    .filter(specifier => !BUILTINS.has(specifier) && !OPTIONAL_REQUIRES.has(specifier))
  check(`${bundle} has no external npm require`, external.length === 0, external.slice(0, 3).join(', '))
}

for (const fixture of [imagePath, pdfPath]) {
  check(`fixture ${fixture}`, (await fileSize(fixture)) > 0)
}
if (failures > 0) {
  console.error('\nGenerate the fixtures first: python scripts/ocr-fixture.py .build/ocr-fixture')
  process.exit(1)
}

// 2. Engine: recognise a synthetic scanned page, offline ----------------------
const engine = require(join(OCR_DIR, 'engine-impl.cjs'))
const png = new Uint8Array(await readFile(imagePath))
const coldStart = Date.now()
const first = await engine.recognize(png)
const coldMs = Date.now() - coldStart
const warmStart = Date.now()
const second = await engine.recognize(png)
const warmMs = Date.now() - warmStart
const text = first.text
console.log(`      OCR: cold ${coldMs} ms (worker start + recognition), warm ${warmMs} ms for page 2`)
check('OCR finds the English title', text.includes('Attention Is All You Need'), text.split('\n')[0])
check('OCR finds the English body', text.includes('Transformer'))
check('OCR finds contiguous Chinese', text.includes('本文提出一种全新的简单网络结构'), 'CJK glyph spacing normalised')
check('OCR finds a Chinese phrase', text.includes('注意力'))

// 3. Host routes: PNG -> OCR -> text cache ------------------------------------
const dshHome = await mkdtemp(join(tmpdir(), 'paper-reader-ocr-'))
process.env.DSH_HOME = dshHome
const host = await import(new URL('../lib/host.js', import.meta.url))

const tools = new Map()
const cleanups = []
let route = null
host.apply({
  effect(run) {
    const dispose = run()
    if (typeof dispose === 'function') cleanups.push(dispose)
  },
  tools: {
    register(definition) {
      tools.set(definition.name, definition)
      return () => undefined
    },
  },
  webServer: {
    register(registered) {
      route = registered
      return () => undefined
    },
  },
})
check('host registered the /paper-reader/api prefix route', route !== null && route.kind === 'prefix')
check('host registered the four agent tools', ['paper_info', 'paper_outline', 'paper_read', 'paper_search'].every(name => tools.has(name)))

const HOST_HEADERS = { host: '127.0.0.1:7249', origin: 'http://127.0.0.1:7249' }

function request({ method, path, body, headers = {} }) {
  const allHeaders = { ...HOST_HEADERS, ...headers }
  const listeners = new Map()
  let emitScheduled = false
  // Emit the body only once the route has attached its stream listeners: the
  // OCR route awaits a cache read before reading the body, so emitting on the
  // next tick unconditionally would race ahead of it.
  const scheduleEmit = () => {
    if (emitScheduled) return
    emitScheduled = true
    setTimeout(() => {
      if (body !== undefined) {
        for (const listener of listeners.get('data') ?? []) listener(body)
      }
      for (const listener of listeners.get('end') ?? []) listener()
      for (const listener of listeners.get('close') ?? []) listener()
    }, 0)
  }
  const incoming = {
    method,
    url: path,
    headers: allHeaders,
    on(event, listener) {
      const list = listeners.get(event) ?? []
      list.push(listener)
      listeners.set(event, list)
      if (event === 'data' || event === 'end') scheduleEmit()
      return incoming
    },
    resume() {},
    destroy() {},
  }
  let finish
  const ended = new Promise(resolve => { finish = resolve })
  const outgoing = {
    status: 0,
    headers: {},
    body: null,
    writeHead(status, responseHeaders) {
      this.status = status
      this.headers = responseHeaders
    },
    end(body) {
      this.body = body
      finish()
    },
  }
  return Promise.resolve(route.handler(incoming, outgoing)).then(async () => {
    await ended
    const raw = outgoing.body
    const bytes = raw === undefined || raw === null
      ? new Uint8Array(0)
      : typeof raw === 'string'
        ? new Uint8Array(Buffer.from(raw, 'utf8'))
        : new Uint8Array(raw)
    let json = null
    try {
      json = JSON.parse(Buffer.from(bytes).toString('utf8'))
    } catch {
      json = null
    }
    return { status: outgoing.status, json, bytes }
  })
}

const key = 'ocr-check:attention'
const stem = createHash('sha1').update(key).digest('hex')
const textCachePath = join(dshHome, 'paper-reader', 'papers', `${stem}.text.json`)
const pdf = new Uint8Array(await readFile(pdfPath))

const uploaded = await request({
  method: 'POST',
  path: `/paper-reader/api/paper?key=${encodeURIComponent(key)}&session=ocr-check&title=OCR%20check`,
  body: pdf,
  headers: { 'content-type': 'application/pdf' },
})
check('POST /paper stores the image-only PDF', uploaded.status === 200 && uploaded.json?.bytes === pdf.length)

const before = await request({ method: 'GET', path: `/paper-reader/api/ocr?key=${encodeURIComponent(key)}` })
check('GET /ocr starts empty', before.status === 200 && Array.isArray(before.json?.done) && before.json.done.length === 0)

const ocrStarted = Date.now()
const ocr = await request({
  method: 'POST',
  path: `/paper-reader/api/ocr?key=${encodeURIComponent(key)}&page=1`,
  body: png,
  headers: { 'content-type': 'image/png' },
})
const ocrMs = Date.now() - ocrStarted
check('POST /ocr recognises page 1', ocr.status === 200 && typeof ocr.json?.text === 'string' && ocr.json.text.includes('Attention'), `${ocrMs} ms`)
check('POST /ocr reports the OCR page list', Array.isArray(ocr.json?.ocrPages) && ocr.json.ocrPages.includes(1))

const cachedStarted = Date.now()
const cached = await request({
  method: 'POST',
  path: `/paper-reader/api/ocr?key=${encodeURIComponent(key)}&page=1`,
  body: png,
  headers: { 'content-type': 'image/png' },
})
const cachedMs = Date.now() - cachedStarted
check('second POST /ocr is served from the cache', cached.status === 200 && cached.json?.cached === true && cachedMs < 500, `${cachedMs} ms`)
check('cached text equals the recognised text', cached.json?.text === ocr.json?.text)

const after = await request({ method: 'GET', path: `/paper-reader/api/ocr?key=${encodeURIComponent(key)}` })
check('GET /ocr now lists the page', after.status === 200 && after.json?.done?.includes(1) && after.json?.pages?.[0]?.text?.includes('Attention'))

const stored = JSON.parse(await readFile(textCachePath, 'utf8'))
check('text cache stores the OCR text', typeof stored.pages?.[0] === 'string' && stored.pages[0].includes('Attention'))
check('text cache marks the OCR page', Array.isArray(stored.ocrPages) && stored.ocrPages.includes(1))
check('text cache keeps one page per PDF page', stored.pages.length === stored.numPages)

// 4. Agent tools read the same cache ------------------------------------------
await request({
  method: 'POST',
  path: '/paper-reader/api/current',
  body: new Uint8Array(Buffer.from(JSON.stringify({ sessionId: 'ocr-check', key, title: 'OCR check' }))),
  headers: { 'content-type': 'application/json' },
})
const exec = { agent: { session: { id: 'ocr-check' } } }
const info = await tools.get('paper_info').execute({}, exec)
check('paper_info reports OCR progress', info.includes('OCR 文本: 1/1 页'), info.split('\n').find(line => line.startsWith('OCR')) ?? '')
const read = await tools.get('paper_read').execute({ pages: '1' }, exec)
check('paper_read marks the page as OCR', read.includes('[第 1 页 · OCR]'))
check('paper_read returns recognised text', read.includes('Attention'))
const search = await tools.get('paper_search').execute({ query: 'Transformer' }, exec)
check('paper_search finds OCR text', search.includes('p.1') && search.includes('匹配'))
const outline = await tools.get('paper_outline').execute({}, exec)
check('paper_outline still works', typeof outline === 'string')

// 5. Cleanup ------------------------------------------------------------------
for (const dispose of cleanups.reverse()) {
  try {
    await dispose()
  } catch {
    // A stub effect may only have a best-effort disposer.
  }
}
await engine.dispose()
await rm(dshHome, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined)

console.log(failures === 0 ? '\nOCR CHECK PASSED' : `\nOCR CHECK FAILED (${failures} failing check(s))`)
process.exitCode = failures === 0 ? 0 : 1
