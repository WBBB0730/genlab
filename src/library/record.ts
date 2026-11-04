/**
 * 素材记录文件：素材、生成、版本的全部信息，是素材的唯一真相（见 ADR-0002）。
 * 写入一律原子替换；修改走 updateAsset，同一素材的读改写互斥。
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import lockfile from 'proper-lockfile'
import writeFileAtomic from 'write-file-atomic'

import { CliError } from '../errors'
import type { KieTaskRequest } from '../kie/client'

import type { MediaKind } from './media'
import { ASSET_FILE } from './paths'

export type VersionState = 'generating' | 'ready' | 'failed'

export type ReferenceRecord = {
  /** 素材文件夹内的相对路径，如 references/2/hero.png。 */
  file: string
  /** 原文件名。 */
  name: string
  kind: MediaKind
  /** 参考输入来自库内某个版本时的出处（素材相对库根的路径 + 版本号）。 */
  origin: { asset: string; version: number } | null
}

export type GenerationRecord = {
  /** 素材内连续编号。 */
  id: number
  /** kie 的模型标识。 */
  model: string
  /**
   * 发给 kie 的 input 模板：文件以 `@references/<生成编号>/<文件名>` 表示，源版本以
   * `@source` 表示，下单时换成上传后的临时地址；`@@` 开头表示字面量 `@`。
   */
  input: Record<string, unknown>
  references: ReferenceRecord[]
  /** AI 编辑 / 重新生成所基于的源版本。 */
  sourceVersion: number | null
  createdAt: string
}

export type VersionRecord = {
  number: number
  state: VersionState
  origin: 'generation' | 'import'
  generation: number | null
  /** 在所属生成里的序号（从 0 起）。 */
  position: number | null
  /** 取所属 kie 任务结果数组的第几项（Suno 一次多首，其余恒为 0）。 */
  resultIndex: number | null
  sourceVersion: number | null
  taskId: string | null
  /** 发给 kie 的原始 createTask 请求体。 */
  kieRequest: KieTaskRequest | null
  /** kie recordInfo 返回的原始任务记录（终态时写入）。 */
  kieRecord: unknown
  failReason: string | null
  /** kie 扣除的积分；一个任务多个版本时只记在结果序号 0 上。 */
  credits: number | null
  /** 产物文件名（素材文件夹内）。 */
  file: string | null
  mimeType: string | null
  fileSize: number | null
  width: number | null
  height: number | null
  /** 时长（秒）。 */
  duration: number | null
  /** 导入版本的原文件名。 */
  importedFrom: string | null
  createdAt: string
  updatedAt: string
}

export type AssetRecord = {
  schema: 2
  id: string
  kind: MediaKind
  currentVersion: number
  /** 分配过的最大版本号：新版本接着它往后编，删过的号不复用。 */
  lastVersion: number
  createdAt: string
  generations: GenerationRecord[]
  versions: VersionRecord[]
}

/** 第 1 版记录格式：没有 lastVersion。 */
type AssetRecordV1 = Omit<AssetRecord, 'schema' | 'lastVersion'> & {
  schema: 1
}

/** 第 1 版记录没记分配过的最大号，只能取现有版本的最大号；下次写入时存为第 2 版。 */
function upgradeV1({ schema: _schema, ...record }: AssetRecordV1): AssetRecord {
  return {
    schema: 2,
    ...record,
    lastVersion: Math.max(
      0,
      ...record.versions.map((version) => version.number),
    ),
  }
}

export function assetFile(assetDir: string): string {
  return path.join(assetDir, ASSET_FILE)
}

export async function readAsset(assetDir: string): Promise<AssetRecord> {
  let text: string

  try {
    text = await readFile(assetFile(assetDir), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new CliError(`素材不存在：${assetDir}`)
    }

    throw error
  }

  const record = JSON.parse(text) as AssetRecord | AssetRecordV1

  if (record.schema === 1) {
    return upgradeV1(record)
  }

  if (record.schema !== 2) {
    throw new CliError(`无法识别的素材记录版本：${assetFile(assetDir)}`)
  }

  return record
}

export async function writeAsset(assetDir: string, record: AssetRecord) {
  await writeFileAtomic(
    assetFile(assetDir),
    `${JSON.stringify(record, null, 2)}\n`,
  )
}

/**
 * 互斥地读改写一个素材：mutate 就地修改 record 并返回附带结果；返回前写回。
 * 多个 agent 同时操作同一素材时，后到的等待前一个写完。
 */
export async function updateAsset<T>(
  assetDir: string,
  mutate: (record: AssetRecord) => T | Promise<T>,
): Promise<T> {
  const release = await lockfile.lock(assetFile(assetDir), {
    retries: { retries: 50, minTimeout: 20, maxTimeout: 200 },
    stale: 30_000,
  })

  try {
    const record = await readAsset(assetDir)
    const result = await mutate(record)

    await writeAsset(assetDir, record)

    return result
  } finally {
    await release()
  }
}

export function findVersion(
  record: AssetRecord,
  version: number,
): VersionRecord {
  const found = record.versions.find((item) => item.number === version)

  if (!found) {
    throw new CliError(`版本不存在：v${version}`)
  }

  return found
}

export function findGeneration(
  record: AssetRecord,
  id: number | null,
): GenerationRecord | undefined {
  return id == null
    ? undefined
    : record.generations.find((generation) => generation.id === id)
}

export function now(): string {
  return new Date().toISOString()
}
