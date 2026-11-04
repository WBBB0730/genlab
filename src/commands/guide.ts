/** genlab guide：输出给 agent 的完整用法。 */
import { readFile } from 'node:fs/promises'

import type { Command } from 'commander'

/** 手写的使用说明，后附由命令定义生成的命令参考，与已安装的版本一致。 */
export async function guideCommand(program: Command, file: URL) {
  const guide = await readFile(file, 'utf8')
  const reference = program.commands
    .map((command) => command.helpInformation())
    .join('\n')

  process.stdout.write(
    `${guide}\n## 命令参考\n\n\`\`\`text\n${reference}\`\`\`\n`,
  )
}
