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

export interface GenerateResponse {
  ok: boolean
  error?: string
  spec: string
  rec: string
  specName: string
  recName: string
}
