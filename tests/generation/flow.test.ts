/** 生成全流程：在临时目录里跑真实文件系统，模型目录用本地缓存，kie 网络层用替身。 */
import { access, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import lockfile from 'proper-lockfile'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createAsset,
  editVersion,
  generateInAsset,
  retryVersion,
} from '../../src/generation/submit'
import type { SubmitDeps } from '../../src/generation/submit'
import {
  collectLibrary,
  syncAssets,
  waitForVersions,
} from '../../src/generation/sync'
import type { SyncDeps } from '../../src/generation/sync'
import { DownloadRejectedError } from '../../src/kie/client'
import type * as KieClient from '../../src/kie/client'
import type { KieTaskRequest } from '../../src/kie/client'
import type { KieRecord } from '../../src/kie/record'
import { locateAsset } from '../../src/library/context'
import type { ProjectContext } from '../../src/library/context'
import { deleteVersion, importAsset } from '../../src/library/ops'
import { readAsset } from '../../src/library/record'
import { MODELS, SCHEMAS, writeCatalogCache } from '../fixtures/catalog'

// 缓存未命中或刷新目录时也不访问网络。
vi.mock('../../src/kie/client', async (importOriginal) => ({
  ...(await importOriginal<typeof KieClient>()),
  listKieModels: async () => MODELS,
  getKieModelSchema: async (model: string) => SCHEMAS[model] ?? null,
}))

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

/** 最小的 WAV：44 字节头 + 100 个静音采样。 */
function wav(): Buffer {
  const data = Buffer.alloc(200)
  const header = Buffer.alloc(44)

  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(8000, 24)
  header.writeUInt32LE(16000, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)

  return Buffer.concat([header, data])
}

let root: string
let project: ProjectContext
const originalCache = process.env.XDG_CACHE_HOME

/** kie 替身：记录上传与下单，任务结果由测试按任务编号设定。 */
function fakeKie() {
  const uploads: string[] = []
  const tasks: KieTaskRequest[] = []
  const records = new Map<string, Omit<KieRecord, 'taskId'>>()
  const files = new Map<string, Buffer>()
  const downloadErrors = new Map<string, Error>()
  const submit: SubmitDeps = {
    upload: async (file) => {
      uploads.push(file)

      return `https://tmp/${path.basename(file)}`
    },
    createTask: async (task) => {
      tasks.push(task)

      return `task-${tasks.length}`
    },
  }
  const sync: SyncDeps = {
    getRecord: async (taskId) => ({
      taskId,
      ...(records.get(taskId) ?? { state: 'generating' }),
    }),
    download: async (url) => {
      const error = downloadErrors.get(url)

      if (error) {
        throw error
      }

      return { bytes: files.get(url) ?? PNG, contentType: null }
    },
  }

  return { uploads, tasks, records, files, downloadErrors, submit, sync }
}

function success(urls: string[], credits = 3): Omit<KieRecord, 'taskId'> {
  return {
    state: 'success',
    resultJson: JSON.stringify({ resultUrls: urls }),
    creditsConsumed: credits,
  }
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'genlab-test-'))
  project = {
    root,
    name: 'p',
    dir: path.join(root, 'p'),
  }
  process.env.XDG_CACHE_HOME = path.join(root, '.cache')
  await writeCatalogCache(process.env.XDG_CACHE_HOME)
})

afterEach(async () => {
  process.env.XDG_CACHE_HOME = originalCache
  await rm(root, { recursive: true, force: true })
})

describe('create + sync', () => {
  it('并列任务：文件上传后换成地址，模板记副本路径，收取后就位', async () => {
    const kie = fakeKie()
    const reference = path.join(root, 'hero.png')
    const location = locateAsset(project, '角色/主角立绘')

    await writeFile(reference, PNG)

    const { versions } = await createAsset(
      project,
      location,
      {
        model: 'test/image',
        params: ['prompt=一只猫', `image_urls=@${reference}`],
        count: 2,
      },
      kie.submit,
    )

    expect(versions).toEqual([1, 2])
    expect(kie.tasks).toEqual([
      {
        model: 'test/image',
        input: { prompt: '一只猫', image_urls: ['https://tmp/hero.png'] },
      },
      {
        model: 'test/image',
        input: { prompt: '一只猫', image_urls: ['https://tmp/hero.png'] },
      },
    ])
    // 先上传原文件下单，成功后才复制进素材。
    expect(kie.uploads).toEqual([reference])

    kie.records.set('task-1', success(['https://r/1.png']))
    kie.records.set('task-2', success(['https://r/2.png']))
    await syncAssets([location.dir], kie.sync)

    const record = await readAsset(location.dir)

    expect(record.currentVersion).toBe(1)
    expect(record.generations[0]).toMatchObject({
      model: 'test/image',
      input: { prompt: '一只猫', image_urls: ['@references/1/hero.png'] },
      references: [
        {
          file: 'references/1/hero.png',
          name: 'hero.png',
          kind: 'image',
          origin: null,
        },
      ],
    })
    expect(record.versions[0]).toMatchObject({
      state: 'ready',
      file: 'v1.png',
      width: 1,
      credits: 3,
    })
    expect((await readdir(location.dir)).sort()).toEqual([
      'asset.json',
      'references',
      'v1.png',
      'v2.png',
    ])
  })

  it('当前版本失败时顺位到同一次生成里靠后的版本', async () => {
    const kie = fakeKie()
    const location = locateAsset(project, 'a')

    await createAsset(
      project,
      location,
      { model: 'test/image', params: ['prompt=p'], count: 2 },
      kie.submit,
    )
    kie.records.set('task-1', { state: 'fail', failMsg: '内容违规' })
    await syncAssets([location.dir], kie.sync)

    const record = await readAsset(location.dir)

    expect(record.currentVersion).toBe(2)
    expect(record.versions[0]).toMatchObject({
      state: 'failed',
      failReason: '内容违规',
    })
  })

  it('一个任务返回多个结果：多出来的追加为新版本，积分只记在序号 0', async () => {
    const kie = fakeKie()
    const location = locateAsset(project, '配乐/主菜单')

    kie.files.set('https://r/1.wav', wav())
    kie.files.set('https://r/2.wav', wav())
    await createAsset(
      project,
      location,
      {
        model: 'test/music',
        params: ['prompt=轻快', 'instrumental=true'],
      },
      kie.submit,
    )

    expect(kie.tasks[0].input.instrumental).toBe(true)

    kie.records.set('task-1', {
      state: 'success',
      resultJson: JSON.stringify({
        data: [
          { audio_url: 'https://r/1.wav', duration: 12.5 },
          { audio_url: 'https://r/2.wav', duration: 13 },
        ],
      }),
      creditsConsumed: 12,
    })
    await syncAssets([location.dir], kie.sync)

    const record = await readAsset(location.dir)

    expect(record.kind).toBe('audio')
    expect(record.versions).toMatchObject([
      {
        number: 1,
        state: 'ready',
        credits: 12,
        file: 'v1.wav',
        resultIndex: 0,
      },
      {
        number: 2,
        state: 'ready',
        credits: null,
        file: 'v2.wav',
        resultIndex: 1,
        position: 1,
        taskId: 'task-1',
      },
    ])
  })

  it('产物类型与素材不符时按失败处理', async () => {
    const kie = fakeKie()
    const location = locateAsset(project, 'v')

    await createAsset(
      project,
      location,
      { model: 'test/video', params: ['prompt=p'] },
      kie.submit,
    )
    kie.records.set('task-1', success(['https://r/x.png']))
    await syncAssets([location.dir], kie.sync)

    expect((await readAsset(location.dir)).versions[0]).toMatchObject({
      state: 'failed',
      failReason: '产物类型（image）与素材类型（video）不符',
    })
  })

  it('一个任务多个结果：前面的结果失败时，当前版本顺延到后面的结果', async () => {
    const kie = fakeKie()
    const location = locateAsset(project, 'm')

    kie.files.set('https://r/2.wav', wav())
    await createAsset(
      project,
      location,
      { model: 'test/music', params: ['prompt=p'] },
      kie.submit,
    )
    kie.records.set('task-1', {
      state: 'success',
      resultJson: JSON.stringify({
        data: [
          { audio_url: 'https://r/1.png' },
          { audio_url: 'https://r/2.wav' },
        ],
      }),
    })
    await syncAssets([location.dir], kie.sync)

    const record = await readAsset(location.dir)

    expect(record.currentVersion).toBe(2)
    expect(record.versions).toMatchObject([
      { number: 1, state: 'failed' },
      { number: 2, state: 'ready' },
    ])
  })

  it('下载被拒绝或识别不出类型时按失败处理，网络错误留到下一轮再收', async () => {
    const kie = fakeKie()
    const location = locateAsset(project, 'a')

    await createAsset(
      project,
      location,
      { model: 'test/image', params: ['prompt=p'], count: 3 },
      kie.submit,
    )
    kie.downloadErrors.set(
      'https://r/1.png',
      new DownloadRejectedError('下载产物失败：HTTP 404'),
    )
    kie.files.set('https://r/2.png', Buffer.from('not media'))
    kie.downloadErrors.set('https://r/3.png', new TypeError('fetch failed'))

    for (const task of [1, 2, 3]) {
      kie.records.set(`task-${task}`, success([`https://r/${task}.png`]))
    }

    await syncAssets([location.dir], kie.sync)

    expect((await readAsset(location.dir)).versions).toMatchObject([
      { number: 1, state: 'failed', failReason: '下载产物失败：HTTP 404' },
      { number: 2, state: 'failed', failReason: '无法识别的媒体类型：未知' },
      { number: 3, state: 'generating' },
    ])

    kie.downloadErrors.delete('https://r/3.png')
    await syncAssets([location.dir], kie.sync)

    expect((await readAsset(location.dir)).versions[2]).toMatchObject({
      state: 'ready',
      file: 'v3.png',
    })
  })

  it('下单或上传全部失败时报错，不留下素材', async () => {
    const kie = fakeKie()
    const reference = path.join(root, 'ref.png')
    const failing = (step: 'upload' | 'createTask') => ({
      ...kie.submit,
      [step]: async () => {
        throw new Error(`kie.ai 请求失败（402）：${step} 失败`)
      },
    })

    await writeFile(reference, PNG)

    for (const step of ['upload', 'createTask'] as const) {
      await expect(
        createAsset(
          project,
          locateAsset(project, 'a'),
          {
            model: 'test/image',
            params: ['prompt=p', `image_urls=@${reference}`],
          },
          failing(step),
        ),
      ).rejects.toThrow(`${step} 失败`)
      await expect(access(path.join(project.dir, 'a'))).rejects.toThrow()
    }
  })

  it('并列任务部分下单失败：只为成功的任务建版本，失败原因随结果返回', async () => {
    const kie = fakeKie()
    const location = locateAsset(project, 'a')
    let calls = 0
    const submission = await createAsset(
      project,
      location,
      { model: 'test/image', params: ['prompt=p'], count: 3 },
      {
        ...kie.submit,
        createTask: async (task) => {
          calls += 1

          if (calls === 2) {
            throw new Error('kie.ai 请求失败（429）：请求过于频繁')
          }

          return kie.submit.createTask(task)
        },
      },
    )

    expect(submission).toEqual({
      versions: [1, 2],
      errors: ['kie.ai 请求失败（429）：请求过于频繁'],
    })

    const record = await readAsset(location.dir)

    expect(record.versions.map((version) => version.taskId)).toEqual([
      'task-1',
      'task-2',
    ])
    expect(
      record.versions.every((version) => version.state === 'generating'),
    ).toBe(true)
  })

  it('多个生成同时追加到同一素材：版本号与生成编号不重复', async () => {
    const kie = fakeKie()
    const location = locateAsset(project, 'a')

    await createAsset(
      project,
      location,
      { model: 'test/image', params: ['prompt=p'] },
      kie.submit,
    )
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        generateInAsset(
          project,
          location,
          { model: 'test/image', params: [`prompt=p${index}`], count: 2 },
          kie.submit,
        ),
      ),
    )

    const record = await readAsset(location.dir)
    const numbers = record.versions.map((version) => version.number)
    const ids = record.generations.map((generation) => generation.id)

    expect(numbers).toHaveLength(17)
    expect(new Set(numbers).size).toBe(17)
    expect(new Set(ids).size).toBe(9)
    expect(new Set(record.versions.map((version) => version.taskId)).size).toBe(
      17,
    )
  })

  it('同名、嵌套、校验失败、未知模型、误用 @source 都报错且不留文件', async () => {
    const kie = fakeKie()
    const ok = { model: 'test/image', params: ['prompt=p'] }

    await createAsset(project, locateAsset(project, 'a'), ok, kie.submit)

    await expect(
      createAsset(project, locateAsset(project, 'a'), ok, kie.submit),
    ).rejects.toThrow('素材已存在')
    await expect(
      createAsset(project, locateAsset(project, 'a/b'), ok, kie.submit),
    ).rejects.toThrow('不能在素材里新建素材')

    for (const [options, message] of [
      [
        { model: 'test/image', params: ['resolution=8K'] },
        '参数不符合模型定义',
      ],
      [{ model: 'test/nope', params: ['prompt=p'] }, '未知模型'],
      [
        { model: 'test/image', params: ['prompt=p', 'image_urls=@source'] },
        '@source 只能用于 AI 编辑',
      ],
      [
        {
          model: 'test/image',
          params: ['prompt=p', 'image_urls=@/no/such.png'],
        },
        '文件不存在',
      ],
    ] as const) {
      await expect(
        createAsset(
          project,
          locateAsset(project, 'c'),
          { ...options, params: [...options.params] },
          kie.submit,
        ),
      ).rejects.toThrow(message)
    }

    await expect(access(path.join(project.dir, 'c'))).rejects.toThrow()
  })
})

describe('迭代', () => {
  async function readyImage(kie: ReturnType<typeof fakeKie>) {
    const location = locateAsset(project, 'a')

    await createAsset(
      project,
      location,
      { model: 'test/image', params: ['prompt=一只猫', 'resolution=1K'] },
      kie.submit,
    )
    kie.records.set('task-1', success(['https://r/1.png']))
    await syncAssets([location.dir], kie.sync)

    return location
  }

  it('AI 编辑：@source 换成源版本的地址，新版本记下源版本，当前版本不动', async () => {
    const kie = fakeKie()
    const location = await readyImage(kie)
    const { versions } = await editVersion(
      project,
      location,
      1,
      { params: ['prompt=改成蓝色', 'image_urls=@source'] },
      kie.submit,
    )

    expect(versions).toEqual([2])
    expect(kie.uploads.at(-1)).toBe(path.join(location.dir, 'v1.png'))
    expect(kie.tasks.at(-1)).toEqual({
      model: 'test/image',
      input: { prompt: '改成蓝色', image_urls: ['https://tmp/v1.png'] },
    })

    const record = await readAsset(location.dir)

    expect(record.currentVersion).toBe(1)
    expect(record.versions[1]).toMatchObject({
      sourceVersion: 1,
      generation: 2,
    })
    expect(record.generations[1].input.image_urls).toEqual(['@source'])
  })

  it('AI 编辑必须用 @source 引用源版本，模型类型须与素材一致', async () => {
    const kie = fakeKie()
    const location = await readyImage(kie)

    await expect(
      editVersion(project, location, 1, { params: ['prompt=改'] }, kie.submit),
    ).rejects.toThrow('@source')
    await expect(
      editVersion(
        project,
        location,
        1,
        { model: 'test/video', params: ['video_url=@source'] },
        kie.submit,
      ),
    ).rejects.toThrow('与素材类型 image 不符')
  })

  it('重新生成：沿用模型与 input，覆盖指定键，参考输入复制进新的生成', async () => {
    const kie = fakeKie()
    const location = locateAsset(project, 'r')
    const reference = path.join(root, 'ref.png')

    await writeFile(reference, PNG)
    await createAsset(
      project,
      location,
      {
        model: 'test/image',
        params: ['prompt=猫', `image_urls=@${reference}`],
      },
      kie.submit,
    )
    await generateInAsset(
      project,
      location,
      { from: 1, params: ['resolution=2K'] },
      kie.submit,
    )

    expect(kie.tasks.at(-1)).toEqual({
      model: 'test/image',
      input: {
        prompt: '猫',
        image_urls: ['https://tmp/ref.png'],
        resolution: '2K',
      },
    })
    expect((await readAsset(location.dir)).generations[1].input).toEqual({
      prompt: '猫',
      image_urls: ['@references/2/ref.png'],
      resolution: '2K',
    })
  })

  it('重试：下单成功后才回到生成中，版本号不变；下单失败时版本保持失败', async () => {
    const kie = fakeKie()
    const location = locateAsset(project, 'a')

    await createAsset(
      project,
      location,
      { model: 'test/image', params: ['prompt=p'] },
      kie.submit,
    )
    kie.records.set('task-1', { state: 'fail', failMsg: 'x' })
    await syncAssets([location.dir], kie.sync)

    await expect(
      retryVersion(location, 1, {
        ...kie.submit,
        createTask: async () => {
          throw new Error('kie.ai 请求失败（500）：服务繁忙')
        },
      }),
    ).rejects.toThrow('服务繁忙')
    expect((await readAsset(location.dir)).versions[0].state).toBe('failed')

    expect((await retryVersion(location, 1, kie.submit)).versions).toEqual([1])
    expect((await readAsset(location.dir)).versions[0]).toMatchObject({
      state: 'generating',
      taskId: 'task-2',
      failReason: null,
    })
    await expect(retryVersion(location, 1, kie.submit)).rejects.toThrow(
      '只有失败的版本可以重试',
    )
  })

  it('删除：有子版本的不能删；删光一次生成时连同参考输入一起删；删过的号不复用', async () => {
    const kie = fakeKie()
    const location = await readyImage(kie)
    const reference = path.join(root, 'ref.png')

    await writeFile(reference, PNG)
    await editVersion(
      project,
      location,
      1,
      {
        params: ['prompt=改', 'image_urls=@source', `image_urls=@${reference}`],
      },
      kie.submit,
    )
    kie.records.set('task-2', success(['https://r/2.png']))
    await syncAssets([location.dir], kie.sync)

    await expect(deleteVersion(location, 1)).rejects.toThrow('有子版本')
    await deleteVersion(location, 2)

    const record = await readAsset(location.dir)

    expect(record.generations.map((generation) => generation.id)).toEqual([1])
    expect(await readdir(path.join(location.dir, 'references'))).toEqual([])
    await expect(deleteVersion(location, 1)).rejects.toThrow('至少保留一个版本')

    const { versions } = await generateInAsset(
      project,
      location,
      { model: 'test/image', params: ['prompt=再来'] },
      kie.submit,
    )

    expect(versions).toEqual([3])
  })

  it('导入：外部文件成为就绪的 v1，库内产物作为参考输入时记下出处', async () => {
    const kie = fakeKie()
    const external = path.join(root, 'old.png')
    const imported = locateAsset(project, '导入/旧立绘')

    await writeFile(external, PNG)
    await importAsset(project, imported, external)

    expect(await readAsset(imported.dir)).toMatchObject({
      kind: 'image',
      currentVersion: 1,
      versions: [{ state: 'ready', origin: 'import', importedFrom: 'old.png' }],
    })

    await createAsset(
      project,
      locateAsset(project, '新立绘'),
      {
        model: 'test/image',
        params: [
          'prompt=p',
          `image_urls=@${path.join(imported.dir, 'v1.png')}`,
        ],
      },
      kie.submit,
    )

    expect(
      (await readAsset(path.join(project.dir, '新立绘'))).generations[0]
        .references[0].origin,
    ).toEqual({ asset: 'p/导入/旧立绘', version: 1 })
  })
})

describe('收取者', () => {
  /** 模拟另一个进程正在收取：占住全库的收取者锁。 */
  function holdCollector() {
    return lockfile.lock(root, { lockfilePath: path.join(root, '.sync.lock') })
  }

  async function pendingAsset(kie: ReturnType<typeof fakeKie>, name: string) {
    const location = locateAsset(project, name)

    await createAsset(
      project,
      location,
      { model: 'test/image', params: ['prompt=p'] },
      kie.submit,
    )

    return location
  }

  it('后台收取：收下全库已完成的生成，没有生成中的版本后退出', async () => {
    const kie = fakeKie()
    const a = await pendingAsset(kie, 'a')
    const b = await pendingAsset(kie, '文件夹/b')

    kie.records.set('task-1', success(['https://r/1.png']))
    kie.records.set('task-2', success(['https://r/2.png']))
    await collectLibrary(root, kie.sync)

    expect((await readAsset(a.dir)).versions[0].state).toBe('ready')
    expect((await readAsset(b.dir)).versions[0].state).toBe('ready')
  })

  it('已有收取者时后台收取立即退出，不查询 kie', async () => {
    const kie = fakeKie()
    const location = await pendingAsset(kie, 'a')
    const getRecord = vi.fn(kie.sync.getRecord)

    kie.records.set('task-1', success(['https://r/1.png']))

    const release = await holdCollector()

    try {
      await collectLibrary(root, { ...kie.sync, getRecord })
    } finally {
      await release()
    }

    expect(getRecord).not.toHaveBeenCalled()
    expect((await readAsset(location.dir)).versions[0].state).toBe('generating')
  })

  it('等待只读记录：没收下时到时返回未完成，收下后返回完成', async () => {
    const kie = fakeKie()
    const location = await pendingAsset(kie, 'a')
    const targets = [{ dir: location.dir, versions: [1] }]

    kie.records.set('task-1', success(['https://r/1.png']))

    expect(await waitForVersions(targets, 1)).toBe(false)
    await syncAssets([location.dir], kie.sync)
    expect(await waitForVersions(targets, 1_000)).toBe(true)
  })
})
