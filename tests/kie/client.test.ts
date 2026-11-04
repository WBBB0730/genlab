import { afterEach, describe, expect, it, vi } from 'vitest'

import { CliError } from '../../src/errors'
import { DownloadRejectedError, downloadFile } from '../../src/kie/client'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('downloadFile', () => {
  it('4xx（超时与限流除外）为下载被拒绝，其余失败留到下一轮再试', async () => {
    const cases = [
      [403, true],
      [404, true],
      [408, false],
      [429, false],
      [503, false],
    ] as const

    for (const [status, rejected] of cases) {
      vi.stubGlobal('fetch', async () => new Response(null, { status }))

      const error = await downloadFile('https://r/x.png').catch(
        (reason: unknown) => reason,
      )

      expect(error).toBeInstanceOf(CliError)
      expect(error instanceof DownloadRejectedError).toBe(rejected)
    }
  })
})
