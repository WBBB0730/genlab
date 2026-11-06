/** 不经过模型的库操作：导入、设为当前版本、删除版本。 */
import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { CliError } from '../errors'

import type { AssetLocation, ProjectContext } from './context'
import { inspectMedia } from './media'
import { REFERENCES_DIR, versionFileName } from './paths'
import { assetFile, findVersion, now, updateAsset } from './record'
import type { AssetRecord } from './record'
import { isLeaf, nextCurrentAfterDelete } from './rules'
import { isAssetDir } from './scan'

/** 把外部文件导入为新素材的 v1（没有生成输入，入库即就绪）。 */
export async function importAsset(
  project: ProjectContext,
  location: AssetLocation,
  file: string,
) {
  const source = path.resolve(file)
  let bytes: Buffer

  try {
    bytes = await readFile(source)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new CliError(`文件不存在：${file}`)
    }

    throw error
  }

  const media = await inspectMedia(bytes)

  await claimAssetDir(project, location)

  try {
    const fileName = versionFileName(1, media.extension)
    const timestamp = now()
    const record: AssetRecord = {
      schema: 3,
      id: randomUUID(),
      kind: media.kind,
      currentVersion: 1,
      lastVersion: 1,
      createdAt: timestamp,
      generations: [],
      versions: [
        {
          number: 1,
          state: 'ready',
          origin: 'import',
          generation: null,
          position: null,
          resultIndex: null,
          sourceVersion: null,
          taskId: null,
          failReason: null,
          file: fileName,
          mimeType: media.mimeType,
          fileSize: bytes.byteLength,
          width: media.width,
          height: media.height,
          duration: media.duration,
          importedFrom: path.basename(source),
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    }

    await copyFile(source, path.join(location.dir, fileName))
    await writeFile(
      assetFile(location.dir),
      `${JSON.stringify(record, null, 2)}\n`,
      { flag: 'wx' },
    )
  } catch (error) {
    await rm(location.dir, { recursive: true, force: true })
    throw error
  }
}

export async function setCurrentVersion(
  location: AssetLocation,
  number: number,
) {
  await updateAsset(location.dir, (record) => {
    if (findVersion(record, number).state !== 'ready') {
      throw new CliError('只能把就绪的版本设为当前版本')
    }

    record.currentVersion = number
  })
}

/**
 * 删除来源链叶子版本；素材至少保留一个版本。删除当前版本时指针回到源版本，
 * 没有则回到最新就绪版本。一次生成的版本全删完时，连同它的参考输入副本一起删。
 */
export async function deleteVersion(location: AssetLocation, number: number) {
  await updateAsset(location.dir, async (record) => {
    const version = findVersion(record, number)

    if (!isLeaf(record.versions, number)) {
      throw new CliError(`v${number} 有子版本，不能删除`)
    }

    if (record.versions.length <= 1) {
      throw new CliError('素材至少保留一个版本')
    }

    if (record.currentVersion === number) {
      const next = nextCurrentAfterDelete(
        record.versions,
        number,
        version.sourceVersion,
      )

      if (next == null) {
        throw new CliError('删除后没有可用的当前版本')
      }

      record.currentVersion = next
    }

    record.versions = record.versions.filter((item) => item.number !== number)

    if (version.file) {
      await rm(path.join(location.dir, version.file), { force: true })
    }

    const generation = version.generation

    if (
      generation != null &&
      !record.versions.some((item) => item.generation === generation)
    ) {
      record.generations = record.generations.filter(
        (item) => item.id !== generation,
      )
      await rm(path.join(location.dir, REFERENCES_DIR, String(generation)), {
        recursive: true,
        force: true,
      })
    }
  })
}

/** 占用素材文件夹：不能已存在，也不能建在另一个素材里面。 */
export async function claimAssetDir(
  project: ProjectContext,
  location: AssetLocation,
) {
  for (
    let dir = path.dirname(location.dir);
    dir.length > project.dir.length;
    dir = path.dirname(dir)
  ) {
    if (await isAssetDir(dir)) {
      throw new CliError(
        `不能在素材里新建素材：${path.relative(project.dir, dir)}`,
      )
    }
  }

  await mkdir(path.dirname(location.dir), { recursive: true })

  try {
    await mkdir(location.dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new CliError(
        (await isAssetDir(location.dir))
          ? `素材已存在：${location.path}`
          : `已存在同名文件夹：${location.path}`,
      )
    }

    throw error
  }
}
