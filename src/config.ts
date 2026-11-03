import { homedir } from 'node:os'
import path from 'node:path'

import { CliError } from './errors'

type EnvName = 'KIE_API_KEY' | 'GENLAB_LIBRARY'

/** 配置文件：$XDG_CONFIG_HOME/genlab/.env，默认 ~/.config/genlab/.env。 */
export function configFile(): string {
  const base = process.env.XDG_CONFIG_HOME || path.join(homedir(), '.config')

  return path.join(base, 'genlab', '.env')
}

let envLoaded = false

/** 读取配置文件；已存在的环境变量优先，文件不存在时只用环境变量。 */
function loadEnv() {
  if (envLoaded) {
    return
  }

  envLoaded = true

  try {
    process.loadEnvFile(configFile())
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
}

export function requireEnv(name: EnvName): string {
  loadEnv()

  const value = process.env[name]?.trim()

  if (!value) {
    throw new CliError(`缺少配置 ${name}：在 ${configFile()} 中设置`)
  }

  return value
}

/** 库的根目录：GENLAB_LIBRARY，支持 ~ 开头，必须是绝对路径。 */
export function libraryRoot(): string {
  const raw = requireEnv('GENLAB_LIBRARY')
  const expanded =
    raw === '~' || raw.startsWith('~/')
      ? path.join(homedir(), raw.slice(1))
      : raw

  if (!path.isAbsolute(expanded)) {
    throw new CliError(`GENLAB_LIBRARY 必须是绝对路径：${raw}`)
  }

  return path.normalize(expanded)
}
