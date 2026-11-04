/**
 * 项目关联：代码项目里的 .genlab 点目录记下它对应库里的哪个项目（见 ADR-0006）。
 * 点目录自带只忽略自身的 .gitignore，不改动代码项目的任何忽略设置。
 */
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import writeFileAtomic from 'write-file-atomic'

import { CliError } from '../errors'

export const LINK_DIR = '.genlab'

const LINK_FILE = 'project.json'
const GITIGNORE = '# GenLab 自动创建\n*\n'

export type ProjectLink = {
  project: string
  /** 关联所在的点目录。 */
  dir: string
}

async function readIfExists(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }

    throw error
  }
}

function parseLink(text: string, file: string): string {
  let project: unknown

  try {
    project = (JSON.parse(text) as { project?: unknown }).project
  } catch {
    project = undefined
  }

  if (typeof project !== 'string') {
    throw new CliError(`关联文件不合法：${file}`)
  }

  return project
}

/** 从 cwd 逐级向上找最近的关联；都没有时返回 null。 */
export async function findLink(cwd: string): Promise<ProjectLink | null> {
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    const linkDir = path.join(dir, LINK_DIR)
    const file = path.join(linkDir, LINK_FILE)
    const text = await readIfExists(file)

    if (text != null) {
      return { project: parseLink(text, file), dir: linkDir }
    }

    if (path.dirname(dir) === dir) {
      return null
    }
  }
}

/** 在 cwd 写入关联，返回点目录。 */
export async function writeLink(cwd: string, project: string): Promise<string> {
  const linkDir = path.join(path.resolve(cwd), LINK_DIR)

  await mkdir(linkDir, { recursive: true })
  await writeFileAtomic(path.join(linkDir, '.gitignore'), GITIGNORE)
  await writeFileAtomic(
    path.join(linkDir, LINK_FILE),
    `${JSON.stringify({ project }, null, 2)}\n`,
  )

  return linkDir
}
