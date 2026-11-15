// Headless logic test for the client annotation save queue (no browser, no React).
//
// Build the module under test first:
//   node node_modules/esbuild/bin/esbuild src/client/annotationQueue.ts \
//     --bundle --format=cjs --platform=node --outfile=.build/annotation-queue.cjs
// Then:
//   node scripts/annotation-save-test.cjs
//
// It proves the write path the "highlights vanish after 换一篇" bug depended on:
//   - one PUT in flight per paper, newer states coalesced, and the newest state
//     always sent;
//   - a paper switch never lets the new paper's snapshot replace the old paper's
//     last edit (each storage key has its own in-flight slot);
//   - a failure keeps the newest state, reports the status and retries (bounded);
//   - a teardown flush(true) sends each paper's newest state immediately with
//     keepalive;
//   - a stale settle never restores an older snapshot over a newer one.
const { createAnnotationSaveQueue } = require('../.build/annotation-queue.cjs')

let failures = 0
function check(name, actual, expected) {
  const same = JSON.stringify(actual) === JSON.stringify(expected)
  if (!same) failures += 1
  console.log(`${same ? 'PASS' : 'FAIL'}  ${name}${same ? '' : `\n        got ${JSON.stringify(actual)} expected ${JSON.stringify(expected)}`}`)
}

const tick = () => new Promise(resolve => setImmediate(resolve))
const list = (...ids) => ids.map(id => ({ id, page: 1, color: 'yellow', quote: id, note: '', createdAt: 1 }))
const idsOf = write => write.highlights.map(highlight => highlight.id)

function harness() {
  const puts = []
  const problems = []
  const timers = new Map()
  let nextTimer = 1
  const deps = {
    put(write, keepalive) {
      return new Promise(resolve => { puts.push({ write, keepalive, resolve }) })
    },
    report(problem) { problems.push(problem) },
    setTimer(handler, ms) {
      const id = nextTimer
      nextTimer += 1
      timers.set(id, { handler, ms })
      return id
    },
    clearTimer(id) { timers.delete(id) },
  }
  return {
    deps,
    puts,
    problems,
    timers,
    fireTimers() {
      const pending = [...timers.entries()]
      timers.clear()
      for (const [, timer] of pending) timer.handler()
    },
  }
}

async function main() {
  // 1. Rapid edits coalesce: only one PUT in flight, the newest state goes next.
  {
    const h = harness()
    const queue = createAnnotationSaveQueue(h.deps)
    queue.enqueue('k', list('a'))
    queue.enqueue('k', list('a', 'b'))
    queue.enqueue('k', list('a', 'b', 'c'))
    check('coalesce: exactly one PUT while in flight', h.puts.length, 1)
    check('coalesce: first PUT is the first state', idsOf(h.puts[0].write), ['a'])
    h.puts[0].resolve({ ok: true, status: 200, code: null })
    await tick()
    check('coalesce: the newest state is sent after it settles', idsOf(h.puts[1].write), ['a', 'b', 'c'])
    h.puts[1].resolve({ ok: true, status: 200, code: null })
    await tick()
    check('coalesce: only two PUTs total, no duplicate of b', h.puts.length, 2)
    check('coalesce: success clears the problem', h.problems.at(-1), null)
  }

  // 2. A failure keeps the newest state and retries with backoff.
  {
    const h = harness()
    const queue = createAnnotationSaveQueue(h.deps)
    queue.enqueue('k', list('a'))
    h.puts[0].resolve({ ok: false, status: 403, code: 'bad-origin' })
    await tick()
    check('failure: reported with status, code and retrying', h.problems.at(-1), { kind: 'save', status: 403, code: 'bad-origin', retrying: true })
    check('failure: one retry timer scheduled', h.timers.size, 1)
    h.fireTimers()
    await tick()
    check('failure: retry sends the same (newest) state', [h.puts.length, idsOf(h.puts.at(-1).write)], [2, ['a']])
    h.puts[1].resolve({ ok: true, status: 200, code: null })
    await tick()
    check('failure: retry success clears the problem', h.problems.at(-1), null)
  }

  // 3. Edits that arrive after a failure are what the retry sends.
  {
    const h = harness()
    const queue = createAnnotationSaveQueue(h.deps)
    queue.enqueue('k', list('a'))
    h.puts[0].resolve({ ok: false, status: 500, code: null })
    await tick()
    queue.enqueue('k', list('a', 'b'))
    await tick()
    check('retry+edit: the new edit is sent immediately', [h.puts.length, idsOf(h.puts.at(-1).write)], [2, ['a', 'b']])
    h.puts[1].resolve({ ok: true, status: 200, code: null })
    await tick()
    check('retry+edit: only two PUTs', h.puts.length, 2)
  }

  // 4. flush(true) during an in-flight PUT sends the newest state with keepalive,
  //    and the stale settle cannot resurrect the older snapshot.
  {
    const h = harness()
    const queue = createAnnotationSaveQueue(h.deps)
    queue.enqueue('k', list('a'))
    queue.enqueue('k', list('a', 'b'))
    queue.flush(true)
    check('teardown: newest state sent immediately with keepalive', [h.puts.length, h.puts[1].keepalive, idsOf(h.puts[1].write)], [2, true, ['a', 'b']])
    h.puts[0].resolve({ ok: false, status: 403, code: 'bad-origin' })
    await tick()
    check('teardown: stale failure is reported once, without a retry timer', [h.problems.at(-1)?.retrying, h.timers.size], [false, 0])
    h.puts[1].resolve({ ok: true, status: 200, code: null })
    await tick()
    check('teardown: no older snapshot is sent afterwards', [h.puts.length, h.problems.at(-1)], [2, null])
  }

  // 5. flush(false) keeps the single-flight rule: the newest state waits for the
  //    request in flight, then goes out.
  {
    const h = harness()
    const queue = createAnnotationSaveQueue(h.deps)
    queue.enqueue('k', list('a'))
    queue.enqueue('k', list('a', 'b'))
    queue.flush()
    check('flush: no concurrent PUT', h.puts.length, 1)
    h.puts[0].resolve({ ok: true, status: 200, code: null })
    await tick()
    check('flush: newest state follows the settle', idsOf(h.puts[1].write), ['a', 'b'])
  }

  // 6. Retries are bounded, and the last failure stops the loop visibly.
  {
    const h = harness()
    const queue = createAnnotationSaveQueue(h.deps)
    queue.enqueue('k', list('a'))
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const put = h.puts.at(-1)
      if (put === undefined) break
      put.resolve({ ok: false, status: 503, code: null })
      await tick()
      h.fireTimers()
      await tick()
    }
    check('bounded: at most 6 PUTs for one state', h.puts.length, 6)
    check('bounded: last problem stops retrying', h.problems.at(-1), { kind: 'save', status: 503, code: null, retrying: false })
    check('bounded: no retry timer left', h.timers.size, 0)
  }

  // 7. The queue is per paper key: switching papers while one PUT is in flight
  //    must not replace the old paper's last snapshot with the new paper's state.
  {
    const h = harness()
    const queue = createAnnotationSaveQueue(h.deps)
    queue.enqueue('a', list('a1'))
    queue.enqueue('a', list('a1', 'a2'))
    check('per-key: paper a has exactly one PUT in flight', [h.puts.length, h.puts[0].write.key, idsOf(h.puts[0].write)], [1, 'a', ['a1']])
    // Switch to paper b while a's PUT is still in flight, then edit a again.
    queue.enqueue('b', list('b1'))
    check('per-key: paper b dispatches despite a in flight', [h.puts.length, h.puts[1].write.key, idsOf(h.puts[1].write)], [2, 'b', ['b1']])
    queue.flush()
    check('per-key: flushing keeps both papers queued independently', h.puts.length, 2)
    h.puts[0].resolve({ ok: true, status: 200, code: null })
    await tick()
    check("per-key: a's newest snapshot goes out after its own settle", [h.puts.length, h.puts[2].write.key, idsOf(h.puts[2].write)], [3, 'a', ['a1', 'a2']])
    h.puts[1].resolve({ ok: true, status: 200, code: null })
    await tick()
    check("per-key: b's settle did not wait for a", [h.puts.length, h.problems.at(-1)], [3, null])
    h.puts[2].resolve({ ok: true, status: 200, code: null })
    await tick()
    check('per-key: no duplicate or reordered sends', h.puts.length, 3)
  }

  // 8. Teardown flush(true) sends every paper's newest state, even mid-flight.
  {
    const h = harness()
    const queue = createAnnotationSaveQueue(h.deps)
    queue.enqueue('a', list('a1'))
    queue.enqueue('b', list('b1'))
    queue.enqueue('a', list('a1', 'a2'))
    queue.enqueue('b', list('b1', 'b2'))
    queue.flush(true)
    const keepaliveSends = h.puts.filter(put => put.keepalive).map(put => [put.write.key, idsOf(put.write)])
    check('teardown per-key: both papers flushed with keepalive', keepaliveSends, [['a', ['a1', 'a2']], ['b', ['b1', 'b2']]])
  }

  console.log(failures === 0 ? '\nall save-queue checks passed' : `\n${failures} check(s) FAILED`)
  process.exitCode = failures === 0 ? 0 : 1
}

void main()
