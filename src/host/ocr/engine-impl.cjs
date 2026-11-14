'use strict'

/**
 * Runtime OCR engine used by the Host half (and by `scripts/ocr-check.mjs`).
 *
 * This file is copied verbatim to `lib/ocr/engine-impl.cjs`; everything it needs
 * sits beside it after a build, so the installed plugin needs no npm dependency
 * at runtime and never reaches the network:
 *
 *   lib/ocr/worker.cjs                    bundled tesseract worker script
 *   lib/ocr/tesseract-core-simd-lstm.wasm LSTM core (SIMD)
 *   lib/ocr/tesseract-core-lstm.wasm      LSTM core (scalar fallback)
 *   lib/ocr/lang/{eng,chi_sim}.traineddata.gz
 *   lib/ocr/engine.cjs                    bundled tesseract.js worker factory
 *
 * One warm worker is kept per Host process and recognitions are serialised, so
 * OCR never runs inside a canvas paint or two pages at once.
 */

const path = require('node:path')
const { createWorker, OEM } = require('./engine.cjs')

const LANGS = 'eng+chi_sim'
const OCR_TIMEOUT_MS = 120_000
const DISPOSE_AFTER_IDLE_MS = 5 * 60 * 1000

const ASSETS = {
  workerPath: path.join(__dirname, 'worker.cjs'),
  langPath: path.join(__dirname, 'lang'),
}

/**
 * Tesseract's Chinese model puts a space between every glyph (`注 意 力`), which
 * hides multi-character words from both the in-document search and the agent's
 * `paper_search`. Spaces between CJK characters/punctuation are not meaningful,
 * so drop them; Latin words keep their spacing.
 */
const CJK_CLASS = '\\u3000-\\u303f\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff\\uff00-\\uffef'
const CJK_SPACED = new RegExp(`([${CJK_CLASS}])\\s+(?=[${CJK_CLASS}])`, 'g')

function normalizeText(raw) {
  return String(raw ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(CJK_SPACED, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

let workerPromise = null
let idleTimer = null
let lastUsedAt = Date.now()
let queue = Promise.resolve()

function clearIdleTimer() {
  if (idleTimer !== null) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
}

function scheduleIdleDispose() {
  clearIdleTimer()
  idleTimer = setTimeout(() => {
    idleTimer = null
    if (Date.now() - lastUsedAt >= DISPOSE_AFTER_IDLE_MS) void terminate()
  }, DISPOSE_AFTER_IDLE_MS)
  // The host process owns the lifetime; a pending dispose must not keep it alive.
  idleTimer.unref?.()
}

function getWorker() {
  if (workerPromise !== null) return workerPromise
  workerPromise = createWorker(LANGS, OEM.LSTM_ONLY, {
    ...ASSETS,
    // `none` means "never copy the traineddata into a cache directory": the
    // compressed language files are read from lib/ocr/lang on every worker
    // start, so nothing is written to the user's DSH home for this.
    cacheMethod: 'none',
    gzip: true,
  }).then(worker => {
    return worker
  }).catch(error => {
    workerPromise = null
    throw error
  })
  return workerPromise
}

async function terminate() {
  clearIdleTimer()
  const pending = workerPromise
  workerPromise = null
  if (pending === null) return
  try {
    const worker = await pending
    await worker.terminate()
  } catch {
    // The worker never started, so there is nothing to terminate.
  }
}

/**
 * Recognise one page image (PNG or JPEG bytes as produced by the client canvas).
 * Calls are serialised: a second page waits for the first to finish, so a slow
 * page can never stack up recognitions.
 */
function recognize(image) {
  const run = queue.then(() => runOne(image), () => runOne(image))
  queue = run.then(() => undefined, () => undefined)
  return run
}

async function runOne(image) {
  const startedAt = Date.now()
  const worker = await getWorker()
  lastUsedAt = Date.now()
  scheduleIdleDispose()
  let timeout = null
  try {
    const { data } = await Promise.race([
      worker.recognize(image),
      new Promise((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`OCR timed out after ${OCR_TIMEOUT_MS} ms`)), OCR_TIMEOUT_MS)
        timeout.unref?.()
      }),
    ])
    lastUsedAt = Date.now()
    return { text: normalizeText(data?.text), ms: Date.now() - startedAt }
  } catch (error) {
    // A core crash or a timeout leaves the worker in an unknown state: drop it so
    // the next request starts from a clean worker instead of failing forever.
    await terminate()
    throw error
  } finally {
    if (timeout !== null) clearTimeout(timeout)
  }
}

async function dispose() {
  clearIdleTimer()
  queue = Promise.resolve()
  await terminate()
}

module.exports = { recognize, dispose, normalizeText }
