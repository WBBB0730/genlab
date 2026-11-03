/** 扫描库目录找素材：含记录文件的文件夹即素材，不建总索引（见 ADR-0002）。 */
import { access, readdir } from 'node:fs/promises'
import path from 'node:path'

import { ASSET_FILE } from './paths'

export async function isAssetDir(dir: string): Promise<boolean> {
  try {
    await access(path.join(dir, ASSET_FILE))

    return true
  } catch {
    return false
  }
}

/** dir 之下（含 dir）的全部素材文件夹；素材里不再往下找，隐藏目录跳过。 */
export async function findAssetDirs(dir: string): Promise<string[]> {
  if (await isAssetDir(dir)) {
    return [dir]
  }

  let entries

  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }

    throw error
  }

  const nested = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => findAssetDirs(path.join(dir, entry.name))),
  )

  return nested.flat()
}

/** 文件所在的素材文件夹（在 root 之内逐级向上找）；不在任何素材里返回 null。 */
export async function findOwningAsset(
  root: string,
  filePath: string,
): Promise<string | null> {
  const relative = path.relative(root, filePath)

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null
  }

  for (
    let dir = path.dirname(filePath);
    dir.startsWith(root) && dir !== root;
    dir = path.dirname(dir)
  ) {
    if (await isAssetDir(dir)) {
      return dir
    }
  }

  return null
}
