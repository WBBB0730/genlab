/** genhub init：写入配置文件（API Key 与库目录），先验证 Key 可用。 */
import { mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { parseEnv } from 'node:util'

import * as p from '@clack/prompts'
import writeFileAtomic from 'write-file-atomic'

import { configFile } from '../config'
import { CliError } from '../errors'
import { getKieCredits } from '../kie/client'

const DEFAULT_LIBRARY = '~/GenHub'

async function readConfig(file: string): Promise<Record<string, string>> {
  try {
    return parseEnv(await readFile(file, 'utf8')) as Record<string, string>
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {}
    }

    throw error
  }
}

/** 交互输入被取消时退出。 */
function answered(value: string | symbol): string {
  if (p.isCancel(value)) {
    p.cancel('已取消')
    process.exit(1)
  }

  return value as string
}

function expandHome(dir: string): string {
  return dir === '~' || dir.startsWith('~/')
    ? path.join(homedir(), dir.slice(1))
    : dir
}

/**
 * 未通过选项给出的值：终端里交互询问（直接回车沿用已有配置），非终端时沿用已有配置，
 * 都没有就报错。
 */
export async function initCommand(args: { key?: string; library?: string }) {
  const file = configFile()
  const existing = await readConfig(file)
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY)
  let key = args.key ?? existing.KIE_API_KEY
  let library = args.library ?? existing.GENHUB_LIBRARY

  if (interactive && !args.key) {
    const input = answered(
      await p.password({
        message: existing.KIE_API_KEY
          ? 'kie.ai API Key（回车沿用已有）'
          : 'kie.ai API Key（https://kie.ai/api-key）',
        validate: (value) =>
          value || existing.KIE_API_KEY ? undefined : '不能为空',
      }),
    )

    key = input || existing.KIE_API_KEY
  }

  if (interactive && !args.library) {
    library = answered(
      await p.text({
        message: '库目录',
        initialValue: existing.GENHUB_LIBRARY ?? DEFAULT_LIBRARY,
        validate: (value) => (value ? undefined : '不能为空'),
      }),
    )
  }

  if (!key) {
    throw new CliError('缺少 --key')
  }

  library ||= DEFAULT_LIBRARY

  if (!path.isAbsolute(expandHome(library))) {
    throw new CliError(`库目录必须是绝对路径：${library}`)
  }

  const credits = await getKieCredits(key)

  await mkdir(expandHome(library), { recursive: true })
  await mkdir(path.dirname(file), { recursive: true })
  await writeFileAtomic(
    file,
    `KIE_API_KEY=${JSON.stringify(key)}\nGENHUB_LIBRARY=${JSON.stringify(library)}\n`,
    { mode: 0o600 },
  )

  return { config: file, library: expandHome(library), credits }
}
