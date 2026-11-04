import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resolveProject } from '../../src/library/context'
import { LINK_DIR, findLink, writeLink } from '../../src/project/link'

let root: string
let library: string
let code: string

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'genlab-link-'))
  library = path.join(root, 'library')
  code = path.join(root, 'code')
  await mkdir(path.join(library, 'pixel-quest'), { recursive: true })
  await mkdir(path.join(code, 'src'), { recursive: true })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('findLink / writeLink', () => {
  it('关联自带只忽略自身的 .gitignore，子目录向上找得到', async () => {
    const dir = await writeLink(code, 'pixel-quest')

    expect(await readFile(path.join(dir, '.gitignore'), 'utf8')).toMatch(
      /^\*$/m,
    )
    expect(await findLink(path.join(code, 'src'))).toEqual({
      project: 'pixel-quest',
      dir,
    })
  })

  it('取最近的关联', async () => {
    await writeLink(code, 'pixel-quest')

    const nested = await writeLink(path.join(code, 'src'), 'default')

    expect(await findLink(path.join(code, 'src'))).toEqual({
      project: 'default',
      dir: nested,
    })
  })

  it('没有关联时返回 null', async () => {
    expect(await findLink(code)).toBeNull()
  })

  it('关联文件不合法时报错', async () => {
    await mkdir(path.join(code, LINK_DIR))
    await writeFile(path.join(code, LINK_DIR, 'project.json'), '{}')

    await expect(findLink(code)).rejects.toThrow('关联文件不合法')
  })
})

describe('resolveProject', () => {
  it('未关联时报错，给出关联命令与已有项目', async () => {
    await expect(resolveProject(library, code)).rejects.toThrow(
      /genlab project link.*default、pixel-quest/,
    )
  })

  it('按关联取项目', async () => {
    await writeLink(code, 'pixel-quest')

    expect((await resolveProject(library, path.join(code, 'src'))).dir).toBe(
      path.join(library, 'pixel-quest'),
    )
  })

  it('指定的项目优先于关联', async () => {
    await writeLink(code, 'pixel-quest')

    expect((await resolveProject(library, code, 'default')).name).toBe(
      'default',
    )
  })

  it('项目不存在时报错；default 无需事先建好', async () => {
    await expect(resolveProject(library, code, 'pixel')).rejects.toThrow(
      'genlab project create pixel',
    )
    expect((await resolveProject(library, code, 'default')).dir).toBe(
      path.join(library, 'default'),
    )
  })
})
