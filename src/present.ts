/** 命令输出的 JSON 形状：路径一律绝对路径，空字段省略。 */
import path from 'node:path'

import type { AssetLocation, ProjectContext } from './library/context'
import type { AssetRecord, VersionRecord } from './library/record'

type Json = Record<string, unknown>

/** 去掉值为 null / undefined 的字段。 */
function compact<T extends Json>(object: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value != null),
  ) as Partial<T>
}

export function presentVersion(dir: string, version: VersionRecord) {
  return compact({
    version: version.number,
    state: version.state,
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

/** versions 指定时只列这些版本；pending 表示其中仍有生成中的版本。 */
export function presentAsset(
  project: ProjectContext,
  location: AssetLocation,
  record: AssetRecord,
  versions?: number[],
) {
  const listed = record.versions.filter(
    (version) => !versions || versions.includes(version.number),
  )

  return {
    project: project.name,
    asset: location.path,
    dir: location.dir,
    kind: record.kind,
    current: record.currentVersion,
    pending: listed.some((version) => version.state === 'generating'),
    versions: listed.map((version) => presentVersion(location.dir, version)),
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
