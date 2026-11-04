/** 命令输出的 JSON 形状：路径一律绝对路径，空字段省略。 */
import path from 'node:path'

import type { AssetLocation, ProjectContext } from './library/context'
import { findGeneration } from './library/record'
import type { AssetRecord, VersionRecord } from './library/record'

type Json = Record<string, unknown>

/** 去掉值为 null / undefined 的字段。 */
function compact<T extends Json>(object: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value != null),
  ) as Partial<T>
}

export function presentVersion(
  dir: string,
  record: AssetRecord,
  version: VersionRecord,
) {
  return compact({
    version: version.number,
    state: version.state,
    model: findGeneration(record, version.generation)?.model,
    file: version.file ? path.join(dir, version.file) : null,
    mimeType: version.mimeType,
    width: version.width,
    height: version.height,
    duration: version.duration,
    fileSize: version.fileSize,
    credits: version.credits,
    failReason: version.failReason,
    generation: version.generation,
    sourceVersion: version.sourceVersion,
    importedFrom: version.importedFrom,
  })
}

/**
 * 加上与这些版本同一个 kie 任务的版本：一个任务返回多个结果时，多出来的结果在收取时
 * 才追加为新版本。
 */
function withTaskSiblings(record: AssetRecord, versions: number[]): number[] {
  const taskIds = new Set(
    record.versions
      .filter((version) => versions.includes(version.number))
      .map((version) => version.taskId)
      .filter((taskId) => taskId != null),
  )

  return record.versions
    .filter(
      (version) =>
        versions.includes(version.number) ||
        (version.taskId != null && taskIds.has(version.taskId)),
    )
    .map((version) => version.number)
}

/**
 * versions 指定时只列这些版本（连同同一任务追加出的版本）；pending 表示其中仍有生成中
 * 的版本。
 */
export function presentAsset(
  project: ProjectContext,
  location: AssetLocation,
  record: AssetRecord,
  versions?: number[],
) {
  const wanted = versions && withTaskSiblings(record, versions)
  const listed = record.versions.filter(
    (version) => !wanted || wanted.includes(version.number),
  )

  return {
    project: project.name,
    asset: location.path,
    dir: location.dir,
    kind: record.kind,
    current: record.currentVersion,
    pending: listed.some((version) => version.state === 'generating'),
    versions: listed.map((version) =>
      presentVersion(location.dir, record, version),
    ),
  }
}

export function presentGenerations(dir: string, record: AssetRecord) {
  return record.generations.map((generation) =>
    compact({
      generation: generation.id,
      model: generation.model,
      input: generation.input,
      sourceVersion: generation.sourceVersion,
      references: generation.references.map((reference) =>
        compact({
          file: path.join(dir, reference.file),
          name: reference.name,
          kind: reference.kind,
          origin: reference.origin,
        }),
      ),
      createdAt: generation.createdAt,
    }),
  )
}
