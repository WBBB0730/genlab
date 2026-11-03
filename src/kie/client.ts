import { openAsBlob } from 'node:fs'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

import { requireEnv } from '../config'
import { CliError } from '../errors'

import type { KieRecord } from './record'

const API_BASE_URL = 'https://api.kie.ai'
const UPLOAD_BASE_URL = 'https://kieai.redpandaai.co'

/** 接口请求超时；上传与下载按文件大小放宽。 */
const REQUEST_TIMEOUT_MS = 60_000
const TRANSFER_TIMEOUT_MS = 10 * 60_000

/** 模型目录（models、schema、price、success-rate）共用每秒 1 次的额度。 */
const DISCOVERY_INTERVAL_MS = 1100

/** createTask 的请求体（不传回调地址：状态由工具自己轮询求证）。 */
export type KieTaskRequest = {
  model: string
  input: Record<string, unknown>
}

export async function createKieTask(task: KieTaskRequest): Promise<string> {
  const body = await kieFetch<{ data?: { taskId?: string } }>(
    `${API_BASE_URL}/api/v1/jobs/createTask`,
    { method: 'POST', body: JSON.stringify(task) },
  )

  if (!body.data?.taskId) {
    throw new CliError('kie.ai 未返回 taskId')
  }

  return body.data.taskId
}

/** 模型目录的一项（GET /api/v1/models）。 */
export type KieModel = {
  model: string
  title: string | null
  provider: string | null
  taskType: string[]
  description: string | null
  pricingDesc: string | null
}

export async function listKieModels(): Promise<KieModel[]> {
  const body = await discoveryFetch<{ data?: { models?: KieModel[] } }>(
    `${API_BASE_URL}/api/v1/models`,
  )

  return body.data?.models ?? []
}

/** 模型的 OpenAPI 文档；kie 尚未同步文档时为 null。模型标识里的斜杠不编码。 */
export async function getKieModelSchema(
  model: string,
): Promise<Record<string, unknown> | null> {
  const body = await discoveryFetch<{
    data?: { openapi?: Record<string, unknown> | null }
  }>(`${API_BASE_URL}/api/v1/models/${model}/schema`)

  return body.data?.openapi ?? null
}

/** 账户余额；apiKey 缺省时用配置里的 Key。 */
export async function getKieCredits(apiKey?: string): Promise<number> {
  const body = await kieFetch<{ data?: number }>(
    `${API_BASE_URL}/api/v1/chat/credit`,
    undefined,
    REQUEST_TIMEOUT_MS,
    apiKey,
  )

  return body.data ?? 0
}

/** 任务的原始记录（完整保存进素材记录，解析见 parseKieRecord）。 */
export async function getKieRecord(taskId: string): Promise<KieRecord> {
  const body = await kieFetch<{ data?: KieRecord }>(
    `${API_BASE_URL}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
  )

  if (!body.data) {
    throw new CliError('kie.ai 未返回任务记录')
  }

  return body.data
}

/**
 * 把本机文件上传给 kie，换取模型可访问的临时地址（24 小时后删除，不保存）。
 * 不指定文件名：kie 随机命名，避免同名覆盖。
 */
export async function uploadKieFile(filePath: string): Promise<string> {
  const form = new FormData()

  form.append('file', await openAsBlob(filePath), path.basename(filePath))
  form.append('uploadPath', 'genlab')

  const body = await kieFetch<{ data?: { downloadUrl?: string } }>(
    `${UPLOAD_BASE_URL}/api/file-stream-upload`,
    { method: 'POST', body: form },
    TRANSFER_TIMEOUT_MS,
  )

  if (!body.data?.downloadUrl) {
    throw new CliError('kie.ai 上传未返回地址')
  }

  return body.data.downloadUrl
}

/** 下载产物原文件。 */
export async function downloadFile(
  url: string,
): Promise<{ bytes: Uint8Array; contentType: string | null }> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(TRANSFER_TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new CliError(`下载产物失败：HTTP ${response.status}`)
  }

  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType: response.headers.get('content-type'),
  }
}

let lastDiscoveryAt = 0

/** 目录类接口：同一进程内保持请求间隔，被限流时等一个间隔再试一次。 */
async function discoveryFetch<T>(url: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const wait = lastDiscoveryAt + DISCOVERY_INTERVAL_MS - Date.now()

    if (wait > 0) {
      await sleep(wait)
    }

    lastDiscoveryAt = Date.now()

    try {
      return await kieFetch<T>(url)
    } catch (error) {
      if (attempt > 0 || !(error instanceof KieRateLimitError)) {
        throw error
      }
    }
  }
}

class KieRateLimitError extends CliError {}

async function kieFetch<T>(
  url: string,
  init?: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS,
  apiKey = requireEnv('KIE_API_KEY'),
): Promise<T> {
  const headers = new Headers(init?.headers)

  headers.set('Authorization', `Bearer ${apiKey}`)

  // multipart 由 fetch 自带 boundary，只有 JSON 请求体才声明类型。
  if (typeof init?.body === 'string') {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(url, {
    ...init,
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  })
  let body: T & { code?: number; msg?: string }

  try {
    body = (await response.json()) as typeof body
  } catch {
    throw new CliError(`kie.ai 请求失败：HTTP ${response.status}`)
  }

  // kie 的业务错误以 HTTP 200 + body.code 返回。
  if (!response.ok || body.code !== 200) {
    const ErrorType = body.code === 429 ? KieRateLimitError : CliError

    throw new ErrorType(
      `kie.ai 请求失败（${body.code ?? response.status}）：${body.msg || response.statusText}`,
    )
  }

  return body
}
