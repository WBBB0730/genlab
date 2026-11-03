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
import {
  deleteCommand,
  importCommand,
  listCommand,
  modelsCommand,
  projectCommand,
  showCommand,
  syncLibrary,
  useCommand,
} from './commands/library'
import { initCommand } from './commands/init'
import { action } from './commands/output'

/** 单次命令默认最多等待的秒数：agent 执行命令通常 2 分钟超时。 */
const DEFAULT_TIMEOUT_SECONDS = 90

function positiveInteger(value: string): number {
  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError('应为正整数')
  }

  return parsed
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value]
}

/** 先收取库里已完成的生成，再执行命令。 */
function librarySynced<TArgs extends unknown[]>(
  run: (...args: TArgs) => Promise<unknown>,
) {
  return action(async (...args: TArgs) => {
    await syncLibrary()

    return run(...args)
  })
}

const program = new Command('genlab')
  .description('AI 媒体生成（kie.ai），产物与生成记录保存在本机的库里')
  .version(packageJson.version)
  .showHelpAfterError()

function generationOptions(command: Command, requireModel: boolean) {
  return command
    .option(
      '-m, --model <id>',
      requireModel ? '模型（必填，见 genlab models）' : '模型，默认沿用',
    )
    .option(
      '-p, --param <key=value>',
      '模型参数，可重复；key:=JSON 传 JSON 值，值写 @文件 上传本机文件',
      collect,
      [],
    )
    .option('-n, --count <n>', '并列发起几个任务', positiveInteger)
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
  .command('init')
  .description('写入配置（kie.ai API Key 与库目录）')
  .option('--key <key>', 'kie.ai API Key')
  .option('--library <dir>', '库目录')
  .action(action(initCommand))

program
  .command('models')
  .description('列出 kie 模型；指定模型时输出价格与参数表')
  .argument('[id]', '模型标识')
  .option('--kind <kind>', '按类型筛选：image / video / audio')
  .option('--search <text>', '按模型标识、供应商、标题筛选')
  .option('--refresh', '忽略缓存，重新获取')
  .action(action(modelsCommand))

program
  .command('project')
  .description('查看当前代码项目对应的项目；带名字时登记或修改')
  .argument('[name]', '项目名')
  .action(action(projectCommand))

waitOptions(
  generationOptions(
    program
      .command('create')
      .description('新建素材并发起第一次生成')
      .argument('<asset>', '素材路径，如 角色/主角立绘'),
    true,
  ),
).action(librarySynced(createCommand))

waitOptions(
  generationOptions(
    program
      .command('generate')
      .description('在已有素材里发起生成')
      .argument('<asset>', '素材路径')
      .option('--from <version>', '沿用某个版本的生成输入（重新生成）'),
    false,
  ),
).action(librarySynced(generateCommand))

waitOptions(
  generationOptions(
    program
      .command('edit')
      .description(
        'AI 编辑：以某个就绪版本为源版本发起生成，参数里用 @source 引用它',
      )
      .argument('<asset>', '素材路径')
      .argument('<version>', '源版本号'),
    false,
  ),
).action(librarySynced(editCommand))

waitOptions(
  program
    .command('retry')
    .description('原地重试失败的版本')
    .argument('<asset>', '素材路径')
    .argument('<version>', '版本号'),
).action(librarySynced(retryCommand))

program
  .command('wait')
  .description('等待生成中的版本；不指定素材时等待当前项目的全部')
  .argument('[asset]', '素材路径')
  .option(
    '--timeout <seconds>',
    '最多等待的秒数',
    positiveInteger,
    DEFAULT_TIMEOUT_SECONDS,
  )
  .action(action(waitCommand))

program
  .command('import')
  .description('把外部文件导入为新素材的第一个版本')
  .argument('<asset>', '素材路径')
  .argument('<file>', '文件')
  .action(librarySynced(importCommand))

program
  .command('use')
  .description('设为当前版本')
  .argument('<asset>', '素材路径')
  .argument('<version>', '版本号')
  .action(librarySynced(useCommand))

program
  .command('delete')
  .description('删除版本（只能删没有派生版本的版本）')
  .argument('<asset>', '素材路径')
  .argument('<version>', '版本号')
  .action(librarySynced(deleteCommand))

program
  .command('show')
  .description('查看素材的全部版本、生成输入与文件路径')
  .argument('<asset>', '素材路径')
  .action(librarySynced(showCommand))

program
  .command('list')
  .description('列出当前项目的素材')
  .argument('[folder]', '只列某个文件夹')
  .option('--kind <kind>', '按类型筛选：image / video / audio')
  .action(librarySynced(listCommand))

await program.parseAsync()
