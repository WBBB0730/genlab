/** 库与元信息命令：models / import / use / delete / show / list。 */
import path from 'node:path'

import { CliError } from '../errors'
import { currentProject, locateAsset } from '../library/context'
import type { ProjectOption } from '../library/context'
import { deleteVersion, importAsset, setCurrentVersion } from '../library/ops'
import { parseAssetPath, parseVersionArg } from '../library/paths'
import { assetFile, readAsset } from '../library/record'
import { findAssetDirs } from '../library/scan'
import { findModel, kindForModel, listModels } from '../catalog/catalog'
import { describeInput, getInputSchema } from '../catalog/schema'
import { MEDIA_KINDS } from '../library/media'
import type { MediaKind } from '../library/media'
import { presentAsset, presentGenerations, presentVersion } from '../present'

function parseKind(kind: string | undefined): MediaKind | undefined {
  if (kind != null && !MEDIA_KINDS.includes(kind as MediaKind)) {
    throw new CliError(`类型可选值：${MEDIA_KINDS.join(', ')}`)
  }

  return kind as MediaKind | undefined
}

/** 模型列表（来自 kie 模型目录，从新到旧），或单个模型的价格与参数表。 */
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

  // kie 目录按上架时间从旧到新排列，反过来让新模型排在前面。
  for (const model of (await listModels(args.refresh)).toReversed()) {
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

export async function importCommand(
  assetPath: string,
  file: string,
  args: ProjectOption,
) {
  const project = await currentProject(args.project)
  const location = locateAsset(project, assetPath)

  await importAsset(project, location, file)

  return presentAsset(project, location, await readAsset(location.dir))
}

export async function useCommand(
  assetPath: string,
  version: string,
  args: ProjectOption,
) {
  const project = await currentProject(args.project)
  const location = locateAsset(project, assetPath)

  await setCurrentVersion(location, parseVersionArg(version))

  return presentAsset(project, location, await readAsset(location.dir))
}

export async function deleteCommand(
  assetPath: string,
  version: string,
  args: ProjectOption,
) {
  const project = await currentProject(args.project)
  const location = locateAsset(project, assetPath)

  await deleteVersion(location, parseVersionArg(version))

  return presentAsset(project, location, await readAsset(location.dir))
}

export async function showCommand(assetPath: string, args: ProjectOption) {
  const project = await currentProject(args.project)
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
  args: { kind?: string } & ProjectOption,
) {
  const kind = parseKind(args.kind)
  const project = await currentProject(args.project)
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
