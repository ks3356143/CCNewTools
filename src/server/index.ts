import { handle } from './app.ts'
import { migrateLegacyEdits } from './projects.ts'
import { appendLog } from './log.ts'

// 启动时把旧 数据/编辑记录/*.json 迁入项目目录（09）；失败只记日志不拦启动
try {
  migrateLegacyEdits()
} catch (e) {
  appendLog('ERROR 迁移旧编辑记录失败：' + (e instanceof Error ? e.message : String(e)))
}

const BASE_PORT = 8300
const MAX_TRIES = 10

function openBrowser(url: string) {
  if (process.platform === 'win32') {
    Bun.spawn(['cmd', '/c', 'start', '', url], { stdout: 'ignore', stderr: 'ignore' })
  } else {
    Bun.spawn(['xdg-open', url], { stdout: 'ignore', stderr: 'ignore', stdin: 'ignore' })
  }
}

let started: Bun.Server | null = null
for (let port = BASE_PORT; port < BASE_PORT + MAX_TRIES; port++) {
  try {
    started = Bun.serve({ port, fetch: handle })
    const url = `http://127.0.0.1:${port}`
    console.log('测试文档生成工具 v0.1.0')
    console.log(`服务已启动：${url}`)
    console.log('关闭此窗口即退出。')
    if (process.argv.includes('--open')) openBrowser(url)
    break
  } catch {
    if (port === BASE_PORT + MAX_TRIES - 1) {
      console.error(`端口 ${BASE_PORT}~${BASE_PORT + MAX_TRIES - 1} 均被占用，无法启动`)
      process.exit(1)
    }
  }
}

if (!started) process.exit(1)

process.on('SIGINT', () => {
  started?.stop(true)
  process.exit(0)
})
