/**
 * 命令行参数 → kie 的 input。`-p key=value` 的值是字符串，`-p key:=<JSON>` 的值按 JSON
 * 解析，同一个键重复出现时合并成数组。字符串值以 `@` 开头表示文件：`@<路径>` 是本机
 * 文件，`@source` 是 AI 编辑的源版本，`@@` 开头表示字面量 `@`。
 */
import { CliError } from '../errors'

export const SOURCE_TOKEN = '@source'

export function parseInputArgs(args: string[]): Record<string, unknown> {
  const input: Record<string, unknown> = {}

  for (const arg of args) {
    const match = /^([^=:]+)(:?=)([\s\S]*)$/.exec(arg)

    if (!match) {
      throw new CliError(`参数格式应为 key=value 或 key:=JSON：${arg}`)
    }

    const [, key, operator, raw] = match as unknown as [
      string,
      string,
      string,
      string,
    ]
    let value: unknown = raw

    if (operator === ':=') {
      try {
        value = JSON.parse(raw)
      } catch {
        throw new CliError(`参数 ${key} 的 JSON 不合法：${raw}`)
      }
    }

    if (key in input) {
      const previous = input[key]

      input[key] = Array.isArray(previous)
        ? [...(previous as unknown[]), value]
        : [previous, value]
    } else {
      input[key] = value
    }
  }

  return input
}

/** 对 value 里的每个字符串调用 fn，返回替换后的新值（对象与数组递归）。 */
export function mapStrings(
  value: unknown,
  fn: (text: string) => unknown,
): unknown {
  if (typeof value === 'string') {
    return fn(value)
  }

  if (Array.isArray(value)) {
    return value.map((item) => mapStrings(item, fn))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, mapStrings(item, fn)]),
    )
  }

  return value
}

/** 是文件引用（`@source` 或 `@<路径>`）而不是字面量。 */
export function isFileToken(text: string): boolean {
  return text.startsWith('@') && !text.startsWith('@@') && text.length > 1
}

/** input 里引用的全部本机文件路径（不含 `@source`），按出现顺序去重。 */
export function filePaths(input: unknown): string[] {
  const paths: string[] = []

  mapStrings(input, (text) => {
    if (isFileToken(text) && text !== SOURCE_TOKEN) {
      paths.push(text.slice(1))
    }

    return text
  })

  return [...new Set(paths)]
}

export function usesSource(input: unknown): boolean {
  let found = false

  mapStrings(input, (text) => {
    found ||= text === SOURCE_TOKEN

    return text
  })

  return found
}

/** 把文件引用换成 resolve 的结果，`@@` 还原为字面量 `@`。 */
export function resolveTokens(
  input: Record<string, unknown>,
  resolve: (token: string) => string,
): Record<string, unknown> {
  return mapStrings(input, (text) => {
    if (text.startsWith('@@')) {
      return text.slice(1)
    }

    return isFileToken(text) ? resolve(text) : text
  }) as Record<string, unknown>
}
