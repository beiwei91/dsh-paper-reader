/**
 * Typed facade over the bundled OCR engine.
 *
 * The engine is a CommonJS artifact (`lib/ocr/engine-impl.cjs`) because it uses
 * `__dirname` to find its assets and spawns a worker thread; the Host bundle is
 * ESM, so it is required through `createRequire` instead of bundled in.
 */
import { createRequire } from 'node:module'

export interface OcrResult {
  /** Recognised text, with CJK glyph spacing normalised. */
  readonly text: string
  /** Wall-clock time of this page's recognition, excluding worker warm-up. */
  readonly ms: number
}

interface OcrEngineModule {
  recognize(image: Uint8Array): Promise<OcrResult>
  dispose(): Promise<void>
}

// `./ocr/engine-impl.cjs` is a build artifact beside lib/host.js.
const hostRequire = createRequire(import.meta.url)
const engine = hostRequire('./ocr/engine-impl.cjs') as OcrEngineModule

/** Recognise one rendered page image (PNG bytes). Calls are serialised by the engine. */
export function recognizePage(image: Uint8Array): Promise<OcrResult> {
  return engine.recognize(image)
}

/** Stop the warm worker; called when the plugin unloads. */
export function disposeOcr(): Promise<void> {
  return engine.dispose()
}
