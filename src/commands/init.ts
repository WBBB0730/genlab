/** genlab init：写入配置文件（API Key 与库目录），先验证 Key 可用；可顺带安装 skill。 */
import { mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { parseEnv } from 'node:util'

import * as p from '@clack/prompts'
import writeFileAtomic from 'write-file-atomic'

import { configFile } from '../config'
import { CliError } from '../errors'
import { getKieCredits } from '../kie/client'

import { warn } from './output'
import { installSkill } from './skill'

const DEFAULT_LIBRARY = '~/GenLab'

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
function answered<T>(value: T): Exclude<T, symbol> {
  if (p.isCancel(value)) {
    p.cancel('已取消')
    process.exit(1)
  }

  return value as Exclude<T, symbol>
}

function expandHome(dir: string): string {
  return dir === '~' || dir.startsWith('~/')
    ? path.join(homedir(), dir.slice(1))
    : dir
}

/** 验证 Key 后建好库目录、写入配置，返回余额。 */
async function writeConfig(
  file: string,
  key: string | undefined,
  library: string,
) {
  if (!key) {
    throw new CliError('缺少 --key')
  }

  if (!path.isAbsolute(expandHome(library))) {
    throw new CliError(`库目录必须是绝对路径：${library}`)
  }

  const credits = await getKieCredits(key)

  await mkdir(expandHome(library), { recursive: true })
  await mkdir(path.dirname(file), { recursive: true })
  await writeFileAtomic(
    file,
    `KIE_API_KEY=${JSON.stringify(key)}\nGENLAB_LIBRARY=${JSON.stringify(library)}\n`,
    { mode: 0o600 },
  )

  return credits
}

/**
 * 未通过选项给出的值：终端里交互询问（直接回车沿用已有配置），非终端时沿用已有配置，
 * 都没有就报错。未指定 --skill / --no-skill 时终端里询问是否安装 skill，非终端不安装；
 * 安装失败只警告，不影响已写入的配置。有询问时以 intro 开始，配置写入成败作为结尾。
 */
export async function initCommand(args: {
  key?: string
  library?: string
  skill?: boolean
}) {
  const file = configFile()
  const existing = await readConfig(file)
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY)
  const asking =
    interactive && (!args.key || !args.library || args.skill === undefined)
  let key = args.key ?? existing.KIE_API_KEY
  let library = args.library ?? existing.GENLAB_LIBRARY
  let skill = args.skill

  if (asking) {
    p.intro('genlab init')
  }

  if (interactive && !args.key) {
    const input = answered(
      await p.password({
        message: existing.KIE_API_KEY
          ? '请输入 Kie.ai API Key（留空沿用已保存的 Key）：'
          : '请输入 Kie.ai API Key（获取地址：https://kie.ai/api-key）：',
        validate: (value) =>
          value || existing.KIE_API_KEY ? undefined : '不能为空',
      }),
    )

    key = input || existing.KIE_API_KEY
  }

  if (interactive && !args.library) {
    library = answered(
      await p.text({
        message: '请输入库目录（存放所有项目与素材）：',
        initialValue: existing.GENLAB_LIBRARY ?? DEFAULT_LIBRARY,
        validate: (value) => (value ? undefined : '不能为空'),
      }),
    )
  }

  if (interactive && skill === undefined) {
    skill = answered(
      await p.confirm({ message: '是否为本机 agent 安装 GenLab skill？' }),
    )
  }

  library ||= DEFAULT_LIBRARY

  let credits: number

  try {
    credits = await writeConfig(file, key, library)
  } catch (error) {
    if (asking) {
      p.cancel('配置未写入')
    }

    throw error
  }

  if (asking) {
    p.outro('配置已写入')
  }

  let installed = false

  if (skill) {
    try {
      await installSkill(interactive)
      installed = true
    } catch (error) {
      warn((error as Error).message)
    }
  }

  return {
    config: file,
    library: expandHome(library),
    credits,
    skill: installed ? 'genlab' : undefined,
  }
}
