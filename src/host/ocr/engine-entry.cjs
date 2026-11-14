'use strict'

/**
 * Build-time entry for the Host-side OCR engine (`lib/ocr/engine.cjs`).
 *
 * Only tesseract.js's worker factory is needed: the worker itself is bundled
 * separately (`lib/ocr/worker.cjs`), because it runs on a worker thread and
 * loads the WASM core from files that sit beside the bundle.
 */
const createWorker = require('tesseract.js/src/createWorker.js')
const OEM = require('tesseract.js/src/constants/OEM.js')

module.exports = { createWorker, OEM }
