/** 测试用的 kie 模型目录与 schema：写进临时缓存目录，不访问网络。 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { KieModel } from '../../src/kie/client'

export function openapi(input: Record<string, unknown>, components = {}) {
  return {
    openapi: '3.1.0',
    paths: {
      '/api/v1/jobs/createTask': {
        post: {
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['model', 'input'],
                  properties: { model: { type: 'string' }, input },
                },
              },
            },
          },
        },
      },
    },
    components,
  }
}

export const MODELS: KieModel[] = [
  {
    model: 'test/image',
    title: 'Test Image',
    provider: 'Test',
    taskType: ['Text to Image', 'Image to Image'],
    description: null,
    pricingDesc: '1 credit',
  },
  {
    model: 'test/music',
    title: 'Test Music',
    provider: 'Test',
    taskType: ['Text to Music'],
    description: null,
    pricingDesc: '12 credits',
  },
  {
    model: 'test/video',
    title: 'Test Video',
    provider: 'Test',
    taskType: ['Text to Video', 'Video to Video'],
    description: null,
    pricingDesc: '16 credits',
  },
]

export const SCHEMAS: Record<string, unknown> = {
  'test/image': openapi({
    type: 'object',
    required: ['prompt'],
    properties: {
      prompt: { type: 'string' },
      image_urls: { type: 'array', items: { type: 'string', format: 'uri' } },
      resolution: { type: 'string', enum: ['1K', '2K'] },
    },
  }),
  'test/music': openapi({
    type: 'object',
    required: ['prompt'],
    properties: {
      prompt: { type: 'string' },
      upload_url: { type: 'string' },
      instrumental: { type: 'boolean' },
    },
  }),
  'test/video': openapi(
    {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        video_url: { type: 'string' },
        duration: { type: 'integer', minimum: 2, maximum: 10 },
        nsfw_checker: {
          $ref: '#/components/schemas/shared%20flags/properties/nsfw',
        },
      },
    },
    {
      schemas: {
        'shared flags': {
          type: 'object',
          properties: { nsfw: { type: 'boolean' } },
        },
      },
    },
  ),
}

/** 把目录与 schema 写成新鲜的缓存（XDG_CACHE_HOME 指向 cacheHome）。 */
export async function writeCatalogCache(cacheHome: string) {
  const dir = path.join(cacheHome, 'genhub')
  const entry = (value: unknown) =>
    JSON.stringify({ fetchedAt: Date.now(), value })

  await mkdir(path.join(dir, 'schemas'), { recursive: true })
  await writeFile(path.join(dir, 'models.json'), entry(MODELS))

  for (const [model, doc] of Object.entries(SCHEMAS)) {
    await writeFile(
      path.join(dir, 'schemas', `${encodeURIComponent(model)}.json`),
      entry(doc),
    )
  }
}
