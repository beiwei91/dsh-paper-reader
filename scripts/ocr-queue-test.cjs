// Headless logic test for the client OCR scheduler (no browser, no canvas).
// Run: node .build/queue-run.cjs
const { createOcrScheduler } = require('../.build/queue-test.cjs')

globalThis.window = {
  requestIdleCallback: callback => setTimeout(callback, 0),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: id => clearTimeout(id),
}

const posts = []
globalThis.fetch = async url => {
  posts.push(Number(new URL(url, 'http://localhost').searchParams.get('page')))
  return {
    status: 200,
    ok: true,
    json: async () => ({ text: `OCR page ${new URL(url, 'http://localhost').searchParams.get('page')}` }),
  }
}

let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === '' ? '' : ` — ${detail}`}`)
  if (!ok) failures += 1
}

async function waitFor(predicate, timeoutMs = 5000) {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) return false
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  return true
}

function makeScheduler(options) {
  const scheduler = createOcrScheduler(options)
  return scheduler
}

async function main() {
  // Scenario A: current page first, text pages skipped, only scans posted.
  {
    posts.length = 0
    const text = new Map()
    const state = { last: null }
    const scheduler = makeScheduler({
      numPages: 6,
      storageKey: 'test:a',
      alreadyOcred: new Set(),
      getCachedText: page => text.get(page) ?? null,
      probeText: async page => ([3, 4].includes(page) ? 0 : 200),
      renderPage: async () => ({ fake: 'png' }),
      onText: (page, value) => text.set(page, value),
      onProgress: progress => { if (progress !== null) state.last = progress },
      onError: error => console.warn('error', error),
    })
    scheduler.setCurrentPage(3)
    scheduler.start()
    const okA = await waitFor(() => state.last?.done === 2)
    check('A: only scanned pages are posted', okA && posts.join(',') === '3,4', posts.join(','))
    check('A: progress reaches 2/2', state.last?.done === 2 && state.last?.total === 2, JSON.stringify(state.last))
    check('A: OCR text merged for both pages', text.get(3)?.includes('page 3') && text.get(4)?.includes('page 4'))
    scheduler.stop()
  }

  // Scenario B: bounded queue — 50 scanned pages, one fill = 30 pages max.
  {
    posts.length = 0
    const state = { last: null }
    const scheduler = makeScheduler({
      numPages: 50,
      storageKey: 'test:b',
      alreadyOcred: new Set(),
      getCachedText: () => null,
      probeText: async () => 0,
      renderPage: async () => ({ fake: 'png' }),
      onText: () => undefined,
      onProgress: progress => { if (progress !== null) state.last = progress },
    })
    scheduler.setCurrentPage(1)
    scheduler.start()
    const okB = await waitFor(() => state.last?.done === 30, 15000)
    check('B: one fill is bounded to OCR_QUEUE_LIMIT pages', okB && posts.length === 30, `posted ${posts.length}`)
    check('B: queue starts at the current page', posts[0] === 1 && posts[1] === 2, posts.slice(0, 3).join(','))
    await new Promise(resolve => setTimeout(resolve, 250))
    check('B: draining the queue does not scan the whole paper', posts.length === 30, `posted ${posts.length} after drain`)
    scheduler.stop()
  }

  // Scenario C: stop() cancels promptly, nothing after it.
  {
    posts.length = 0
    const scheduler = makeScheduler({
      numPages: 10,
      storageKey: 'test:c',
      alreadyOcred: new Set(),
      getCachedText: () => null,
      probeText: async () => 0,
      renderPage: async () => ({ fake: 'png' }),
      onText: () => undefined,
      onProgress: () => undefined,
    })
    scheduler.start()
    await new Promise(resolve => setTimeout(resolve, 120))
    scheduler.stop()
    const before = posts.length
    await new Promise(resolve => setTimeout(resolve, 300))
    check('C: stop() prevents further OCR requests', posts.length === before, `${before} -> ${posts.length}`)
  }

  // Scenario D: pages the Host already OCR'd are never re-posted.
  {
    posts.length = 0
    const text = new Map([[1, 'cached OCR page 1']])
    const state = { last: null }
    const scheduler = makeScheduler({
      numPages: 3,
      storageKey: 'test:d',
      alreadyOcred: new Set([1]),
      getCachedText: page => text.get(page) ?? null,
      probeText: async () => 0,
      renderPage: async () => ({ fake: 'png' }),
      onText: () => undefined,
      onProgress: progress => { if (progress !== null) state.last = progress },
    })
    scheduler.start()
    const okD = await waitFor(() => state.last?.done === 2)
    check('D: cached pages are skipped, others recognised', okD && posts.join(',') === '2,3', posts.join(','))
    scheduler.stop()
  }

  console.log(failures === 0 ? '\nQUEUE TEST PASSED' : `\nQUEUE TEST FAILED (${failures})`)
  process.exit(failures === 0 ? 0 : 1)
}

void main()
