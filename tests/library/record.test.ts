import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readAsset } from '../../src/library/record'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'genlab-record-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('readAsset', () => {
  it('第 1 版记录升级为第 2 版：分配过的最大号取现有版本的最大号', async () => {
    await writeFile(
      path.join(dir, 'asset.json'),
      JSON.stringify({
        schema: 1,
        id: 'a',
        kind: 'image',
        currentVersion: 1,
        createdAt: '',
        generations: [],
        versions: [{ number: 1 }, { number: 4 }],
      }),
    )

    expect(await readAsset(dir)).toMatchObject({ schema: 2, lastVersion: 4 })
  })

  it('无法识别的记录版本报错', async () => {
    await writeFile(path.join(dir, 'asset.json'), JSON.stringify({ schema: 9 }))

    await expect(readAsset(dir)).rejects.toThrow('无法识别的素材记录版本')
  })
})
