/**
 * 向 kie 求证并收取产物：按任务分组，一次 recordInfo 推进同一任务的全部版本。
 * 产物先下载到素材文件夹里的临时文件，加锁确认版本仍在等待该任务后再就位，
 * 因此多个进程同时收取也只会落一份（幂等）。
 */
import { rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { setTimeout as sleep } from 'node:timers/promises'

import { downloadFile, getKieRecord } from '../kie/client'
import { parseKieRecord } from '../kie/record'
import type { KieRecord, KieResultItem } from '../kie/record'
import { inspectMedia } from '../library/media'
import { versionFileName } from '../library/paths'
import { now, readAsset, updateAsset } from '../library/record'
import { nextVersionNumber } from '../library/rules'
import type { AssetRecord, VersionRecord } from '../library/record'

import { failVersion, fulfillVersion } from './state'
import type { ProductInfo } from './state'

export type SyncDeps = {
  getRecord: (taskId: string) => Promise<KieRecord>
  download: (
    url: string,
  ) => Promise<{ bytes: Uint8Array; contentType: string | null }>
}

const defaultDeps: SyncDeps = {
  getRecord: getKieRecord,
  download: downloadFile,
}

/** 提交到一半中断（有记录、没任务编号）的版本，超过这个时长按失败处理，可重试。 */
const STUCK_DISPATCH_MS = 10 * 60_000

const POLL_INTERVAL_MS = 5_000

/** 同步一批素材里所有生成中的版本；返回过程中遇到的问题（不中断其余任务）。 */
export async function syncAssets(
  assetDirs: string[],
  deps: SyncDeps = defaultDeps,
): Promise<string[]> {
  // 单个素材出错（如记录损坏）只记警告，不影响其余素材。
  const warnings = await Promise.all(
    assetDirs.map((dir) =>
      syncAsset(dir, deps).catch((error: unknown) => [
        `${dir}：${(error as Error).message}`,
      ]),
    ),
  )

  return warnings.flat()
}

/**
 * 轮询直到目标版本全部到达终态或超时；返回是否全部完成与过程中的问题。
 * targets 的 versions 为空表示该素材里所有生成中的版本。
 */
export async function waitForVersions(
  targets: Array<{ dir: string; versions?: number[] }>,
  timeoutMs: number,
  deps: SyncDeps = defaultDeps,
): Promise<{ done: boolean; warnings: string[] }> {
  const deadline = Date.now() + timeoutMs
  const warnings = new Set<string>()

  for (;;) {
    for (const warning of await syncAssets(
      targets.map((target) => target.dir),
      deps,
    )) {
      warnings.add(warning)
    }

    if (await allSettled(targets)) {
      return { done: true, warnings: [...warnings] }
    }

    if (Date.now() + POLL_INTERVAL_MS > deadline) {
      return { done: false, warnings: [...warnings] }
    }

    await sleep(POLL_INTERVAL_MS)
  }
}

async function allSettled(
  targets: Array<{ dir: string; versions?: number[] }>,
): Promise<boolean> {
  for (const target of targets) {
    const record = await readAsset(target.dir)
    const pending = record.versions.some(
      (version) =>
        version.state === 'generating' &&
        (!target.versions || target.versions.includes(version.number)),
    )

    if (pending) {
      return false
    }
  }

  return true
}

async function syncAsset(dir: string, deps: SyncDeps): Promise<string[]> {
  const record = await readAsset(dir)
  const generating = record.versions.filter(
    (version) => version.state === 'generating',
  )
  const stuck = generating.filter(
    (version) =>
      !version.taskId &&
      Date.now() - Date.parse(version.updatedAt) > STUCK_DISPATCH_MS,
  )

  if (stuck.length > 0) {
    await updateAsset(dir, (latest) => {
      for (const version of stuck) {
        if (
          !latest.versions.find((item) => item.number === version.number)
            ?.taskId
        ) {
          failVersion(latest, version.number, '提交中断，可重试')
        }
      }
    })
  }

  const taskIds = [
    ...new Set(
      generating
        .map((version) => version.taskId)
        .filter((taskId): taskId is string => taskId != null),
    ),
  ]
  const warnings: string[] = []

  for (const taskId of taskIds) {
    try {
      await syncTask(dir, record, taskId, deps)
    } catch (error) {
      warnings.push(
        `${path.basename(dir)} 任务 ${taskId} 同步失败：${(error as Error).message}`,
      )
    }
  }

  return warnings
}

async function syncTask(
  dir: string,
  record: AssetRecord,
  taskId: string,
  deps: SyncDeps,
) {
  const kieRecord = await deps.getRecord(taskId)
  const result = parseKieRecord(kieRecord)

  if (result.state === 'pending') {
    return
  }

  const members = record.versions.filter(
    (version) => version.state === 'generating' && version.taskId === taskId,
  )
  const task = { credits: result.credits, kieRecord }

  if (result.state === 'failed') {
    await updateAsset(dir, (latest) => {
      for (const member of members) {
        if (stillWaiting(latest, member.number, taskId)) {
          failVersion(
            latest,
            member.number,
            result.failReason ?? '生成失败',
            task,
          )
        }
      }
    })

    return
  }

  // 先把全部产物下载到临时文件，锁内再按结果序号落定：已有版本壳的就位，多出来的结果
  // 追加为同一次生成的新版本，缺结果的版本壳标失败。
  const downloads = await Promise.all(
    result.results.map((item, index) =>
      downloadProduct(dir, record, taskId, index, item, deps),
    ),
  )

  await updateAsset(dir, async (latest) => {
    const waiting = members.filter((member) =>
      stillWaiting(latest, member.number, taskId),
    )
    const lead = waiting[0]

    for (const [index, product] of downloads.entries()) {
      const existing = latest.versions.find(
        (version) => version.taskId === taskId && version.resultIndex === index,
      )
      const target =
        existing ?? (lead ? appendResultVersion(latest, lead, index) : null)

      if (!target || target.state !== 'generating') {
        if (!('error' in product)) {
          await rm(product.temp, { force: true })
        }

        continue
      }

      if ('error' in product) {
        failVersion(latest, target.number, product.error, task)
      } else {
        const file = versionFileName(target.number, product.extension)

        await rename(product.temp, path.join(dir, file))
        fulfillVersion(latest, target.number, { ...product.info, file }, task)
      }
    }

    for (const member of waiting) {
      if (stillWaiting(latest, member.number, taskId)) {
        failVersion(latest, member.number, '生成结果为空', task)
      }
    }
  })
}

function stillWaiting(record: AssetRecord, number: number, taskId: string) {
  const version = record.versions.find((item) => item.number === number)

  return version?.state === 'generating' && version.taskId === taskId
}

/** 一个任务返回多个结果时，为多出来的结果追加同一次生成的新版本（排在该生成末尾）。 */
function appendResultVersion(
  record: AssetRecord,
  lead: VersionRecord,
  resultIndex: number,
): VersionRecord {
  const positions = record.versions
    .filter((version) => version.generation === lead.generation)
    .map((version) => version.position ?? 0)
  const version: VersionRecord = {
    ...lead,
    number: nextVersionNumber(record.versions),
    state: 'generating',
    position: Math.max(...positions) + 1,
    resultIndex,
    createdAt: now(),
    updatedAt: now(),
  }

  record.versions.push(version)

  return version
}

/** 下载并识别产物；类型与素材不符时返回错误（按失败处理），网络错误直接抛出（下次再收）。 */
async function downloadProduct(
  dir: string,
  record: AssetRecord,
  taskId: string,
  index: number,
  item: KieResultItem,
  deps: SyncDeps,
): Promise<
  | { temp: string; extension: string; info: Omit<ProductInfo, 'file'> }
  | { error: string }
> {
  const { bytes, contentType } = await deps.download(item.url)
  const media = await inspectMedia(bytes, contentType)

  if (media.kind !== record.kind) {
    return {
      error: `产物类型（${media.kind}）与素材类型（${record.kind}）不符`,
    }
  }

  const temp = path.join(dir, `.${taskId}-${index}.${process.pid}.part`)

  await writeFile(temp, bytes)

  return {
    temp,
    extension: media.extension,
    info: {
      mimeType: media.mimeType,
      fileSize: bytes.byteLength,
      width: media.width,
      height: media.height,
      duration: media.duration ?? item.duration,
    },
  }
}
