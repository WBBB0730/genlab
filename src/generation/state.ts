/**
 * 版本与任务的状态推进（纯函数，就地修改素材记录）。只有生成中的版本、尚未记下终态的
 * 任务会被推进，重复推进不产生副作用（幂等）。
 */
import { kieUsage } from '../kie/record'
import type { KieRecord } from '../kie/record'
import type { AssetRecord, VersionRecord } from '../library/record'
import { findTask, now } from '../library/record'
import { nextCurrentAfterFailure } from '../library/rules'

export type ProductInfo = Pick<
  VersionRecord,
  'file' | 'mimeType' | 'fileSize' | 'width' | 'height' | 'duration'
>

/** 记下任务的终态：kie 原始记录、积分与耗时。 */
export function settleTask(
  record: AssetRecord,
  id: string,
  kieRecord: KieRecord,
) {
  const task = findTask(record, id)

  if (!task || task.kieRecord != null) {
    return
  }

  Object.assign(task, { kieRecord, ...kieUsage(kieRecord) })
}

export function failVersion(
  record: AssetRecord,
  number: number,
  reason: string,
) {
  const version = record.versions.find((item) => item.number === number)

  if (!version || version.state !== 'generating') {
    return
  }

  version.state = 'failed'
  version.failReason = reason
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
) {
  const version = record.versions.find((item) => item.number === number)

  if (!version || version.state !== 'generating') {
    return
  }

  Object.assign(version, product, {
    state: 'ready',
    failReason: null,
    updatedAt: now(),
  })
}
