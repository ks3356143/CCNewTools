import { createHash } from 'node:crypto'
import type { CaseRow } from './convert/rows.ts'
import type { GlobalParams } from './domain.ts'

/** 编辑记录持久化核心（05 持久化方案）：哈希命名、按大纲隔离、恢复匹配 */

/**
 * 编辑存档版本。切分/模板等转换语义变化时递增：
 * 旧版本存档在恢复时整体作废（loadEditState 返回 null），
 * 避免旧规则产出的步骤文本/可疑标记盖掉新规则的转换结果。
 * =1 初版；=2 新切分语义 + 静态三类型模板（2026-09-30）
 */
export const EDIT_STATE_VERSION = 2

export function sha132(data: Uint8Array): string {
  return createHash('sha1').update(data).digest('hex')
}

export function editFileName(outlineName: string, hash: string): string {
  const base = outlineName.replace(/\.docx$/i, '').replace(/[\\/:*?"<>|]/g, '_')
  return base + '_' + hash.slice(0, 8) + '.json'
}

export interface StoredCase {
  caseId: string
  reviewed: boolean
  excluded: boolean
  dismissedSuspects: number[]
  steps: Array<{ action: string; expect: string }>
}

export interface EditState {
  version: number
  outline: { name: string; hash: string }
  savedAt: string
  cases: StoredCase[]
}

export interface RestoreResult {
  cases: CaseRow[]
  restoredCases: number
  restoredSteps: number
  skippedCases: number
}

/**
 * 把已存的编辑套回新解析的数据：
 * - 按用例标识（caseId）找到对应用例；
 * - 按步骤序号逐条套用已存文本，与当前不同的计入"恢复"；
 * - 步骤数变化时，多出/不足的部分以新解析为准，该用例计入部分恢复。
 * 存档里找不到对应用例的（大纲删了用例）计入 skipped。
 */
export function mergeRestored(fresh: CaseRow[], storedCases: StoredCase[]): RestoreResult {
  const byId = new Map<string, StoredCase>()
  for (const s of storedCases) byId.set(s.caseId, s)

  let restoredCases = 0
  let restoredSteps = 0
  const used = new Set<string>()
  const cases = fresh.map(row => {
    const s = byId.get(row.caseId)
    if (!s) return row
    used.add(row.caseId)
    const steps = row.steps.map((step, i) => {
      const saved = s.steps[i]
      if (!saved) return step
      if (saved.action !== step.action || saved.expect !== step.expect) restoredSteps++
      return { ...step, action: saved.action, expect: saved.expect }
    })
    if (
      s.reviewed !== row.reviewed ||
      s.excluded !== row.excluded ||
      s.dismissedSuspects.length > 0 ||
      restoredSteps > 0
    ) {
      restoredCases++
    }
    return {
      ...row,
      steps: steps,
      reviewed: s.reviewed,
      excluded: s.excluded,
      dismissedSuspects: s.dismissedSuspects
    }
  })

  let skippedCases = 0
  for (const s of storedCases) {
    if (!used.has(s.caseId)) skippedCases++
  }
  return { cases: cases, restoredCases: restoredCases, restoredSteps: restoredSteps, skippedCases: skippedCases }
}
