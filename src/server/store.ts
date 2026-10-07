import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import type { GlobalParams } from '../core/domain.ts'

/** 数据目录（08）：编译形态锚定 exe 同目录 数据/；不可写回退 %USERPROFILE%/CCNewTools/ 并提示 */

let cached: string | null = null
let fallbackNotice: string | null = null

/** 编译形态判定（2026-10-07 探测实证）：开发态 process.execPath 是 bun 运行时（bun.exe / bunx…），
 *  编译态指向 exe 自身且与启动时 cwd 无关。数据目录因此必须锚 exe 位置而非 cwd——右键"以管理员
 *  身份运行"（cwd=System32）、快捷方式改过"起始位置"、终端他处启动都会让 cwd ≠ exe 目录，
 *  v1.1.1 及之前按 cwd 锚定会把涉密大纲数据散落到工作目录甚至用户目录。 */
function isCompiledRun(): boolean {
  return !/^bun/i.test(basename(process.execPath))
}

function primaryDataDir(): string {
  if (process.env.CC_DATA_DIR) return process.env.CC_DATA_DIR
  return isCompiledRun() ? join(dirname(process.execPath), '数据') : join(process.cwd(), '数据')
}

export function dataRoot(): string {
  if (cached !== null) return cached
  const candidate = primaryDataDir()
  try {
    mkdirSync(candidate, { recursive: true })
    cached = candidate
  } catch {
    const home = process.env.USERPROFILE ?? process.env.HOME ?? '.'
    const fallback = join(home, 'CCNewTools')
    mkdirSync(fallback, { recursive: true })
    cached = fallback
    fallbackNotice = `exe 旁目录不可写（${candidate}），数据已改存到 ${fallback}`
  }
  return cached
}

/** 启动横幅用：数据目录发生过回退时的提示（08：提示一次，v1.1.2 前是静默回退） */
export function dataRootFallbackNotice(): string | null {
  return fallbackNotice
}

/** exe 所在目录的运行位置风险提示（2026-10-07 内网复查，v1.1.3）：
 *  ①临时目录——同事在压缩包里直接双击 exe，Windows 解到 %TEMP% 运行，数据跟着落临时目录、
 *    被系统清理后"全部消失"；②网络共享（UNC）——多人共用同一 数据/，项目与设置互相覆盖。
 *  位置正常返回 null；tmpRoot 参数仅供测试注入。 */
export function exeDirNotice(exeDir: string, tmpRoot: string = tmpdir()): string | null {
  if (exeDir.startsWith('\\\\'))
    return '注意：程序位于网络共享目录，数据将保存在共享目录里，多人同时使用会互相覆盖。建议拷贝到本机文件夹运行。'
  const norm = (p: string): string => p.replace(/[/\\]+/g, '\\').toLowerCase()
  const dir = norm(exeDir)
  const tmp = norm(tmpRoot)
  if (dir === tmp || dir.startsWith(tmp + '\\'))
    return '⚠ 当前从临时目录运行（可能是在压缩包里直接双击）：数据会保存在临时目录，清理后丢失。请先把 exe 解压到普通文件夹再运行。'
  return null
}

export interface Settings {
  params: GlobalParams
  theme: string
}

export function loadSettings(): Settings {
  try {
    const raw = readFileSync(join(dataRoot(), '设置.json'), 'utf8')
    const s = JSON.parse(raw) as Settings
    if (s && s.params) return s
  } catch {
    // 无设置文件或损坏：用默认值（06：损坏按无记录处理）
  }
  return { params: null as unknown as GlobalParams, theme: 'light' }
}

export function saveSettings(s: Settings): void {
  writeFileSync(join(dataRoot(), '设置.json'), JSON.stringify(s), 'utf8')
}

/** 测试注入：绕过进程内缓存（bun test 单进程跑多个测试文件） */
export function setDataRootForTests(dir: string): void {
  cached = dir
}
