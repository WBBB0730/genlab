/** genlab guide：输出给 agent 的完整用法。 */
import { readFile } from 'node:fs/promises'

import type { Command } from 'commander'

/** 手写的使用说明，后附由命令定义生成的命令参考，与已安装的版本一致。 */
export async function guideCommand(program: Command, file: URL) {
  const guide = await readFile(file, 'utf8')
  // 与帮助输出一致：不含隐藏命令，也不含 commander 自带的 help 命令。
  const reference = program
    .createHelp()
    .visibleCommands(program)
    .filter((command) => program.commands.includes(command))
    .map((command) => command.helpInformation())
    .join('\n')

  process.stdout.write(
    `${guide}\n## 命令参考\n\n\`\`\`text\n${reference}\`\`\`\n`,
  )
}
