/** 识别调用时所在的代码项目：远程地址 + 主仓库位置（见 ADR-0004）。 */
import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

export type CodeProject = {
  /** 远程仓库地址；没有远程仓库或不是 git 仓库时为 null。 */
  remote: string | null
  /** 主仓库所在位置（worktree 归到主仓库）；不是 git 仓库时为目录本身。 */
  path: string
}

async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run('git', ['-C', cwd, ...args])

    return stdout.trim() || null
  } catch {
    return null
  }
}

export async function identifyCodeProject(cwd: string): Promise<CodeProject> {
  const dir = await realpath(cwd)
  const commonDir = await git(dir, [
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
  ])

  if (!commonDir) {
    return { remote: null, path: dir }
  }

  // 主仓库的 .git 的上一级即主仓库；worktree 的 common dir 也指向主仓库的 .git。
  const mainPath =
    path.basename(commonDir) === '.git'
      ? path.dirname(commonDir)
      : ((await git(dir, ['rev-parse', '--show-toplevel'])) ?? dir)

  return { remote: await remoteUrl(mainPath), path: await realpath(mainPath) }
}

/** 优先 origin，否则取第一个远程。 */
async function remoteUrl(repo: string): Promise<string | null> {
  const remotes = (await git(repo, ['remote']))?.split('\n') ?? []
  const name = remotes.includes('origin') ? 'origin' : remotes[0]

  return name ? git(repo, ['remote', 'get-url', name]) : null
}
