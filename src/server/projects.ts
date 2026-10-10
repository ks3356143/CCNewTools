import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EDIT_STATE_VERSION, type EditState } from '../core/persistence.ts'
import { dataRoot } from './store.ts'
import { appendLog } from './log.ts'

/** 项目制本地数据管理（09）：一份大纲一个项目，哈希寻址，可查看/打开/删除 */

export interface ProjectStats {
  items: number
  cases: number
  steps: number
}

export interface ProjectProgress {
  reviewed: number
  suspects: number
}

export interface ProjectMeta {
  id: string
  name: string
  hash: string
  addedAt: string
  updatedAt: string
  lastGeneratedAt?: string
  hasSource: boolean
  /** 源文档类型（12-追踪文档工具 v2）：outline=大纲（默认，旧数据无此字段） / record=测试记录 / returnSpec=回归说明 */
  sourceType?: 'outline' | 'record' | 'returnSpec'
  /** 记录/回归说明项目配对的大纲项目 hash（打开项目时自动重配） */
  alignHash?: string
  stats: ProjectStats | null
  progress: ProjectProgress | null
}

export interface ProjectFile {
  meta: ProjectMeta
  edits: EditState | null
}

const ID_RE = /^[0-9a-f]{12}$/

export function projectsRoot(): string {
  return join(dataRoot(), '项目')
}

export function projectId(hash: string): string {
  return hash.slice(0, 12)
}

/** id 来自请求参数，严格校验防路径穿越 */
function assertId(id: string): void {
  if (!ID_RE.test(id)) throw new Error('非法项目 ID')
}

function projectDir(id: string): string {
  assertId(id)
  return join(projectsRoot(), id)
}

function fileOf(id: string): string {
  return join(projectDir(id), '项目.json')
}

/** 源副本文件名按类型区分（旧 outline 项目沿用 大纲.docx，历史数据零迁移） */
export function sourceFileOf(id: string, sourceType: 'outline' | 'record' | 'returnSpec' = 'outline'): string {
  return join(projectDir(id), sourceType === 'outline' ? '大纲.docx' : '源文档.docx')
}

export function sourceTypeOf(meta: ProjectMeta): 'outline' | 'record' | 'returnSpec' {
  return meta.sourceType ?? 'outline'
}

export function loadProject(id: string): ProjectFile | null {
  try {
    const raw = readFileSync(fileOf(id), 'utf8')
    const f = JSON.parse(raw) as ProjectFile
    if (f && f.meta && f.meta.id === id) return f
  } catch {
    // 损坏/不存在按无项目处理（06）
  }
  return null
}

function saveProjectFile(id: string, file: ProjectFile): void {
  mkdirSync(projectDir(id), { recursive: true })
  writeFileSync(fileOf(id), JSON.stringify(file), 'utf8')
}

export function listProjects(): ProjectMeta[] {
  const root = projectsRoot()
  if (!existsSync(root)) return []
  const metas: ProjectMeta[] = []
  for (const d of readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory()) continue
    const f = loadProject(d.name)
    if (f !== null) metas.push(f.meta)
  }
  metas.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  return metas
}

export function deleteProject(id: string): void {
  rmSync(projectDir(id), { recursive: true, force: true })
}

/** 上传/打开解析成功后建档或更新：写源副本、刷统计，已有编辑保留不动 */
export function recordParse(
  name: string,
  hash: string,
  bytes: Uint8Array,
  stats: ProjectStats,
  sourceType: 'outline' | 'record' | 'returnSpec' = 'outline',
  alignHash?: string
): void {
  const id = projectId(hash)
  const now = new Date().toISOString()
  const prev = loadProject(id)
  const meta: ProjectMeta = {
    id: id,
    name: name,
    hash: hash,
    addedAt: prev?.meta.addedAt ?? now,
    updatedAt: now,
    lastGeneratedAt: prev?.meta.lastGeneratedAt,
    hasSource: true,
    sourceType: sourceType,
    stats: stats,
    progress: prev?.meta.progress ?? null
  }
  if (alignHash !== undefined && alignHash !== '') meta.alignHash = alignHash
  else if (prev?.meta.alignHash !== undefined) meta.alignHash = prev.meta.alignHash
  saveProjectFile(id, { meta: meta, edits: prev?.edits ?? null })
  mkdirSync(projectDir(id), { recursive: true })
  writeFileSync(sourceFileOf(id, sourceType), bytes)
}

/** 版本闸与旧 loadEditState 一致：版本不符整体作废 */
export function loadProjectEdits(id: string): EditState | null {
  const f = loadProject(id)
  if (f === null || f.edits === null) return null
  const st = f.edits
  if (st && st.version === EDIT_STATE_VERSION && Array.isArray(st.cases)) return st
  return null
}

/** 保存编辑进项目文件；项目不存在时兜底建档（无源副本） */
export function saveProjectEdits(
  outline: { name: string; hash: string },
  state: EditState,
  progress: ProjectProgress | null
): void {
  const id = projectId(outline.hash)
  const prev = loadProject(id)
  const now = new Date().toISOString()
  const meta: ProjectMeta = prev?.meta ?? {
    id: id,
    name: outline.name,
    hash: outline.hash,
    addedAt: now,
    updatedAt: now,
    hasSource: false,
    stats: null,
    progress: null
  }
  meta.name = outline.name
  meta.updatedAt = now
  meta.progress = progress
  saveProjectFile(id, { meta: meta, edits: state })
}

export function recordGenerated(hash: string): void {
  const id = projectId(hash)
  const f = loadProject(id)
  if (f === null) return
  f.meta.lastGeneratedAt = new Date().toISOString()
  saveProjectFile(id, f)
}

/** 启动时执行一次：旧 数据/编辑记录/*.json 迁入项目（无源副本），导入成功后删除旧文件 */
export function migrateLegacyEdits(): void {
  const legacyDir = join(dataRoot(), '编辑记录')
  if (!existsSync(legacyDir)) return
  let imported = 0
  for (const f of readdirSync(legacyDir)) {
    if (!f.endsWith('.json')) continue
    try {
      const st = JSON.parse(readFileSync(join(legacyDir, f), 'utf8')) as EditState
      if (!st || st.version !== EDIT_STATE_VERSION || !st.outline?.hash || !Array.isArray(st.cases)) continue
      const id = projectId(st.outline.hash)
      const prev = loadProject(id)
      if (prev === null) {
        const meta: ProjectMeta = {
          id: id,
          name: st.outline.name,
          hash: st.outline.hash,
          addedAt: st.savedAt,
          updatedAt: st.savedAt,
          hasSource: false,
          stats: null,
          progress: null
        }
        saveProjectFile(id, { meta: meta, edits: st })
      } else if (prev.edits === null) {
        prev.edits = st
        saveProjectFile(id, prev)
      }
      // 项目里已有编辑 → 以项目为准，旧文件照样丢弃
      rmSync(join(legacyDir, f))
      imported++
    } catch {
      // 单个文件失败不影响其他
    }
  }
  if (imported > 0) appendLog(`迁移旧编辑记录 ${imported} 个到项目目录`)
  try {
    rmdirSync(legacyDir)
  } catch {
    // 非空（有未识别文件）则保留
  }
}
