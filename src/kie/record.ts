/** kie.ai 任务记录的解析（纯函数，与网络层分离以便测试）。 */

/** kie.ai recordInfo 响应的 data 部分，字段按需取用。 */
export type KieRecord = {
  taskId: string
  state: 'waiting' | 'queuing' | 'generating' | 'success' | 'fail'
  resultJson?: string | null
  failMsg?: string | null
  creditsConsumed?: number | null
}

/** 任务结果数组的一项：产物 URL 与可选时长（秒，kie 提供时才有）。 */
export type KieResultItem = {
  url: string
  duration: number | null
}

export type KieTaskResult = {
  state: 'pending' | 'succeeded' | 'failed'
  /** 成功时的产物列表，按生成顺序排列（多数模型一项，Suno 多项）。 */
  results: KieResultItem[]
  failReason: string | null
  credits: number | null
}

/**
 * 把 kie.ai 的五态任务记录归约成三态。结果在 resultJson 里：图片、视频、语音为
 * `{ resultUrls: [...] }`；Suno（音乐、音效）为 `{ data: [{ audio_url, duration }, ...] }`。
 */
export function parseKieRecord(record: KieRecord): KieTaskResult {
  const credits = record.creditsConsumed ?? null

  if (record.state === 'fail') {
    return {
      state: 'failed',
      results: [],
      failReason: record.failMsg || '生成失败',
      credits,
    }
  }

  if (record.state !== 'success') {
    return { state: 'pending', results: [], failReason: null, credits }
  }

  const results = parseResults(record.resultJson)

  if (results.length === 0) {
    return {
      state: 'failed',
      results: [],
      failReason: '生成结果为空',
      credits,
    }
  }

  return { state: 'succeeded', results, failReason: null, credits }
}

/** resultJson → 产物列表；格式异常或为空返回空数组（由调用方按失败处理，避免卡在 pending）。 */
function parseResults(resultJson: string | null | undefined): KieResultItem[] {
  let parsed: { resultUrls?: unknown; data?: unknown }

  try {
    parsed = JSON.parse(resultJson ?? '{}') as typeof parsed
  } catch {
    return []
  }

  if (Array.isArray(parsed.resultUrls)) {
    return parsed.resultUrls
      .filter((url): url is string => typeof url === 'string' && url !== '')
      .map((url) => ({ url, duration: null }))
  }

  if (Array.isArray(parsed.data)) {
    // Suno：缺音频地址的项被过滤。
    return (parsed.data as Array<{ audio_url?: unknown; duration?: unknown }>)
      .filter(
        (track): track is { audio_url: string; duration?: unknown } =>
          typeof track?.audio_url === 'string' && track.audio_url !== '',
      )
      .map((track) => ({
        url: track.audio_url,
        duration: typeof track.duration === 'number' ? track.duration : null,
      }))
  }

  return []
}
