'use strict'

/**
 * Worker-thread entry for the bundled OCR engine (build-time only).
 *
 * It speaks tesseract.js's own job protocol, so the stock `createWorker`
 * factory in `engine.cjs` drives it unchanged; only the core loader differs
 * (LSTM-only WASM) and the language data path is supplied by engine-impl.cjs.
 */
const { parentPort } = require('node:worker_threads')
const worker = require('tesseract.js/src/worker-script')
const getCore = require('./core-loader.cjs')
const gunzip = require('tesseract.js/src/worker-script/node/gunzip')
const cache = require('tesseract.js/src/worker-script/node/cache')

parentPort.on('message', packet => {
  worker.dispatchHandlers(packet, obj => parentPort.postMessage(obj))
})

worker.setAdapter({
  getCore,
  gunzip,
  // Node 20+ has a global fetch, and the bundle targets it; no polyfill is needed.
  fetch: globalThis.fetch,
  ...cache,
})
