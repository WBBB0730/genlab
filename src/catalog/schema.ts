/** 模型的输入参数定义：取自 kie 的 OpenAPI 文档，用于校验与展示。 */
import { dereference } from '@apidevtools/json-schema-ref-parser'
import Ajv2020 from 'ajv/dist/2020.js'
import localizeZh from 'ajv-i18n/localize/zh/index.js'

import { CliError } from '../errors'
import { getKieModelSchema } from '../kie/client'

import { cached } from './cache'

export type JsonSchema = Record<string, unknown>

const TASK_PATH = '/api/v1/jobs/createTask'

/** OpenAPI 文档里用到的部分。 */
type OpenApiDoc = {
  paths?: Record<
    string,
    {
      post?: {
        requestBody?: {
          content?: Record<string, { schema?: { properties?: JsonSchema } }>
        }
      }
    }
  >
}

/** 模型 createTask 请求体里 input 的 JSON Schema（$ref 已展开）。 */
export async function getInputSchema(
  model: string,
  refresh = false,
): Promise<JsonSchema> {
  const doc = await cached(
    `schemas/${encodeURIComponent(model)}.json`,
    async () => {
      const openapi = await getKieModelSchema(model)

      if (!openapi) {
        throw new CliError(`Kie.ai 尚未提供模型 ${model} 的参数定义`)
      }

      return openapi
    },
    refresh,
  )
  const resolved = await dereference<OpenApiDoc>(
    structuredClone(doc) as OpenApiDoc,
    { resolve: { external: false } },
  )
  const operation = resolved.paths?.[TASK_PATH]?.post

  if (!operation) {
    throw new CliError(`模型 ${model} 不走任务接口，不支持`)
  }

  const input =
    operation.requestBody?.content?.['application/json']?.schema?.properties
      ?.input

  if (!input || typeof input !== 'object') {
    throw new CliError(`模型 ${model} 的参数定义缺少 input`)
  }

  return input as JsonSchema
}

const ajv = new Ajv2020({
  strict: false,
  allErrors: true,
  // 命令行的值都是字符串，按 schema 转成数字、布尔或数组。
  coerceTypes: 'array',
  // 文件在校验时还是 @路径，上传后才换成地址，不校验 uri 等格式。
  validateFormats: false,
})

/** 按 schema 校验并就地转换 input 的值类型；不通过时报错。 */
export function validateInput(schema: JsonSchema, input: unknown) {
  const validate = ajv.compile(schema)

  if (validate(input)) {
    return
  }

  localizeZh(validate.errors)

  const messages = (validate.errors ?? []).map((error) =>
    `${error.instancePath || 'input'} ${error.message ?? ''}`.trim(),
  )

  throw new CliError(`参数不符合模型定义：${[...new Set(messages)].join('；')}`)
}

export type ParamInfo = {
  name: string
  required: boolean
  type?: unknown
  enum?: unknown[]
  default?: unknown
  minimum?: number
  maximum?: number
  maxLength?: number
  items?: unknown
  description?: string
}

export type InputDescription = {
  params: ParamInfo[]
  /** input 为 oneOf / anyOf 时的各个分支，只能满足其中一个。 */
  variants?: Array<{ params: ParamInfo[] }>
}

const PARAM_KEYS = [
  'type',
  'enum',
  'default',
  'minimum',
  'maximum',
  'maxLength',
  'items',
  'description',
] as const

function describeObject(schema: JsonSchema): ParamInfo[] {
  const properties = (schema.properties ?? {}) as Record<string, JsonSchema>
  const required = new Set((schema.required ?? []) as string[])

  return Object.entries(properties).map(([name, property]) => {
    const info: ParamInfo = { name, required: required.has(name) }

    for (const key of PARAM_KEYS) {
      if (property[key] !== undefined) {
        Object.assign(info, { [key]: property[key] })
      }
    }

    return info
  })
}

/** 把 input 的 schema 整理成参数表（`genlab models <id>` 的输出）。 */
export function describeInput(schema: JsonSchema): InputDescription {
  const branches = (schema.oneOf ?? schema.anyOf) as JsonSchema[] | undefined
  const description: InputDescription = { params: describeObject(schema) }

  if (branches) {
    description.variants = branches.map((branch) => ({
      params: describeObject(branch),
    }))
  }

  return description
}
