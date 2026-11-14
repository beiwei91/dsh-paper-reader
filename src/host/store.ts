/**
 * Host-side storage for the paper reader.
 *
 * Everything durable lives under the DSH home, never in the user's workspace:
 *   $DSH_HOME/paper-reader/papers/<sha1>.pdf         the bytes the agent tools read
 *   $DSH_HOME/paper-reader/papers/<sha1>.text.json   extracted text, one entry per page
 *   $DSH_HOME/paper-reader/annotations/<sha1>.json   highlights and notes
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export function dataDir(): string {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'paper-reader')
}

export function papersDir(): string {
  return join(dataDir(), 'papers')
}

export function annotationsDir(): string {
  return join(dataDir(), 'annotations')
}

/** A stable file stem for one paper key (path, arXiv id, or dropped-file identity). */
export function hashKey(key: string): string {
  return createHash('sha1').update(key).digest('hex')
}

export function paperPaths(key: string): { pdf: string; text: string } {
  const stem = hashKey(key)
  return { pdf: join(papersDir(), `${stem}.pdf`), text: join(papersDir(), `${stem}.text.json`) }
}

export function annotationPath(key: string): string {
  return join(annotationsDir(), `${hashKey(key)}.json`)
}

export async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    return null
  }
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFileAtomic(path, JSON.stringify(value))
}

export async function writeBytes(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFileAtomic(path, bytes)
}

/**
 * Two sidebar tabs can write the same paper at once, so each write owns a unique
 * temporary file; on Windows a replace can transiently fail while another handle
 * reads the target, which is retried.
 */
async function writeFileAtomic(path: string, content: string | Uint8Array): Promise<void> {
  const temp = `${path}.${process.pid}.${Math.random().toString(36).slice(2, 10)}.tmp`
  await writeFile(temp, content)
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rename(temp, path)
      return
    } catch (error) {
      if (attempt === 4) {
        await rm(temp, { force: true }).catch(() => undefined)
        throw error
      }
      await new Promise(resolve => setTimeout(resolve, 40 * (attempt + 1)))
    }
  }
}

export async function readBytes(path: string): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await readFile(path))
  } catch {
    return null
  }
}
