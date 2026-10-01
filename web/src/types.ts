/** 前端共享类型：直接复用 core 的类型定义（type-only import，构建时擦除） */
import type { CaseRow } from '../../src/core/convert/rows.ts'
import type { Issue } from '../../src/core/domain.ts'
import type { GlobalParams } from '../../src/core/domain.ts'

export type { CaseRow, Issue, GlobalParams }

export interface ParseResponse {
  ok: boolean
  error?: string
  outline: { name: string; hash: string }
  stats: { items: number; cases: number; steps: number }
  issues: Issue[]
  cases: CaseRow[]
  params: GlobalParams
  theme: string
  restored: { cases: number; steps: number; skipped: number }
}

/** 项目元信息（GET /api/projects 返回的每一行，见 SRS/设计/09-本地数据管理.md） */
export interface ProjectMeta {
  id: string
  name: string
  hash: string
  addedAt: string
  updatedAt: string
  lastGeneratedAt?: string
  hasSource: boolean
  stats: { items: number; cases: number; steps: number } | null
  progress: { reviewed: number; suspects: number } | null
}

export interface GenerateResponse {
  ok: boolean
  error?: string
  spec: string
  rec: string
  specName: string
  recName: string
}
