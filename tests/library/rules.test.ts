import { describe, expect, it } from 'vitest'

import type { VersionRecord } from '../../src/library/record'
import {
  isLeaf,
  nextCurrentAfterDelete,
  nextCurrentAfterFailure,
  nextVersionNumber,
} from '../../src/library/rules'

type Lite = Pick<
  VersionRecord,
  'number' | 'state' | 'generation' | 'position' | 'sourceVersion'
>

function v(partial: Partial<Lite> & { number: number }): Lite {
  return {
    state: 'ready',
    generation: null,
    position: null,
    sourceVersion: null,
    ...partial,
  }
}

describe('nextCurrentAfterFailure', () => {
  const failed = { generation: 1, position: 0 }

  it('顺位到同一次生成里序号更靠后、未失败、版本号最小的版本', () => {
    const versions = [
      v({ number: 1, generation: 1, position: 0, state: 'failed' }),
      v({ number: 2, generation: 1, position: 1, state: 'generating' }),
      v({ number: 3, generation: 1, position: 2 }),
    ]

    expect(nextCurrentAfterFailure(versions, failed)).toBe(2)
  })

  it('靠前的也失败时继续顺位', () => {
    const versions = [
      v({ number: 1, generation: 1, position: 0, state: 'failed' }),
      v({ number: 2, generation: 1, position: 1, state: 'failed' }),
      v({ number: 3, generation: 1, position: 2 }),
    ]

    expect(nextCurrentAfterFailure(versions, failed)).toBe(3)
  })

  it('没有可用版本或只有别的生成时返回 null', () => {
    expect(
      nextCurrentAfterFailure(
        [
          v({ number: 1, generation: 1, position: 0, state: 'failed' }),
          v({ number: 2, generation: 2, position: 1 }),
        ],
        failed,
      ),
    ).toBeNull()
  })
})

describe('nextCurrentAfterDelete', () => {
  it('优先回到就绪的源版本', () => {
    const versions = [
      v({ number: 1 }),
      v({ number: 2, sourceVersion: 1 }),
      v({ number: 3 }),
    ]

    expect(nextCurrentAfterDelete(versions, 2, 1)).toBe(1)
  })

  it('源版本不可用时回到最新就绪版本，再退到最新生成中版本', () => {
    expect(
      nextCurrentAfterDelete(
        [v({ number: 1, state: 'failed' }), v({ number: 2 }), v({ number: 3 })],
        3,
        1,
      ),
    ).toBe(2)
    expect(
      nextCurrentAfterDelete(
        [v({ number: 1, state: 'generating' }), v({ number: 2 })],
        2,
        null,
      ),
    ).toBe(1)
  })

  it('没有其它可用版本时返回 null', () => {
    expect(nextCurrentAfterDelete([v({ number: 1 })], 1, null)).toBeNull()
  })
})

describe('isLeaf / nextVersionNumber', () => {
  it('有子版本的不是叶子', () => {
    const versions = [v({ number: 1 }), v({ number: 2, sourceVersion: 1 })]

    expect(isLeaf(versions, 1)).toBe(false)
    expect(isLeaf(versions, 2)).toBe(true)
  })

  it('版本号接着最大值往后编，删过的号不复用', () => {
    expect(nextVersionNumber([])).toBe(1)
    expect(nextVersionNumber([v({ number: 1 }), v({ number: 4 })])).toBe(5)
  })
})
