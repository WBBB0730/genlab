/** 库内命名与路径约定（纯函数）。 */
import { CliError } from '../errors'

/** 素材文件夹里的记录文件：含它的文件夹才是素材。 */
export const ASSET_FILE = 'asset.json'

/** 素材文件夹里存放参考输入副本的子目录，按生成编号分开。 */
export const REFERENCES_DIR = 'references'

const MAX_NAME_BYTES = 255

/** 项目、文件夹、素材名：非空，不以 . 开头，不含路径分隔符与控制字符。 */
export function validateName(name: string, what: string): string {
  const trimmed = name.trim()

  if (
    !trimmed ||
    trimmed !== name ||
    trimmed.startsWith('.') ||
    /[/\\:\p{Cc}]/u.test(trimmed) ||
    Buffer.byteLength(trimmed) > MAX_NAME_BYTES
  ) {
    throw new CliError(`${what}不合法：${JSON.stringify(name)}`)
  }

  return trimmed
}

/** 「文件夹/…/素材名」→ 各级名字。 */
export function parseAssetPath(input: string): string[] {
  const segments = input.split('/')

  if (segments.some((segment) => segment === '')) {
    throw new CliError(`素材路径不合法：${JSON.stringify(input)}`)
  }

  return segments.map((segment) => validateName(segment, '素材路径'))
}

/** `3` 或 `v3` → 3。 */
export function parseVersionArg(input: string): number {
  const match = /^v?(\d+)$/i.exec(input.trim())
  const value = match ? Number(match[1]) : NaN

  if (!Number.isSafeInteger(value) || value < 1) {
    throw new CliError(`版本号不合法：${input}`)
  }

  return value
}

/** 版本产物文件名：v<版本号>.<扩展名>。 */
export function versionFileName(version: number, extension: string): string {
  return `v${version}.${extension}`
}

/** 版本产物文件名 → 版本号；不是版本产物返回 null。 */
export function versionFromFileName(fileName: string): number | null {
  const match = /^v(\d+)\.[^.]+$/.exec(fileName)

  return match ? Number(match[1]) : null
}
