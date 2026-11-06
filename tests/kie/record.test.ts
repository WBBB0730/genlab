import { describe, expect, it } from 'vitest'

import { kieUsage, parseKieRecord } from '../../src/kie/record'

describe('parseKieRecord', () => {
  it('排队/生成中归约为 pending', () => {
    for (const state of ['waiting', 'queuing', 'generating'] as const) {
      expect(parseKieRecord({ taskId: 't', state }).state).toBe('pending')
    }
  })

  it('图片：成功时解析结果列表（无时长）', () => {
    const result = parseKieRecord({
      taskId: 't',
      state: 'success',
      resultJson: '{"resultUrls":["https://a.png","https://b.png"]}',
      creditsConsumed: 50,
    })

    expect(result).toEqual({
      state: 'succeeded',
      results: [
        { url: 'https://a.png', duration: null },
        { url: 'https://b.png', duration: null },
      ],
      failReason: null,
    })
  })

  it('失败时带上失败原因', () => {
    const result = parseKieRecord({
      taskId: 't',
      state: 'fail',
      failMsg: 'content policy',
    })

    expect(result.state).toBe('failed')
    expect(result.failReason).toBe('content policy')
  })

  it('成功但结果异常（坏 JSON / 空 URL）按失败处理，避免卡死在 pending', () => {
    expect(
      parseKieRecord({ taskId: 't', state: 'success', resultJson: '{bad' })
        .state,
    ).toBe('failed')
    expect(
      parseKieRecord({
        taskId: 't',
        state: 'success',
        resultJson: '{"resultUrls":[]}',
      }).state,
    ).toBe('failed')
  })
})

describe('parseKieRecord（音乐）', () => {
  it('成功时取 data 整组（多首），各带时长', () => {
    const result = parseKieRecord({
      taskId: 't',
      state: 'success',
      resultJson: JSON.stringify({
        code: 200,
        data: [
          { audio_url: 'https://a.mp3', duration: 188.8 },
          { audio_url: 'https://b.mp3', duration: 187.32 },
        ],
      }),
      creditsConsumed: 12,
    })

    expect(result).toEqual({
      state: 'succeeded',
      results: [
        { url: 'https://a.mp3', duration: 188.8 },
        { url: 'https://b.mp3', duration: 187.32 },
      ],
      failReason: null,
    })
  })

  it('缺音频地址的项被过滤', () => {
    const result = parseKieRecord({
      taskId: 't',
      state: 'success',
      resultJson: JSON.stringify({
        data: [
          { audio_url: 'https://a.mp3', duration: 100 },
          { audio_url: '', duration: 0 },
        ],
      }),
    })

    expect(result.results).toEqual([{ url: 'https://a.mp3', duration: 100 }])
  })

  it('成功但没有可用音频按失败处理，避免卡死在 pending', () => {
    expect(
      parseKieRecord({
        taskId: 't',
        state: 'success',
        resultJson: '{"data":[]}',
      }).state,
    ).toBe('failed')
  })
})

describe('kieUsage', () => {
  it('取 kie 扣除的积分与耗时，没给出时为 null', () => {
    expect(kieUsage({ creditsConsumed: 12, costTime: 26 })).toEqual({
      credits: 12,
      elapsed: 26,
    })
    expect(kieUsage({})).toEqual({ credits: null, elapsed: null })
  })
})
