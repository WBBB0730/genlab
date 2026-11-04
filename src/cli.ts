#!/usr/bin/env node
import { Command, InvalidArgumentError } from 'commander'

import packageJson from '../package.json' with { type: 'json' }

import {
  createCommand,
  editCommand,
  generateCommand,
  retryCommand,
  waitCommand,
} from './commands/generation'
import { guideCommand } from './commands/guide'
import {
  deleteCommand,
  importCommand,
  listCommand,
  modelsCommand,
  showCommand,
  useCommand,
} from './commands/library'
import { initCommand } from './commands/init'
import { action } from './commands/output'
import {
  projectCommand,
  projectCreateCommand,
  projectLinkCommand,
} from './commands/project'
import {
  skillAddCommand,
  skillRemoveCommand,
  skillUpdateCommand,
} from './commands/skill'
import { startBackgroundSync, syncCommand } from './commands/sync'

/**
 * 单次命令默认最多等待的秒数：Claude Code 默认在前台等一条命令 2 分钟，超过转入后台，
 * 留在这之内 agent 能直接拿到结果。
 */
const DEFAULT_TIMEOUT_SECONDS = 90

/** 使用说明与入口同目录：打包时由 tsdown 复制到 dist。 */
const GUIDE_FILE = new URL('./guide.md', import.meta.url)

function positiveInteger(value: string): number {
  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError('应为正整数')
  }

  return parsed
}

/** 可重复的选项：不设默认值，帮助里不显示 (default: [])。 */
function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value]
}

/** 执行命令，结束后在后台收取库里未完成的生成，不等待（见 ADR-0007）。 */
function withBackgroundSync<TArgs extends unknown[]>(
  run: (...args: TArgs) => Promise<unknown>,
) {
  return action(async (...args: TArgs) => {
    try {
      return await run(...args)
    } finally {
      startBackgroundSync()
    }
  })
}

// 帮助选项与 help 命令的文案由子命令继承，须在添加子命令前设置。
const program = new Command('genlab')
  .description(
    '用 kie.ai 的模型生成图片、视频、音频，产物与生成记录保存在本机的库里。完整用法：genlab guide',
  )
  .version(packageJson.version, '-V, --version', '显示版本号')
  .helpOption('-h, --help', '显示帮助')
  .helpCommand('help [command]', '显示命令的帮助')
  .showHelpAfterError()

function generationOptions(command: Command, modelDescription: string) {
  return command
    .option('-m, --model <id>', modelDescription)
    .option(
      '-p, --param <key=value>',
      '模型参数，可重复；key:=JSON 传 JSON 值，@<路径> 上传本机文件',
      collect,
    )
    .option('-n, --count <n>', '并列任务数（1–10，默认 1）', positiveInteger)
}

function projectOption(command: Command) {
  return command.option(
    '--project <name>',
    '本次使用的项目，不改动当前目录的关联',
  )
}

function waitOptions(command: Command) {
  return command
    .option('--no-wait', '提交后立即返回，不等待结果')
    .option(
      '--timeout <seconds>',
      '最多等待的秒数',
      positiveInteger,
      DEFAULT_TIMEOUT_SECONDS,
    )
}

program
  .command('guide')
  .description('输出完整用法：概念、流程、参数写法、规则与命令参考')
  .action(() => guideCommand(program, GUIDE_FILE))

program
  .command('init')
  .description('写入配置（kie.ai API Key 与库目录），可顺带安装 skill')
  .option('--key <key>', 'kie.ai API Key')
  .option('--library <dir>', '库目录（绝对路径，可用 ~ 开头）')
  .option('--skill', '安装 skill，不再询问')
  .option('--no-skill', '不安装 skill')
  .action(action(initCommand))

const skill = program
  .command('skill')
  .description('安装、更新或卸载 genlab skill，让 agent 能发现 genlab')

skill
  .command('add', { isDefault: true })
  .description('安装 skill（默认）')
  .action(action(skillAddCommand))

skill
  .command('update')
  .description('更新 skill，沿用安装时选的 agent')
  .action(action(skillUpdateCommand))

skill
  .command('remove')
  .description('卸载 skill')
  .action(action(skillRemoveCommand))

program
  .command('models')
  .description('列出 kie 模型；指定模型时输出价格与参数表')
  .argument('[id]', '模型标识')
  .option('--kind <kind>', '按类型筛选：image / video / audio')
  .option('--search <text>', '按模型标识、供应商、名称筛选')
  .option('--refresh', '忽略缓存，重新获取')
  .action(action(modelsCommand))

const project = program
  .command('project')
  .description('查看当前目录关联的项目与库里的全部项目')
  .action(action(projectCommand))

project
  .command('create')
  .description('新建项目')
  .argument('<name>', '项目名')
  .action(action(projectCreateCommand))

project
  .command('link')
  .description('把当前目录关联到项目；不属于任何代码项目时用 default')
  .argument('<name>', '项目名')
  .action(action(projectLinkCommand))

projectOption(
  waitOptions(
    generationOptions(
      program
        .command('create')
        .description('新建素材并发起第一次生成')
        .argument('<asset>', '素材路径：[文件夹/]素材名，如 characters/hero'),
      '模型标识（必填，见 genlab models）',
    ),
  ),
).action(withBackgroundSync(createCommand))

projectOption(
  waitOptions(
    generationOptions(
      program
        .command('generate')
        .description('在已有素材里发起生成')
        .argument('<asset>', '素材路径')
        .option('--from <version>', '沿用某个版本的生成输入（重新生成）'),
      '模型标识；用 --from 时默认沿用原模型',
    ),
  ),
).action(withBackgroundSync(generateCommand))

projectOption(
  waitOptions(
    generationOptions(
      program
        .command('edit')
        .description(
          'AI 编辑：以某个就绪版本为源版本发起生成，参数里用 @source 引用它',
        )
        .argument('<asset>', '素材路径')
        .argument('<version>', '源版本号'),
      '模型标识，默认沿用源版本的模型',
    ),
  ),
).action(withBackgroundSync(editCommand))

projectOption(
  waitOptions(
    program
      .command('retry')
      .description('原地重试失败的版本')
      .argument('<asset>', '素材路径')
      .argument('<version>', '版本号，如 3 或 v3'),
  ),
).action(withBackgroundSync(retryCommand))

projectOption(
  program
    .command('wait')
    .description('等待生成中的版本；不指定素材时等待当前项目的全部')
    .argument('[asset]', '素材路径')
    .option(
      '--timeout <seconds>',
      '最多等待的秒数',
      positiveInteger,
      DEFAULT_TIMEOUT_SECONDS,
    ),
).action(withBackgroundSync(waitCommand))

projectOption(
  program
    .command('import')
    .description('把外部文件导入为新素材的第一个版本')
    .argument('<asset>', '素材路径')
    .argument('<file>', '要导入的文件'),
).action(withBackgroundSync(importCommand))

projectOption(
  program
    .command('use')
    .description('把就绪的版本设为当前版本')
    .argument('<asset>', '素材路径')
    .argument('<version>', '版本号，如 3 或 v3'),
).action(withBackgroundSync(useCommand))

projectOption(
  program
    .command('delete')
    .description('删除没有子版本的版本')
    .argument('<asset>', '素材路径')
    .argument('<version>', '版本号，如 3 或 v3'),
).action(withBackgroundSync(deleteCommand))

projectOption(
  program
    .command('show')
    .description('查看素材的全部版本、生成输入与文件路径')
    .argument('<asset>', '素材路径'),
).action(withBackgroundSync(showCommand))

projectOption(
  program
    .command('list')
    .description('列出当前项目的素材')
    .argument('[folder]', '只列这个文件夹下的素材')
    .option('--kind <kind>', '按类型筛选：image / video / audio'),
).action(withBackgroundSync(listCommand))

program
  .command('sync', { hidden: true })
  .description('后台收取库里未完成的生成（由其他命令自动启动）')
  .action(syncCommand)

await program.parseAsync()
