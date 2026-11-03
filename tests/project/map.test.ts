import { describe, expect, it } from 'vitest'

import {
  assignProject,
  normalizeRemote,
  repoName,
  resolveProject,
} from '../../src/project/map'
import type { ProjectMap } from '../../src/project/map'

describe('normalizeRemote / repoName', () => {
  it('https、scp、ssh 形式归一为同一仓库', () => {
    const forms = [
      'https://github.com/owner/Pixel-Quest.git',
      'git@github.com:owner/pixel-quest.git',
      'ssh://git@github.com:22/owner/pixel-quest',
      'https://user@github.com/owner/pixel-quest/',
    ]

    for (const url of forms) {
      expect(normalizeRemote(url)).toBe('github.com/owner/pixel-quest')
    }
  })

  it('仓库名保留大小写', () => {
    expect(repoName('git@github.com:a/PixelQuest.git')).toBe('PixelQuest')
  })
})

describe('resolveProject', () => {
  const remote = 'https://github.com/owner/pixel-quest.git'

  it('有远程仓库：首次自动以仓库名登记', () => {
    const map: ProjectMap = { projects: [] }
    const { entry, changed } = resolveProject(map, {
      remote,
      path: '/p/game-dev',
    })

    expect(entry.name).toBe('pixel-quest')
    expect(changed).toBe(true)
    expect(map.projects).toHaveLength(1)
  })

  it('同一远程的其他副本归到同一项目，不改写位置', () => {
    const map: ProjectMap = {
      projects: [{ name: 'pixel-quest', remote, path: '/p/game-dev' }],
    }
    const { entry, changed } = resolveProject(map, {
      remote: 'git@github.com:owner/pixel-quest.git',
      path: '/p/game-dev-experiment',
    })

    expect(entry.name).toBe('pixel-quest')
    expect(changed).toBe(false)
    expect(entry.path).toBe('/p/game-dev')
  })

  it('没有远程仓库且未登记时报错', () => {
    expect(() =>
      resolveProject({ projects: [] }, { remote: null, path: '/p/x' }),
    ).toThrow('未登记')
  })

  it('中途建了远程仓库：按位置找到原条目补上远程地址，名字不变', () => {
    const map: ProjectMap = {
      projects: [{ name: '小游戏', remote: null, path: '/p/mini' }],
    }
    const { entry, changed } = resolveProject(map, { remote, path: '/p/mini' })

    expect(entry).toEqual({ name: '小游戏', remote, path: '/p/mini' })
    expect(changed).toBe(true)
  })

  it('自动登记的仓库名已被其他代码项目占用时报错', () => {
    const map: ProjectMap = {
      projects: [{ name: 'pixel-quest', remote: null, path: '/p/other' }],
    }

    expect(() => resolveProject(map, { remote, path: '/p/new' })).toThrow(
      '已被其他代码项目使用',
    )
  })
})

describe('assignProject', () => {
  it('修改已登记条目的名字，或新增条目；同名即归到同一项目', () => {
    const map: ProjectMap = {
      projects: [{ name: 'a', remote: null, path: '/p/a' }],
    }

    assignProject(map, { remote: null, path: '/p/a' }, 'b')
    assignProject(map, { remote: null, path: '/p/c' }, 'b')

    expect(map.projects).toEqual([
      { name: 'b', remote: null, path: '/p/a' },
      { name: 'b', remote: null, path: '/p/c' },
    ])
  })

  it('拒绝不合法的名字', () => {
    expect(() =>
      assignProject(
        { projects: [] },
        { remote: null, path: '/p' },
        'projects.json',
      ),
    ).toThrow()
    expect(() =>
      assignProject({ projects: [] }, { remote: null, path: '/p' }, 'a/b'),
    ).toThrow('项目名不合法')
  })
})
