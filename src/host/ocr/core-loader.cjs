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

let TesseractCore = null

module.exports = async (_lstmOnly, _corePath, res) => {
  if (TesseractCore === null) {
    const statusText = 'loading tesseract core'
    if (res !== undefined) res.progress({ status: statusText, progress: 0 })
    const simdSupport = await simd()
    TesseractCore = simdSupport
      ? require('tesseract.js-core/tesseract-core-simd-lstm')
      : require('tesseract.js-core/tesseract-core-lstm')
    if (res !== undefined) res.progress({ status: statusText, progress: 1 })
  }
  return TesseractCore
}
