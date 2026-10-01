import { matchCaseTitle } from './cases.ts'
import type { ParaInfo } from './docx.ts'
import type { DescriptionEntry, IssueCollector, TestItem } from '../domain.ts'

export interface DescriptionInfo {
  shared: string | null
  entries: DescriptionEntry[]
}

/** 段落文本清理：去掉段首手打的列表编号残痕（如"2）"——Word 自动编号不在正文里，
 *  但作者手打的编号会残留，直接拼接会形成"V1.012）软件用户手册"这类错乱文本） */
function cleanSummaryPara(t: string): string {
  return t.replace(/^[0-9]{1,3}\s*[）)、]\s*/, '').trim()
}

/** 解析测试项描述格（9.2：有子项标题行 → 逐用例综述；无 → 全部用例共用） */
export function parseDescription(paras: ParaInfo[], issues: IssueCollector, ctx: string): DescriptionInfo {
  const entries: DescriptionEntry[] = []
  let cur: DescriptionEntry | null = null
  const sharedParts: string[] = []

  for (const para of paras) {
    const m = matchCaseTitle(para.text)
    if (m !== null) {
      cur = { itemId: m.itemId, summary: '' }
      entries.push(cur)
      continue
    }
    const t = cleanSummaryPara(para.text)
    if (t === '') continue
    if (cur !== null) {
      cur.summary = cur.summary + (cur.summary === '' ? '' : '\n') + t
    } else {
      sharedParts.push(t)
    }
  }

  const beforeFirst = sharedParts.join('\n')
  if (beforeFirst.trim() !== '' && entries.length > 0) {
    issues.info('DESC_ORPHAN', '描述格标题行之前有孤立段落，已忽略：' + beforeFirst.slice(0, 30), ctx)
  }

  const shared = entries.length === 0 ? beforeFirst : null
  return { shared: shared, entries: entries }
}

/** 综述匹配（9.2 共用 / 9.3 以方法为准 / 9.4 标识笔误按顺序推断；
 *  2026-10-01：方法格综述（子项标题下）优先，描述格只补缺，不覆盖） */
export function resolveSummaries(item: TestItem, issues: IssueCollector): void {
  const entries = item.description.entries

  // 9.2：描述格没有子项标题 → 整段为全部用例共用综述（正常形态，不提示；
  // 已有方法格综述的用例不覆盖）
  if (entries.length === 0 && item.description.shared !== null) {
    for (const c of item.cases) {
      if (c.summary === '') c.summary = item.description.shared
    }
    return
  }

  const used = new Set<DescriptionEntry>()

  for (const c of item.cases) {
    if (c.summary !== '') {
      // 已有方法格综述：同标识的描述格条目视为已消费（方法格优先，不覆盖、不告未用）
      for (const e of entries) {
        if (!used.has(e) && e.itemId.toUpperCase() === c.itemId.toUpperCase()) {
          used.add(e)
          break
        }
      }
      continue
    }
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
