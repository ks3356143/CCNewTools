import { readdirSync, statSync, appendFileSync, mkdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { dataRoot } from './store.ts'

/** 滚动日志（08）：数据/日志/app-YYYYMMDD.log，保留最近 5 份 */

export function appendLog(message: string): void {
  try {
    const dir = join(dataRoot(), '日志')
    mkdirSync(dir, { recursive: true })
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const file = join(dir, 'app-' + day + '.log')
    const line = new Date().toLocaleTimeString('zh-CN', { hour12: false }) + ' ' + message + '\n'
    appendFileSync(file, line, 'utf8')
    prune(dir)
  } catch {
    // 日志失败不影响主流程
  }
}

function prune(dir: string): void {
  const files = readdirSync(dir).filter(f => f.startsWith('app-') && f.endsWith('.log')).sort()
  while (files.length > 5) {
    const victim = files.shift()!
    try {
      unlinkSync(join(dir, victim))
    } catch {
      void statSync(dir) // no-op：删除失败忽略
    }
  }
}
