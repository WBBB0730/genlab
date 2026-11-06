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
  it('第 1 版记录升级为当前格式：分配过的最大号取现有版本的最大号', async () => {
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

    expect(await readAsset(dir)).toMatchObject({ schema: 3, lastVersion: 4 })
  })

  it('第 2 版记录升级为第 3 版：版本上的任务数据归并为所属生成的任务', async () => {
    const request = { model: 'suno/v6', input: { prompt: 'p' } }
    const kieRecord = {
      taskId: 't1',
      state: 'success',
      creditsConsumed: 12,
      costTime: 26,
    }
    const version = (
      number: number,
      fields: Record<string, unknown>,
    ): Record<string, unknown> => ({
      number,
      generation: 1,
      createdAt: `c${number}`,
      ...fields,
    })

    await writeFile(
      path.join(dir, 'asset.json'),
      JSON.stringify({
        schema: 2,
        id: 'a',
        kind: 'audio',
        currentVersion: 1,
        lastVersion: 4,
        createdAt: '',
        generations: [{ id: 1 }, { id: 2 }],
        versions: [
          version(1, {
            taskId: 't1',
            kieRequest: request,
            kieRecord,
            credits: 12,
          }),
          version(2, {
            taskId: 't1',
            kieRequest: request,
            kieRecord,
            credits: null,
          }),
          version(3, {
            taskId: 't2',
            kieRequest: request,
            kieRecord: null,
            credits: null,
          }),
          {
            number: 4,
            generation: null,
            taskId: null,
            kieRequest: null,
            kieRecord: null,
            credits: null,
          },
        ],
      }),
    )

    const record = await readAsset(dir)

    expect(record.schema).toBe(3)
    expect(record.generations[0].tasks).toEqual([
      {
        id: 't1',
        kieRequest: request,
        kieRecord,
        credits: 12,
        elapsed: 26,
        createdAt: 'c1',
      },
      {
        id: 't2',
        kieRequest: request,
        kieRecord: null,
        credits: null,
        elapsed: null,
        createdAt: 'c3',
      },
    ])
    expect(record.generations[1].tasks).toEqual([])
    expect(record.versions[1]).toEqual({
      number: 2,
      generation: 1,
      createdAt: 'c2',
      taskId: 't1',
    })
  })

  it('无法识别的记录版本报错', async () => {
    await writeFile(path.join(dir, 'asset.json'), JSON.stringify({ schema: 9 }))

    await expect(readAsset(dir)).rejects.toThrow('无法识别的素材记录版本')
  })
})
