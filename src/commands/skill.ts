/** genlab skill：经 skills（npx skills）全局安装或卸载本机 agent 的 genlab skill。 */
import spawn from 'nano-spawn'

import { CliError } from '../errors'

/** 固定 skills 的版本，安装行为不随它的新版本变化。 */
const SKILLS_CLI = 'skills@1.7.6'
const SKILL_SOURCE = 'WBBB0730/genlab'
const SKILL_NAME = 'genlab'

function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY)
}

/**
 * 终端里由 skills 询问装到 / 卸载哪些 agent；非终端时加 --yes，作用于检测到的全部
 * agent。skills 的输出写 stderr，stdout 只留给命令结果。
 */
async function runSkills(args: string[], interactive: boolean) {
  await spawn(
    'npx',
    ['-y', SKILLS_CLI, ...args, '--global', ...(interactive ? [] : ['--yes'])],
    { stdin: 'inherit', stdout: process.stderr, stderr: 'inherit' },
  )
}

export async function installSkill(interactive: boolean) {
  try {
    await runSkills(['add', SKILL_SOURCE, '--skill', SKILL_NAME], interactive)
  } catch (error) {
    throw new CliError(
      `安装 skill 失败：可手动运行 npx skills add ${SKILL_SOURCE} -g -s ${SKILL_NAME}`,
      { cause: error },
    )
  }
}

export async function skillAddCommand() {
  await installSkill(isInteractive())

  return { installed: SKILL_NAME }
}

/** 来源有变化时才更新，沿用安装时选的 agent。 */
export async function skillUpdateCommand() {
  try {
    await runSkills(['update', SKILL_NAME], isInteractive())
  } catch (error) {
    throw new CliError(
      `更新 skill 失败：可手动运行 npx skills update ${SKILL_NAME} -g`,
      { cause: error },
    )
  }

  return { updated: SKILL_NAME }
}

export async function skillRemoveCommand() {
  try {
    await runSkills(['remove', SKILL_NAME], isInteractive())
  } catch (error) {
    throw new CliError(
      `卸载 skill 失败：可手动运行 npx skills remove ${SKILL_NAME} -g`,
      { cause: error },
    )
  }

  return { removed: SKILL_NAME }
}
