import { describe, expect, it } from 'vitest'

import type { ProjectContext } from '../src/library/context'
import type { AssetRecord, VersionRecord } from '../src/library/record'
import { presentAsset } from '../src/present'

function version(
  number: number,
  taskId: string | null,
  resultIndex: number,
): VersionRecord {
  return {
    number,
    state: 'ready',
    origin: 'generation',
    generation: 1,
    position: number - 1,
    resultIndex,
    sourceVersion: null,
    taskId,
    kieRequest: null,
    kieRecord: null,
    failReason: null,
    credits: null,
    file: `v${number}.mp3`,
    mimeType: 'audio/mpeg',
    fileSize: 1,
    width: null,
    height: null,
    duration: null,
    importedFrom: null,
    createdAt: '',
    updatedAt: '',
  }
}

const project: ProjectContext = {
  root: '/lib',
  name: 'p',
  dir: '/lib/p',
  codeProject: { remote: null, path: '/code' },
}

const record: AssetRecord = {
  schema: 1,
  id: 'a',
  kind: 'audio',
  currentVersion: 1,
  createdAt: '',
  generations: [],
  versions: [
    version(1, 't1', 0),
    version(2, 't1', 1),
    version(3, 't2', 0),
    version(4, null, 0),
  ],
}

describe('presentAsset', () => {
  it('指定版本时连同同一任务追加出的版本一起列出', () => {
    const listed = presentAsset(
      project,
      { path: 'a', dir: '/lib/p/a' },
      record,
      [1, 4],
    ).versions.map((item) => item.version)

    expect(listed).toEqual([1, 2, 4])
  })

  it('不指定版本时列出全部', () => {
    expect(
      presentAsset(project, { path: 'a', dir: '/lib/p/a' }, record).versions,
    ).toHaveLength(4)
  })

  it('版本带上所属生成的模型', () => {
    const withGeneration: AssetRecord = {
      ...record,
      generations: [
        {
          id: 1,
          model: 'suno/v6',
          input: {},
          references: [],
          sourceVersion: null,
          createdAt: '',
        },
      ],
    }

    expect(
      presentAsset(project, { path: 'a', dir: '/lib/p/a' }, withGeneration)
        .versions[0]?.model,
    ).toBe('suno/v6')
  })
})
