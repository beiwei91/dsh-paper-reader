/**
 * Quiet the Node-canvas warnings PDF.js emits while it is imported.
 *
 * `pdfjs-dist`'s legacy Node build probes for the optional `@napi-rs/canvas`
 * package at module-evaluation time and warns (three times) when it is absent:
 * `Cannot load "@napi-rs/canvas" ...` and the `DOMMatrix` / `Path2D` polyfill
 * notes. The Host half only extracts text and never renders, so those warnings
 * are expected noise, not a problem to fix.
 *
 * This module must be imported **before** `pdfjs-dist` (see `text.ts`): module
 * evaluation is synchronous, so the filter is in place for the import graph and
 * the next microtask restores the original `console.warn` — only the exact
 * PDF.js messages are dropped, and nothing else sees a patched console.
 */
const PDFJS_NOISE = ['Cannot load "@napi-rs/canvas"', 'Cannot polyfill `DOMMatrix`', 'Cannot polyfill `Path2D`']

const original = console.warn
const filter = (...args: unknown[]): void => {
  const first = args[0]
  if (typeof first === 'string' && PDFJS_NOISE.some(text => first.includes(text))) return
  original(...args)
}
console.warn = filter
queueMicrotask(() => {
  if (console.warn === filter) console.warn = original
})
