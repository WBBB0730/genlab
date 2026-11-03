import { describe, expect, it } from 'vitest'

import {
  filePaths,
  parseInputArgs,
  resolveTokens,
  usesSource,
} from '../../src/catalog/input'

describe('parseInputArgs', () => {
  it('key=value 为字符串，key:=JSON 按 JSON 解析', () => {
    expect(
      parseInputArgs([
        'prompt=a=b',
        'duration:=5',
        'audio:=false',
        'speakers:=[{"voice":"x"}]',
      ]),
    ).toEqual({
      prompt: 'a=b',
      duration: 5,
      audio: false,
      speakers: [{ voice: 'x' }],
    })
  })

  it('同一个键重复出现时合并成数组', () => {
    expect(
      parseInputArgs([
        'image_urls=@a.png',
        'image_urls=@b.png',
        'image_urls=@c.png',
      ]),
    ).toEqual({ image_urls: ['@a.png', '@b.png', '@c.png'] })
  })

  it('格式或 JSON 不合法时报错', () => {
    expect(() => parseInputArgs(['prompt'])).toThrow('key=value')
    expect(() => parseInputArgs(['=x'])).toThrow('key=value')
    expect(() => parseInputArgs(['n:={'])).toThrow('JSON 不合法')
  })
})

describe('文件引用', () => {
  const input = {
    prompt: '@@handle 的头像',
    first_frame_url: '@/tmp/a.png',
    reference_image_urls: ['@/tmp/b.png', '@/tmp/a.png'],
    video_url: '@source',
    nested: [{ url: '@/tmp/c.png' }],
  }

  it('收集本机文件路径（去重，不含 @source 与 @@ 字面量）', () => {
    expect(filePaths(input)).toEqual(['/tmp/a.png', '/tmp/b.png', '/tmp/c.png'])
    expect(usesSource(input)).toBe(true)
    expect(usesSource({ prompt: 'x' })).toBe(false)
  })

  it('替换文件引用，@@ 还原为字面量 @', () => {
    expect(
      resolveTokens(input, (token) => `https://u/${token.slice(1)}`),
    ).toEqual({
      prompt: '@handle 的头像',
      first_frame_url: 'https://u//tmp/a.png',
      reference_image_urls: ['https://u//tmp/b.png', 'https://u//tmp/a.png'],
      video_url: 'https://u/source',
      nested: [{ url: 'https://u//tmp/c.png' }],
    })
  })
})
