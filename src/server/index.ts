import { handle } from './app.ts'
import { VERSION } from './app.ts'
import { migrateLegacyEdits } from './projects.ts'
import { appendLog } from './log.ts'
import { dataRoot, dataRootFallbackNotice, exeDirNotice } from './store.ts'
import { dirname } from 'node:path'
import { dlopen } from 'bun:ffi'

// Windows 控制台默认 GBK(936) 代码页，UTF-8 输出的中文横幅会乱码（地址行是 ASCII 不受影响）；
// 切到 65001 后中文可读。stdout 被重定向（无控制台）或 FFI 不可用时静默跳过，不影响启动。
if (process.platform === 'win32') {
  try {
    // 注意：Bun 1.4 的 dlopen 第二参就是符号表本身（无 symbols 包装层）
    const kernel32 = dlopen('kernel32.dll', {
      SetConsoleOutputCP: { args: ['u32'], returns: 'bool' }
    })
    kernel32.symbols.SetConsoleOutputCP(65001)
  } catch { /* 静默兜底 */ }
}

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

let started: ReturnType<typeof Bun.serve> | null = null
for (let port = BASE_PORT; port < BASE_PORT + MAX_TRIES; port++) {
  try {
    // 仅监听本机回环：涉密内网环境下避免同网段其他机器访问到本服务（Bun 默认 0.0.0.0 全网卡）
    started = Bun.serve({ port, hostname: '127.0.0.1', fetch: handle })
    const url = `http://127.0.0.1:${port}`
    console.log(`测试文档生成工具 v${VERSION}`)
    // 运行位置风险提示（v1.1.3）：压缩包里直接双击（落临时目录）/网络共享目录运行时警示
    const dirNotice = exeDirNotice(dirname(process.execPath))
    if (dirNotice) console.log(dirNotice)
    console.log(`服务已启动：${url}`)
    // 数据目录随横幅亮出（v1.1.2）：用户找数据/备份换机不再靠猜；回退场景同步提示（08：提示一次）
    console.log(`数据目录：${dataRoot()}`)
    const notice = dataRootFallbackNotice()
    if (notice) console.log(`⚠ ${notice}`)
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
