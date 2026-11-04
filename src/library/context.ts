/** 命令的运行上下文：库根目录 + 本次使用的项目 + 素材定位。 */
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'

import { libraryRoot } from '../config'
import { CliError } from '../errors'
import { findLink } from '../project/link'

import { parseAssetPath, validateName } from './paths'

/** 内置项目：一直存在，放不属于任何代码项目的素材。 */
export const DEFAULT_PROJECT = 'default'

export type ProjectContext = {
  root: string
  name: string
  dir: string
}

/** 命令的 --project：本次使用的项目，不改动关联。 */
export type ProjectOption = { project?: string }

export type AssetLocation = {
  /** 相对项目的素材路径，如 characters/hero。 */
  path: string
  dir: string
}

async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await stat(dir)).isDirectory()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }

    throw error
  }
}

/** 库里的全部项目（库根目录下的文件夹），default 总在最前。 */
export async function listProjects(root: string): Promise<string[]> {
  let names: string[] = []

  try {
    names = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }

  return [
    DEFAULT_PROJECT,
    ...names.filter((name) => name !== DEFAULT_PROJECT).sort(),
  ]
}

async function projectsHint(root: string): Promise<string> {
  return `；已有项目：${(await listProjects(root)).join('、')}`
}

/**
 * 项目必须已存在；default 除外，首次放入素材时自动建好。missing 是项目不存在时的
 * 提示，默认提示新建。
 */
export async function openProject(
  root: string,
  name: string,
  missing?: string,
): Promise<ProjectContext> {
  const validName = validateName(name, '项目名')
  const dir = path.join(root, validName)

  if (validName !== DEFAULT_PROJECT && !(await isDirectory(dir))) {
    throw new CliError(
      `${missing ?? `项目不存在：${validName}，运行 genlab project create ${validName} 新建`}${await projectsHint(root)}`,
    )
  }

  return { root, name: validName, dir }
}

/** 本次使用的项目：指定的项目优先，否则取 cwd 的关联。 */
export async function resolveProject(
  root: string,
  cwd: string,
  override?: string,
): Promise<ProjectContext> {
  if (override != null) {
    return openProject(root, override)
  }

  const link = await findLink(cwd)

  if (link == null) {
    throw new CliError(
      `当前目录未关联项目：运行 genlab project link <项目> 关联，不属于任何项目时用 ${DEFAULT_PROJECT}${await projectsHint(root)}`,
    )
  }

  // 关联的项目文件夹不在了（如改名或删除）：工具判断不了该换成哪个，让 agent 问用户；
  // 不提示新建，以免建出同名的空项目。
  return openProject(
    root,
    link.project,
    `当前目录关联的项目不存在：${link.project}，可能已改名或删除；问用户要关联到哪个项目，再运行 genlab project link <项目>`,
  )
}

export function currentProject(override?: string): Promise<ProjectContext> {
  return resolveProject(libraryRoot(), process.cwd(), override)
}

export function locateAsset(
  project: ProjectContext,
  assetPath: string,
): AssetLocation {
  const segments = parseAssetPath(assetPath)

  return {
    path: segments.join('/'),
    dir: path.join(project.dir, ...segments),
  }
}
