/** 面向使用者的预期错误：只输出 message，不带堆栈。 */
export class CliError extends Error {
  override name = 'CliError'
}
