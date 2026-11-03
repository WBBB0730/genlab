/** 模型目录与 schema 的本地缓存：$XDG_CACHE_HOME/genlab（默认 ~/.cache/genlab），一天有效。 */
import { mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

import writeFileAtomic from 'write-file-atomic'

const TTL_MS = 24 * 60 * 60_000

type Entry<T> = { fetchedAt: number; value: T }

export function cacheDir(): string {
  const base = process.env.XDG_CACHE_HOME || path.join(homedir(), '.cache')

  return path.join(base, 'genlab')
}

/** 缓存命中且未过期时直接返回，否则调用 load 并写入缓存；refresh 强制重新获取。 */
export async function cached<T>(
  name: string,
  load: () => Promise<T>,
  refresh = false,
): Promise<T> {
  const file = path.join(cacheDir(), name)

  if (!refresh) {
    try {
      const entry = JSON.parse(await readFile(file, 'utf8')) as Entry<T>

      if (Date.now() - entry.fetchedAt < TTL_MS) {
        return entry.value
      }
    } catch (error) {
      if (
        !(error instanceof SyntaxError) &&
        (error as NodeJS.ErrnoException).code !== 'ENOENT'
      ) {
        throw error
      }
    }
  }

  const value = await load()

  await mkdir(path.dirname(file), { recursive: true })
  await writeFileAtomic(
    file,
    JSON.stringify({ fetchedAt: Date.now(), value } satisfies Entry<T>),
  )

  return value
}
