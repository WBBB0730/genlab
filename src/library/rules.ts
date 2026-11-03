/** 版本规则（纯函数，见 docs/adr/0001-asset-centric-model.md）。 */
import type { VersionRecord } from './record'

type VersionLite = Pick<
  VersionRecord,
  'number' | 'state' | 'generation' | 'position' | 'sourceVersion'
>

export function nextVersionNumber(versions: VersionLite[]): number {
  return Math.max(0, ...versions.map((version) => version.number)) + 1
}

export function nextGenerationId(generations: Array<{ id: number }>): number {
  return Math.max(0, ...generations.map((generation) => generation.id)) + 1
}

/** 来源链叶子：没有任何版本以它为源版本。 */
export function isLeaf(versions: VersionLite[], version: number): boolean {
  return !versions.some((item) => item.sourceVersion === version)
}

/**
 * 当前版本失败后的顺位目标：同一次生成里序号更靠后、尚未失败的版本，取版本号最小者
 * （靠前优先、慢也等它）。没有可用版本时返回 null（指针停在失败版本）。
 */
export function nextCurrentAfterFailure(
  versions: VersionLite[],
  failed: Pick<VersionLite, 'generation' | 'position'>,
): number | null {
  if (failed.generation == null || failed.position == null) {
    return null
  }

  const candidates = versions
    .filter(
      (version) =>
        version.generation === failed.generation &&
        version.position != null &&
        version.position > failed.position! &&
        version.state !== 'failed',
    )
    .sort((a, b) => a.number - b.number)

  return candidates[0]?.number ?? null
}

/**
 * 删除当前版本后的回退目标：源版本（就绪）→ 最新就绪 → 最新生成中（均排除被删
 * 版本）。都没有时返回 null（调用方应据此阻止删除）。
 */
export function nextCurrentAfterDelete(
  versions: VersionLite[],
  deleted: number,
  sourceVersion: number | null,
): number | null {
  const others = versions.filter((version) => version.number !== deleted)

  if (sourceVersion != null) {
    const source = others.find(
      (version) =>
        version.number === sourceVersion && version.state === 'ready',
    )

    if (source) {
      return source.number
    }
  }

  const byNumberDesc = [...others].sort((a, b) => b.number - a.number)
  const ready = byNumberDesc.find((version) => version.state === 'ready')

  if (ready) {
    return ready.number
  }

  return (
    byNumberDesc.find((version) => version.state === 'generating')?.number ??
    null
  )
}
