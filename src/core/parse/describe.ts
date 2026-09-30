import { matchCaseTitle } from './cases.ts'
import type { ParaInfo } from './docx.ts'
import type { DescriptionEntry, IssueCollector, TestItem } from '../domain.ts'

export interface DescriptionInfo {
  shared: string | null
  entries: DescriptionEntry[]
}

/** 解析测试项描述格（9.2：有子项标题行 → 逐用例综述；无 → 全部用例共用） */
export function parseDescription(paras: ParaInfo[], issues: IssueCollector, ctx: string): DescriptionInfo {
  const entries: DescriptionEntry[] = []
  let cur: DescriptionEntry | null = null
  let beforeFirst = ''

  for (const para of paras) {
    const t = para.text
    const m = matchCaseTitle(t)
    if (m !== null) {
      cur = { itemId: m.itemId, summary: '' }
      entries.push(cur)
      continue
    }
    if (cur !== null) {
      cur.summary = cur.summary + t
    } else {
      beforeFirst = beforeFirst + t
    }
  }

  if (beforeFirst.trim() !== '' && entries.length > 0) {
    issues.info('DESC_ORPHAN', '描述格标题行之前有孤立段落，已忽略：' + beforeFirst.slice(0, 30), ctx)
  }

  const shared = entries.length === 0 ? beforeFirst : null
  return { shared: shared, entries: entries }
}

/** 综述匹配（9.2 共用 / 9.3 以方法为准 / 9.4 标识笔误按顺序推断） */
export function resolveSummaries(item: TestItem, issues: IssueCollector): void {
  const entries = item.description.entries

  // 9.2：描述格没有子项标题 → 整段为全部用例共用综述（正常形态，不提示）
  if (entries.length === 0 && item.description.shared !== null) {
    for (const c of item.cases) c.summary = item.description.shared
    return
  }

  const used = new Set<DescriptionEntry>()

  for (const c of item.cases) {
    for (const e of entries) {
      if (used.has(e)) continue
      if (e.itemId.toUpperCase() === c.itemId.toUpperCase()) {
        c.summary = e.summary
        used.add(e)
        break
      }
    }
  }

  const missing: RawCaseLike[] = []
  for (const c of item.cases) {
    if (c.summary === '') missing.push(c)
  }
  const unused: DescriptionEntry[] = []
  for (const e of entries) {
    if (!used.has(e)) unused.push(e)
  }

  if (missing.length > 0 && missing.length === unused.length) {
    for (let i = 0; i < missing.length; i++) {
      missing[i].summary = unused[i].summary
      used.add(unused[i])
      issues.warning(
        'SUMMARY_ORDER_MATCH',
        '用例「' + missing[i].name + '」的综述按顺序推断匹配（描述格与方法格标识不一致）',
        item.name
      )
    }
  } else {
    for (const c of missing) {
      if (item.description.shared !== null) {
        c.summary = item.description.shared
        issues.info('SUMMARY_FALLBACK_SHARED', '用例「' + c.name + '」综述缺失，已回退共用综述', item.name)
      } else {
        issues.warning('SUMMARY_MISSING', '用例「' + c.name + '」缺少综述', item.name)
      }
    }
  }

  for (const e of entries) {
    if (!used.has(e)) {
      issues.warning('DESC_ENTRY_UNUSED', '描述格子项 ' + e.itemId + ' 在测试方法中没有对应用例，已忽略', item.name)
    }
  }
}

interface RawCaseLike {
  name: string
  summary: string
}
