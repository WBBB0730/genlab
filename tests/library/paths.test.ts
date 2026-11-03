import { describe, expect, it } from 'vitest'

import {
  parseAssetPath,
  parseVersionArg,
  validateName,
  versionFromFileName,
} from '../../src/library/paths'

describe('validateName', () => {
  it('接受普通名字', () => {
    expect(validateName('主角立绘 v2', '素材名')).toBe('主角立绘 v2')
  })

  it('拒绝空名、隐藏名、分隔符与首尾空白', () => {
    for (const name of [
      '',
      ' ',
      '.hidden',
      'a/b',
      'a\\b',
      'a:b',
      ' a',
      'a\n',
    ]) {
      expect(() => validateName(name, '素材名')).toThrow('素材名不合法')
    }
  })
})

describe('parseAssetPath', () => {
  it('按 / 拆成各级名字', () => {
    expect(parseAssetPath('角色/主角/立绘')).toEqual(['角色', '主角', '立绘'])
  })

  it('拒绝空段与 .. ', () => {
    expect(() => parseAssetPath('a//b')).toThrow('不合法')
    expect(() => parseAssetPath('/a')).toThrow('不合法')
    expect(() => parseAssetPath('../a')).toThrow('不合法')
  })
})

describe('parseVersionArg / versionFromFileName', () => {
  it('接受 3 与 v3', () => {
    expect(parseVersionArg('3')).toBe(3)
    expect(parseVersionArg('V12')).toBe(12)
    expect(() => parseVersionArg('0')).toThrow('不合法')
    expect(() => parseVersionArg('v1.5')).toThrow('不合法')
  })

  it('从产物文件名解析版本号', () => {
    expect(versionFromFileName('v3.png')).toBe(3)
    expect(versionFromFileName('hero.png')).toBeNull()
  })
})
