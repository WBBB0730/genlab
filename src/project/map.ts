/**
 * 项目映射：代码项目 → 库里的项目（见 ADR-0004）。有远程仓库的按远程地址识别、
 * 首次自动以仓库名登记；没有的按主仓库位置识别、首次必须指定名字；中途建了远程
 * 仓库的，按位置找到原条目补上远程地址，名字不变。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import lockfile from 'proper-lockfile'
import writeFileAtomic from 'write-file-atomic'

import { CliError } from '../errors'
import { PROJECT_MAP_FILE, validateName } from '../library/paths'

import type { CodeProject } from './identify'

export type ProjectEntry = {
  name: string
  remote: string | null
  path: string
}

export type ProjectMap = { projects: ProjectEntry[] }

/** 远程地址 → host/owner/repo（小写、去掉协议、用户名与 .git），用于判断是否同一仓库。 */
export function normalizeRemote(url: string): string {
  return remotePath(url).toLowerCase()
}

/** 远程仓库名（保留大小写），如 https://github.com/owner/pixel-quest.git → pixel-quest。 */
export function repoName(url: string): string {
  return remotePath(url).split('/').pop() ?? ''
}

function remotePath(url: string): string {
  const trimmed = url.trim()
  let location: string

  if (trimmed.includes('://')) {
    const parsed = new URL(trimmed)

    location = `${parsed.hostname}${parsed.pathname}`
  } else {
    // scp 形式：user@host:owner/repo
    const withoutUser = trimmed.slice(trimmed.indexOf('@') + 1)

    location = withoutUser.replace(':', '/')
  }

  return location.replace(/\/+$/, '').replace(/\.git$/, '')
}

function findEntry(
  map: ProjectMap,
  project: CodeProject,
): ProjectEntry | undefined {
  if (project.remote) {
    const remote = normalizeRemote(project.remote)
    const byRemote = map.projects.find(
      (entry) =>
        entry.remote != null && normalizeRemote(entry.remote) === remote,
    )

    if (byRemote) {
      return byRemote
    }
  }

  return map.projects.find(
    (entry) => entry.remote == null && entry.path === project.path,
  )
}

/**
 * 按位置找到的条目补上新建的远程地址；返回是否有变化。按远程地址识别的条目不再
 * 依赖位置，位置保持登记时的值（同一远程的多个副本不会来回改写）。
 */
function refreshEntry(entry: ProjectEntry, project: CodeProject): boolean {
  if (project.remote && entry.remote == null) {
    entry.remote = project.remote

    return true
  }

  return false
}

/** 查表；有远程仓库且未登记时自动以仓库名登记。就地修改 map，返回条目与是否有变化。 */
export function resolveProject(
  map: ProjectMap,
  project: CodeProject,
): { entry: ProjectEntry; changed: boolean } {
  const existing = findEntry(map, project)

  if (existing) {
    return { entry: existing, changed: refreshEntry(existing, project) }
  }

  if (!project.remote) {
    throw new CliError(
      `当前代码项目未登记，运行 genlab project <名字> 登记：${project.path}`,
    )
  }

  const name = validateName(repoName(project.remote), '项目名')

  if (map.projects.some((entry) => entry.name === name)) {
    throw new CliError(
      `项目名 ${name} 已被其他代码项目使用，运行 genlab project <名字> 指定`,
    )
  }

  const entry = { name, remote: project.remote, path: project.path }

  map.projects.push(entry)

  return { entry, changed: true }
}

/** 登记或修改当前代码项目对应的项目名；只改对应关系，不移动素材文件夹。 */
export function assignProject(
  map: ProjectMap,
  project: CodeProject,
  name: string,
): ProjectEntry {
  const validName = validateName(name, '项目名')

  if (validName === PROJECT_MAP_FILE) {
    throw new CliError(`项目名不能是 ${PROJECT_MAP_FILE}`)
  }

  const existing = findEntry(map, project)

  if (existing) {
    refreshEntry(existing, project)
    existing.name = validName

    return existing
  }

  const entry = { name: validName, remote: project.remote, path: project.path }

  map.projects.push(entry)

  return entry
}

/** 互斥地读改写库根目录下的映射表；mutate 返回是否需要写回。 */
export async function updateProjectMap<T>(
  root: string,
  mutate: (map: ProjectMap) => { result: T; changed: boolean },
): Promise<T> {
  const file = path.join(root, PROJECT_MAP_FILE)

  await mkdir(root, { recursive: true })

  try {
    await writeFile(file, `${JSON.stringify({ projects: [] }, null, 2)}\n`, {
      flag: 'wx',
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error
    }
  }

  const release = await lockfile.lock(file, {
    retries: { retries: 50, minTimeout: 20, maxTimeout: 200 },
    stale: 30_000,
  })

  try {
    const map = JSON.parse(await readFile(file, 'utf8')) as ProjectMap
    const { result, changed } = mutate(map)

    if (changed) {
      await writeFileAtomic(file, `${JSON.stringify(map, null, 2)}\n`)
    }

    return result
  } finally {
    await release()
  }
}
