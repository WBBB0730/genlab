/** 项目命令：查看当前目录的关联、新建项目、关联当前目录（见 ADR-0006）。 */
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import { libraryRoot } from '../config'
import { CliError } from '../errors'
import { DEFAULT_PROJECT, listProjects, openProject } from '../library/context'
import { validateName } from '../library/paths'
import { findLink, writeLink } from '../project/link'

export async function projectCommand() {
  const root = libraryRoot()
  const link = await findLink(process.cwd())

  return {
    project: link?.project,
    dir: link ? path.join(root, link.project) : undefined,
    link: link?.dir,
    projects: await listProjects(root),
  }
}

export async function projectCreateCommand(name: string) {
  const root = libraryRoot()
  const validName = validateName(name, '项目名')

  if (validName === DEFAULT_PROJECT) {
    throw new CliError(`${DEFAULT_PROJECT} 是内置项目，无需新建`)
  }

  const dir = path.join(root, validName)

  await mkdir(root, { recursive: true })

  try {
    await mkdir(dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new CliError(`项目已存在：${validName}`)
    }

    throw error
  }

  return { project: validName, dir }
}

/** 在当前目录写入关联：指向已有项目或 default。 */
export async function projectLinkCommand(name: string) {
  const project = await openProject(libraryRoot(), name)
  const link = await writeLink(process.cwd(), project.name)

  return { project: project.name, dir: project.dir, link }
}
