import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  describeInput,
  getInputSchema,
  validateInput,
} from '../../src/catalog/schema'
import { writeCatalogCache } from '../fixtures/catalog'

let cacheHome: string
const original = process.env.XDG_CACHE_HOME

beforeEach(async () => {
  cacheHome = await mkdtemp(path.join(tmpdir(), 'genlab-cache-'))
  process.env.XDG_CACHE_HOME = cacheHome
  await writeCatalogCache(cacheHome)
})

afterEach(async () => {
  process.env.XDG_CACHE_HOME = original
  await rm(cacheHome, { recursive: true, force: true })
})

describe('getInputSchema', () => {
  it('取出 input 并展开 $ref（键名含空格）', async () => {
    const schema = await getInputSchema('test/video')

    expect(
      describeInput(schema).params.find((p) => p.name === 'nsfw_checker'),
    ).toEqual({ name: 'nsfw_checker', required: false, type: 'boolean' })
  })
})

describe('validateInput', () => {
  it('按 schema 转换值类型：数字、布尔、单值转数组', async () => {
    const input: Record<string, unknown> = {
      duration: '5',
      nsfw_checker: 'true',
    }

    validateInput(await getInputSchema('test/video'), input)
    expect(input).toEqual({ duration: 5, nsfw_checker: true })

    const image: Record<string, unknown> = {
      prompt: 'p',
      image_urls: '@/tmp/a.png',
    }

    validateInput(await getInputSchema('test/image'), image)
    expect(image.image_urls).toEqual(['@/tmp/a.png'])
  })

  it('不通过时给出中文原因', async () => {
    const schema = await getInputSchema('test/image')

    const video = await getInputSchema('test/video')

    expect(() => validateInput(schema, { resolution: '8K' })).toThrow(
      /必需属性 prompt.*预设定的枚举值/,
    )
    expect(() => validateInput(video, { duration: '30' })).toThrow('/duration')
  })
})

describe('describeInput', () => {
  it('整理参数表，oneOf 时列出各个分支', () => {
    expect(
      describeInput({
        required: ['prompt'],
        properties: {
          prompt: { type: 'string', description: '提示词' },
          size: { type: 'string', enum: ['s', 'm'], default: 's' },
        },
        oneOf: [
          {
            required: ['task_id'],
            properties: { task_id: { type: 'string' } },
          },
          { required: ['url'], properties: { url: { type: 'string' } } },
        ],
      }),
    ).toEqual({
      params: [
        {
          name: 'prompt',
          required: true,
          type: 'string',
          description: '提示词',
        },
        {
          name: 'size',
          required: false,
          type: 'string',
          enum: ['s', 'm'],
          default: 's',
        },
      ],
      variants: [
        { params: [{ name: 'task_id', required: true, type: 'string' }] },
        { params: [{ name: 'url', required: true, type: 'string' }] },
      ],
    })
  })
})
