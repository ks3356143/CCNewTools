import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { GlobalParams } from '../core/domain.ts'

/** 数据目录（08）：exe 同目录 数据/；不可写回退 %USERPROFILE%/CCNewTools/ */

let cached: string | null = null

export function dataRoot(): string {
  if (cached !== null) return cached
  const candidate = process.env.CC_DATA_DIR ?? join(process.cwd(), '数据')
  try {
    mkdirSync(candidate, { recursive: true })
    cached = candidate
  } catch {
    const home = process.env.USERPROFILE ?? process.env.HOME ?? '.'
    const fallback = join(home, 'CCNewTools')
    mkdirSync(fallback, { recursive: true })
    cached = fallback
  }
  return cached
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
