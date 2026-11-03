/** 发起生成与等待结果的命令：create / generate / edit / retry / wait。 */
import path from 'node:path'

import {
  createAsset,
  editVersion,
  generateInAsset,
  retryVersion,
} from '../generation/submit'
import type { GenerateOptions } from '../generation/submit'
import { waitForVersions } from '../generation/sync'
import { currentProject, locateAsset } from '../library/context'
import type { AssetLocation, ProjectContext } from '../library/context'
import { parseVersionArg } from '../library/paths'
import { readAsset } from '../library/record'
import { findAssetDirs } from '../library/scan'
import { presentAsset } from '../present'

import { warn } from './output'

export type WaitOptions = { wait: boolean; timeout: number }

export type GenerationArgs = WaitOptions & {
  model?: string
  param: string[]
  count?: number
}

function toGenerateOptions(args: GenerationArgs): GenerateOptions {
  return { model: args.model, params: args.param, count: args.count }
}

/** 按需等待新版本完成，再输出这些版本的状态。 */
async function finish(
  project: ProjectContext,
  location: AssetLocation,
  versions: number[],
  options: WaitOptions,
) {
  if (options.wait) {
    const { warnings } = await waitForVersions(
      [{ dir: location.dir, versions }],
      options.timeout * 1000,
    )

    warnings.forEach(warn)
  }

  return presentAsset(
    project,
    location,
    await readAsset(location.dir),
    versions,
  )
}

export async function createCommand(assetPath: string, args: GenerationArgs) {
  const project = await currentProject()
  const location = locateAsset(project, assetPath)
  const versions = await createAsset(project, location, toGenerateOptions(args))

  return finish(project, location, versions, args)
}

export async function generateCommand(
  assetPath: string,
  args: GenerationArgs & { from?: string },
) {
  const project = await currentProject()
  const location = locateAsset(project, assetPath)
  const versions = await generateInAsset(project, location, {
    ...toGenerateOptions(args),
    from: args.from == null ? undefined : parseVersionArg(args.from),
  })

  return finish(project, location, versions, args)
}

export async function editCommand(
  assetPath: string,
  version: string,
  args: GenerationArgs,
) {
  const project = await currentProject()
  const location = locateAsset(project, assetPath)
  const versions = await editVersion(
    project,
    location,
    parseVersionArg(version),
    toGenerateOptions(args),
  )

  return finish(project, location, versions, args)
}

export async function retryCommand(
  assetPath: string,
  version: string,
  args: WaitOptions,
) {
  const project = await currentProject()
  const location = locateAsset(project, assetPath)
  const versions = await retryVersion(location, parseVersionArg(version))

  return finish(project, location, versions, args)
}

/** 等待某个素材、或当前项目里全部生成中的版本。 */
export async function waitCommand(
  assetPath: string | undefined,
  args: { timeout: number },
) {
  const project = await currentProject()
  const dirs = assetPath
    ? [locateAsset(project, assetPath).dir]
    : await findAssetDirs(project.dir)
  const targets: Array<{ dir: string; versions: number[] }> = []

  for (const dir of dirs) {
    const record = await readAsset(dir)
    const versions = record.versions
      .filter((version) => version.state === 'generating')
      .map((version) => version.number)

    // 指定素材但没有生成中的版本时，直接返回它的全部版本。
    if (versions.length > 0) {
      targets.push({ dir, versions })
    } else if (assetPath) {
      targets.push({ dir, versions: record.versions.map((v) => v.number) })
    }
  }

  const { warnings } = await waitForVersions(targets, args.timeout * 1000)

  warnings.forEach(warn)

  return Promise.all(
    targets.map(async ({ dir, versions }) =>
      presentAsset(
        project,
        {
          path: path.relative(project.dir, dir).split(path.sep).join('/'),
          dir,
        },
        await readAsset(dir),
        versions,
      ),
    ),
  )
}
