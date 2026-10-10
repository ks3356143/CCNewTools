import { createHash } from 'node:crypto'
import type { CaseRow } from './convert/rows.ts'
import type { GlobalParams } from './domain.ts'

/** 编辑记录持久化核心（05 持久化方案）：哈希命名、按大纲隔离、恢复匹配 */

/**
 * 编辑存档版本。切分/模板等转换语义变化时递增：
 * 旧版本存档在恢复时整体作废（loadEditState 返回 null），
 * 避免旧规则产出的步骤文本/可疑标记盖掉新规则的转换结果。
 * =1 初版；=2 新切分语义 + 静态三类型模板（2026-09-30）；
 * =3 通过准则配对模式 + 方法格综述（2026-10-01，准则式大纲的步骤文本变化）
 */
export const EDIT_STATE_VERSION = 3

export function sha132(data: Uint8Array): string {
  return createHash('sha1').update(data).digest('hex')
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
 * - 按用例标识（caseId）找到对应用例；**同 caseId 多次出现（撞号大纲）按出现顺序一一配对**——
 *   Map 单值键会被撞号兄弟互相覆盖，排除/核对标记串扰丢失（2026-10-10 实测：2大纲变种
 *   21 组撞号，排除 YL_SU_BZXF_001 后重开被同号实例盖回）。保存序=解析序，同哈希下顺序稳定；
 * - 按步骤序号逐条套用已存文本，与当前不同的计入"恢复"；
 * - 步骤数变化时：用户手动新增的步骤（存档多出的部分）原样保留；存档不足（删除过）的部分以新解析补足，该用例计入恢复。
 * 存档里找不到对应用例的（大纲删了用例）计入 skipped。
 */
export function mergeRestored(fresh: CaseRow[], storedCases: StoredCase[]): RestoreResult {
  const byId = new Map<string, StoredCase[]>()
  for (const s of storedCases) {
    const q = byId.get(s.caseId)
    if (q) q.push(s)
    else byId.set(s.caseId, [s])
  }

  let restoredCases = 0
  let restoredSteps = 0
  const used = new Set<StoredCase>()
  const cases = fresh.map(row => {
    const q = byId.get(row.caseId)
    const s = q !== undefined && q.length > 0 ? q.shift() : undefined
    if (!s) return row
    used.add(s)
    const steps = row.steps.map((step, i) => {
      const saved = s.steps[i]
      if (!saved) return step
      if (saved.action !== step.action || saved.expect !== step.expect) restoredSteps++
      return { ...step, action: saved.action, expect: saved.expect }
    })
    // 用户在界面上手动新增的步骤（存档超出新解析数的部分）必须原样保留，
    // 否则重新打开项目时会被静默丢弃（2026-10-01 QA 实测发现）
    for (let i = row.steps.length; i < s.steps.length; i++) {
      steps.push({ no: i + 1, action: s.steps[i].action, expect: s.steps[i].expect, actual: '', result: '通过' })
      restoredSteps++
    }
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
  for (const q of byId.values()) {
    skippedCases += q.length // 队列剩余 = fresh 中无对应用的存档（大纲删了用例/多余撞号存档）
  }
  return { cases: cases, restoredCases: restoredCases, restoredSteps: restoredSteps, skippedCases: skippedCases }
}
