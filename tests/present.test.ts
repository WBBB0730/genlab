import { describe, expect, it } from 'vitest'

import type { ProjectContext } from '../src/library/context'
import type {
  AssetRecord,
  TaskRecord,
  VersionRecord,
} from '../src/library/record'
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
    failReason: null,
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

function task(id: string, credits: number | null): TaskRecord {
  return {
    id,
    kieRequest: { model: 'suno/v6', input: {} },
    kieRecord: null,
    credits,
    elapsed: credits == null ? null : 26,
    createdAt: '',
  }
}

const project: ProjectContext = {
  root: '/lib',
  name: 'p',
  dir: '/lib/p',
}

const record: AssetRecord = {
  schema: 3,
  id: 'a',
  kind: 'audio',
  currentVersion: 1,
  lastVersion: 4,
  createdAt: '',
  generations: [
    {
      id: 1,
      model: 'suno/v6',
      input: {},
      references: [],
      sourceVersion: null,
      // t0 是重试前的任务，已没有版本指向它。
      tasks: [task('t0', 2), task('t1', 12), task('t2', null)],
      createdAt: '',
    },
  ],
  versions: [
    version(1, 't1', 0),
    version(2, 't1', 1),
    version(3, 't2', 0),
    version(4, null, 0),
  ],
}

describe('presentAsset', () => {
  it('指定版本时连同同一任务追加出的版本一起列出，只列它们所属的任务', () => {
    const presented = presentAsset(
      project,
      { path: 'a', dir: '/lib/p/a' },
      record,
      [1, 4],
    )

    expect(presented.versions.map((item) => item.version)).toEqual([1, 2, 4])
    expect(presented.tasks).toEqual([
      { taskId: 't1', credits: 12, elapsed: 26 },
    ])
  })

  it('不指定版本时列出全部版本与全部任务，含重试前的任务', () => {
    const presented = presentAsset(
      project,
      { path: 'a', dir: '/lib/p/a' },
      record,
    )

    expect(presented.versions).toHaveLength(4)
    expect(presented.tasks).toEqual([
      { taskId: 't0', credits: 2, elapsed: 26 },
      { taskId: 't1', credits: 12, elapsed: 26 },
      { taskId: 't2' },
    ])
  })

  it('版本带上所属生成的模型与任务编号', () => {
    expect(
      presentAsset(project, { path: 'a', dir: '/lib/p/a' }, record).versions[0],
    ).toMatchObject({ model: 'suno/v6', taskId: 't1' })
  })
})
