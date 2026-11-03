/** 命令输出：结果 JSON 写 stdout，警告与错误 JSON 写 stderr。 */
export function warn(message: string) {
  process.stderr.write(`${JSON.stringify({ warning: message })}\n`)
}

/** 包装命令动作：输出结果，出错时输出错误并以退出码 1 结束。 */
export function action<TArgs extends unknown[]>(
  run: (...args: TArgs) => Promise<unknown>,
): (...args: TArgs) => Promise<void> {
  return async (...args) => {
    try {
      const result = await run(...args)

      // 终端里缩进便于阅读；被 agent 等程序读取时输出紧凑的单行 JSON。
      const indent = process.stdout.isTTY ? 2 : undefined

      process.stdout.write(`${JSON.stringify(result, null, indent)}\n`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      process.stderr.write(`${JSON.stringify({ error: message })}\n`)
      process.exitCode = 1
    }
  }
}
