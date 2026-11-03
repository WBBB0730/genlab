/** 命令的运行上下文：库根目录 + 当前代码项目对应的项目 + 素材定位。 */
import path from 'node:path'

import { libraryRoot } from '../config'
import { identifyCodeProject } from '../project/identify'
import type { CodeProject } from '../project/identify'
import { resolveProject, updateProjectMap } from '../project/map'

import { parseAssetPath } from './paths'

export type ProjectContext = {
  root: string
  name: string
  dir: string
  codeProject: CodeProject
}

export type AssetLocation = {
  /** 相对项目的素材路径，如 角色/主角立绘。 */
  path: string
  dir: string
}

export async function currentProject(
  cwd = process.cwd(),
): Promise<ProjectContext> {
  const root = libraryRoot()
  const codeProject = await identifyCodeProject(cwd)
  const name = await updateProjectMap(root, (map) => {
    const { entry, changed } = resolveProject(map, codeProject)

    return { result: entry.name, changed }
  })

  return { root, name, dir: path.join(root, name), codeProject }
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
