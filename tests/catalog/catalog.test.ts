import { describe, expect, it } from 'vitest'

import { kindForModel } from '../../src/catalog/catalog'
import type { KieModel } from '../../src/kie/client'

function model(taskType: string[]): KieModel {
  return {
    model: 'm',
    title: null,
    provider: null,
    taskType,
    description: null,
    pricingDesc: null,
  }
}

describe('kindForModel', () => {
  it('按任务类型推出产物的素材类型', () => {
    expect(kindForModel(model(['Text to Image', 'Image to Image']))).toBe(
      'image',
    )
    expect(kindForModel(model(['Image to Video', 'Video to Video']))).toBe(
      'video',
    )
    expect(kindForModel(model(['Lip Sync']))).toBe('video')
    expect(kindForModel(model(['Text to Music']))).toBe('audio')
    expect(kindForModel(model(['Text to Speech']))).toBe('audio')
  })

  it('对话模型返回 null', () => {
    expect(kindForModel(model(['Chat']))).toBeNull()
  })

  it('类型矛盾或未知时报错', () => {
    expect(() =>
      kindForModel(model(['Image to Video', 'Image to Image'])),
    ).toThrow('产物类型不明确')
    expect(() => kindForModel(model(['Text to 3D']))).toThrow('无法识别')
    expect(() => kindForModel(model([]))).toThrow('产物类型不明确')
  })
})
