/** 后台收取：启动后台收取进程，以及它运行的隐藏命令 sync（见 ADR-0007）。 */
import { spawn } from 'node:child_process'

import { libraryRoot } from '../config'
import { collectLibrary } from '../generation/sync'

import { warn } from './output'

/**
 * 启动后台收取进程，不等待它结束；已有收取者时它会立即退出。沿用当前进程的 node 与
 * 启动参数，开发时经 tsx 运行同样适用。
 */
export function startBackgroundSync() {
  spawn(process.execPath, [...process.execArgv, process.argv[1], 'sync'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
    .on('error', (error) => warn(`后台收取未能启动：${error.message}`))
    .unref()
}

/** 隐藏命令 sync：作为全库唯一的收取者，收完或超过时限后退出。 */
export async function syncCommand() {
  await collectLibrary(libraryRoot())
}
