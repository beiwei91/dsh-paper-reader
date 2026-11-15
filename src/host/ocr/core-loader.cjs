'use strict'

/**
 * Core loader for the bundled OCR worker (build-time only).
 *
 * tesseract.js's Node loader ignores the LSTM-only flag and therefore needs the
 * full (legacy + LSTM) core. This plugin only ever uses LSTM_ONLY, so choosing
 * the LSTM build here halves the shipped WASM and shortens worker start-up.
 * The SIMD build is preferred; the scalar build stays as a fallback for CPUs
 * without WebAssembly SIMD support.
 */
const { simd } = require('wasm-feature-detect')

/**
 * The LSTM-only core rejects a handful of legacy parameter names at Init and
 * prints `Warning: Parameter not found: <name>` for each one on stderr. They are
 * harmless (the core simply has no such parameter) but would otherwise appear in
 * the Host log on every cold worker warm-up, so drop exactly that prefix and
 * forward everything else to the same sink.
 */
const PARAMETER_NOISE = 'Warning: Parameter not found: '

let TesseractCore = null

function quiet(core) {
  return (options = {}) => core({
    ...options,
    printErr(message) {
      if (String(message).trimStart().startsWith(PARAMETER_NOISE)) return
      if (typeof options.printErr === 'function') options.printErr(message)
      else console.warn(message)
    },
  })
}

module.exports = async (_lstmOnly, _corePath, res) => {
  if (TesseractCore === null) {
    const statusText = 'loading tesseract core'
    if (res !== undefined) res.progress({ status: statusText, progress: 0 })
    const simdSupport = await simd()
    const core = simdSupport
      ? require('tesseract.js-core/tesseract-core-simd-lstm')
      : require('tesseract.js-core/tesseract-core-lstm')
    TesseractCore = quiet(core)
    if (res !== undefined) res.progress({ status: statusText, progress: 1 })
  }
  return TesseractCore
}
