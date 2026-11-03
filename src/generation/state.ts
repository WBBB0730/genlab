/**
 * 版本状态推进（纯函数，就地修改素材记录）。只有生成中的版本会被推进，重复推进
 * 不产生副作用（幂等）。
 */
import type { AssetRecord, VersionRecord } from '../library/record'
import { now } from '../library/record'
import { nextCurrentAfterFailure } from '../library/rules'

export type ProductInfo = Pick<
  VersionRecord,
  'file' | 'mimeType' | 'fileSize' | 'width' | 'height' | 'duration'
>

/** 一个 kie 任务对应的版本里，积分只记在结果序号 0 上，避免重复计量。 */
function creditsFor(version: VersionRecord, credits: number | null) {
  return (version.resultIndex ?? 0) === 0 ? credits : null
}

export function failVersion(
  record: AssetRecord,
  number: number,
  reason: string,
  task: { credits: number | null; kieRecord: unknown } = {
    credits: null,
    kieRecord: null,
  },
) {
  const version = record.versions.find((item) => item.number === number)

  if (!version || version.state !== 'generating') {
    return
  }

  version.state = 'failed'
  version.failReason = reason
  version.credits = creditsFor(version, task.credits)
  version.kieRecord = task.kieRecord
  version.updatedAt = now()

  // 当前版本失败时顺位到同一次生成里靠后、尚未失败的版本。
  if (record.currentVersion === number) {
    const next = nextCurrentAfterFailure(record.versions, version)

    if (next != null) {
      record.currentVersion = next
    }
  }
}

export function fulfillVersion(
  record: AssetRecord,
  number: number,
  product: ProductInfo,
  task: { credits: number | null; kieRecord: unknown },
) {
  const version = record.versions.find((item) => item.number === number)

  if (!version || version.state !== 'generating') {
    return
  }

  Object.assign(version, product, {
    state: 'ready',
    failReason: null,
    credits: creditsFor(version, task.credits),
    kieRecord: task.kieRecord,
    updatedAt: now(),
  })
}
