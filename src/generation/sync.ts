/**
 * 向 kie 求证并收取产物：按任务分组，一次 recordInfo 推进同一任务的全部版本。
 * 产物先下载到素材文件夹里的临时文件，加锁确认版本仍在等待该任务后再就位，
 * 因此多个进程同时收取也只会落一份（幂等）。
 *
 * 收取只在后台收取进程里进行，全库同一时间只有一个（见 ADR-0007）：每条素材命令结束时、
 * 以及开始等待时启动它，收完或超过时限即退出；等待只读记录。
 */
import { rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { setTimeout as sleep } from 'node:timers/promises'

import lockfile from 'proper-lockfile'

import {
  DownloadRejectedError,
  downloadFile,
  getKieRecord,
} from '../kie/client'
import { parseKieRecord } from '../kie/record'
import type { KieRecord, KieResultItem } from '../kie/record'
import { UnsupportedMediaError, inspectMedia } from '../library/media'
import type { MediaInfo } from '../library/media'
import { versionFileName } from '../library/paths'
import { now, readAsset, updateAsset } from '../library/record'
import { allocateVersion } from '../library/rules'
import type { AssetRecord, VersionRecord } from '../library/record'
import { findAssetDirs } from '../library/scan'

import { failVersion, fulfillVersion, settleTask } from './state'
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

const POLL_INTERVAL_MS = 5_000

/** 收取者锁：库根目录下的点目录，扫描库时跳过。 */
const COLLECTOR_LOCK = '.sync.lock'

/** 后台收取进程最多运行的时长；超过后退出，下一条命令再启动。 */
const COLLECTOR_MAX_MS = 30 * 60_000

/**
 * 以全库唯一收取者的身份执行 run；已有收取者时不执行。锁失效（如系统休眠）时可能
 * 短暂出现两个收取者，收取是幂等的，不影响结果。
 */
async function asCollector(root: string, run: () => Promise<void>) {
  let release: () => Promise<void>

  try {
    release = await lockfile.lock(root, {
      lockfilePath: path.join(root, COLLECTOR_LOCK),
      onCompromised: () => {},
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOCKED') {
      return
    }

    throw error
  }

  try {
    await run()
  } finally {
    // 锁失效后已视为释放，再释放会报 ERELEASED。
    await release().catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'ERELEASED') {
        throw error
      }
    })
  }
}

/** 仍有生成中版本的素材；读不出记录的跳过。 */
async function pendingDirs(dirs: string[]): Promise<string[]> {
  const pending = await Promise.all(
    dirs.map(async (dir) => {
      try {
        const record = await readAsset(dir)

        return record.versions.some((version) => version.state === 'generating')
      } catch {
        return false
      }
    }),
  )

  return dirs.filter((_, index) => pending[index])
}

/**
 * 后台收取：作为全库唯一的收取者轮询，每轮重新扫描库（包括期间新发起的生成），
 * 全部收完或超过时限后返回；已有收取者时立即返回。
 */
export async function collectLibrary(
  root: string,
  deps: SyncDeps = defaultDeps,
) {
  const pending = async () => pendingDirs(await findAssetDirs(root))

  await asCollector(root, async () => {
    const deadline = Date.now() + COLLECTOR_MAX_MS

    for (;;) {
      const dirs = await pending()

      if (dirs.length === 0) {
        return
      }

      await syncAssets(dirs, deps)

      if (
        (await pending()).length === 0 ||
        Date.now() + POLL_INTERVAL_MS > deadline
      ) {
        return
      }

      await sleep(POLL_INTERVAL_MS)
    }
  })
}

/** 收取一批素材里所有生成中的版本；返回过程中遇到的问题（不中断其余任务）。 */
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
 * 轮询记录，直到目标版本全部到达终态或超时；返回是否全部完成。只读记录，收取由后台
 * 收取进程负责。targets 的 versions 为空表示该素材里所有生成中的版本。
 */
export async function waitForVersions(
  targets: Array<{ dir: string; versions?: number[] }>,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs

  for (;;) {
    if (await allSettled(targets)) {
      return true
    }

    if (Date.now() + POLL_INTERVAL_MS > deadline) {
      return false
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
  // 生成中的版本都带任务编号：下单成功后才写进记录。
  const taskIds = [
    ...new Set(
      record.versions
        .filter((version) => version.state === 'generating')
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
        `${path.basename(dir)} 任务 ${taskId} 收取失败：${(error as Error).message}`,
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

  if (result.state === 'failed') {
    await updateAsset(dir, (latest) => {
      settleTask(latest, taskId, kieRecord)

      for (const member of members) {
        if (stillWaiting(latest, member.number, taskId)) {
          failVersion(latest, member.number, result.failReason ?? '生成失败')
        }
      }
    })

    return
  }

  // 先把全部产物下载到临时文件，锁内再按结果序号落定：已有版本壳的就位，多出来的结果
  // 追加为同一次生成的新版本，缺结果的版本壳标失败。先给每个结果对上版本再逐个落定，
  // 前面的结果失败时当前版本才能顺延到后面的结果。
  const downloads = await Promise.all(
    result.results.map((item, index) =>
      downloadProduct(dir, record, taskId, index, item, deps),
    ),
  )

  await updateAsset(dir, async (latest) => {
    settleTask(latest, taskId, kieRecord)

    const waiting = members.filter((member) =>
      stillWaiting(latest, member.number, taskId),
    )
    const lead = waiting[0]
    const targets = downloads.map(
      (_, index) =>
        latest.versions.find(
          (version) =>
            version.taskId === taskId && version.resultIndex === index,
        ) ?? (lead ? appendResultVersion(latest, lead, index) : null),
    )

    for (const [index, product] of downloads.entries()) {
      const target = targets[index]

      if (!target || target.state !== 'generating') {
        if (!('error' in product)) {
          await rm(product.temp, { force: true })
        }

        continue
      }

      if ('error' in product) {
        failVersion(latest, target.number, product.error)
      } else {
        const file = versionFileName(target.number, product.extension)

        await rename(product.temp, path.join(dir, file))
        fulfillVersion(latest, target.number, { ...product.info, file })
      }
    }

    for (const member of waiting) {
      if (stillWaiting(latest, member.number, taskId)) {
        failVersion(latest, member.number, '生成结果为空')
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
    number: allocateVersion(record),
    state: 'generating',
    position: Math.max(...positions) + 1,
    resultIndex,
    createdAt: now(),
    updatedAt: now(),
  }

  record.versions.push(version)

  return version
}

/**
 * 下载并识别产物。拿不到的产物（下载被拒绝、识别不出类型或与素材类型不符）返回错误，
 * 按失败处理；其余错误（如网络）直接抛出，下一轮再收。
 */
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
  let bytes: Uint8Array
  let media: MediaInfo

  try {
    const file = await deps.download(item.url)

    bytes = file.bytes
    media = await inspectMedia(bytes, file.contentType)
  } catch (error) {
    if (
      error instanceof DownloadRejectedError ||
      error instanceof UnsupportedMediaError
    ) {
      return { error: error.message }
    }

    throw error
  }

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
