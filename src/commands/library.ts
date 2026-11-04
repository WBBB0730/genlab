/** 库与元信息命令：models / project / import / use / delete / show / list。 */
import path from 'node:path'

import { CliError } from '../errors'
import { syncAssets } from '../generation/sync'
import { libraryRoot } from '../config'
import { currentProject, locateAsset } from '../library/context'
import { deleteVersion, importAsset, setCurrentVersion } from '../library/ops'
import { parseAssetPath, parseVersionArg } from '../library/paths'
import { assetFile, readAsset } from '../library/record'
import { findAssetDirs } from '../library/scan'
import { findModel, kindForModel, listModels } from '../catalog/catalog'
import { describeInput, getInputSchema } from '../catalog/schema'
import { MEDIA_KINDS } from '../library/media'
import type { MediaKind } from '../library/media'
import { identifyCodeProject } from '../project/identify'
import { assignProject, updateProjectMap } from '../project/map'
import { presentAsset, presentGenerations, presentVersion } from '../present'

import { warn } from './output'

/** 收取库里所有已完成的生成（每条库命令执行前跑一遍，不等待）。 */
export async function syncLibrary() {
  const warnings = await syncAssets(await findAssetDirs(libraryRoot()))

  warnings.forEach(warn)
}

function parseKind(kind: string | undefined): MediaKind | undefined {
  if (kind != null && !MEDIA_KINDS.includes(kind as MediaKind)) {
    throw new CliError(`类型可选值：${MEDIA_KINDS.join(', ')}`)
  }

  return kind as MediaKind | undefined
}

/** 模型列表（来自 kie 模型目录），或单个模型的价格与参数表。 */
export async function modelsCommand(
  id: string | undefined,
  args: { kind?: string; search?: string; refresh?: boolean },
) {
  if (id) {
    const model = await findModel(id)

    return {
      model: model.model,
      kind: model.kind,
      taskType: model.taskType,
      provider: model.provider,
      price: model.pricingDesc,
      ...describeInput(await getInputSchema(model.model, args.refresh)),
    }
  }

  const kind = parseKind(args.kind)
  const search = args.search?.toLowerCase()
  const models = []

  for (const model of await listModels(args.refresh)) {
    let modelKind: MediaKind | null

    try {
      modelKind = kindForModel(model)
    } catch {
      continue
    }

    if (!modelKind || (kind && modelKind !== kind)) {
      continue
    }

    const text = `${model.model} ${model.provider ?? ''} ${model.title ?? ''}`

    if (search && !text.toLowerCase().includes(search)) {
      continue
    }

    models.push({
      model: model.model,
      kind: modelKind,
      taskType: model.taskType,
      provider: model.provider,
    })
  }

  return models
}

export async function projectCommand(name: string | undefined) {
  if (name) {
    const root = libraryRoot()
    const codeProject = await identifyCodeProject(process.cwd())

    await updateProjectMap(root, (map) => ({
      result: assignProject(map, codeProject, name),
      changed: true,
    }))
  }

  const project = await currentProject()

  return {
    project: project.name,
    dir: project.dir,
    remote: project.codeProject.remote,
    codeProject: project.codeProject.path,
  }
}

export async function importCommand(assetPath: string, file: string) {
  const project = await currentProject()
  const location = locateAsset(project, assetPath)

  await importAsset(project, location, file)

  return presentAsset(project, location, await readAsset(location.dir))
}

export async function useCommand(assetPath: string, version: string) {
  const project = await currentProject()
  const location = locateAsset(project, assetPath)

  await setCurrentVersion(location, parseVersionArg(version))

  return presentAsset(project, location, await readAsset(location.dir))
}

export async function deleteCommand(assetPath: string, version: string) {
  const project = await currentProject()
  const location = locateAsset(project, assetPath)

  await deleteVersion(location, parseVersionArg(version))

  return presentAsset(project, location, await readAsset(location.dir))
}

export async function showCommand(assetPath: string) {
  const project = await currentProject()
  const location = locateAsset(project, assetPath)
  const record = await readAsset(location.dir)

  return {
    ...presentAsset(project, location, record),
    record: assetFile(location.dir),
    generations: presentGenerations(location.dir, record),
  }
}

export async function listCommand(
  folder: string | undefined,
  args: { kind?: string },
) {
  const kind = parseKind(args.kind)
  const project = await currentProject()
  const base = folder
    ? path.join(project.dir, ...parseAssetPath(folder))
    : project.dir
  const assets = []

  for (const dir of await findAssetDirs(base)) {
    const record = await readAsset(dir)

    if (kind && record.kind !== kind) {
      continue
    }

    const current = record.versions.find(
      (version) => version.number === record.currentVersion,
    )

    assets.push({
      asset: path.relative(project.dir, dir).split(path.sep).join('/'),
      kind: record.kind,
      versions: record.versions.length,
      generating: record.versions.filter((v) => v.state === 'generating')
        .length,
      failed: record.versions.filter((v) => v.state === 'failed').length,
      current: current ? presentVersion(dir, record, current) : null,
    })
  }

  return { project: project.name, dir: project.dir, assets }
}
