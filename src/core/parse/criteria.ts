import { matchCaseTitle } from './cases.ts'
import type { ParaInfo } from './docx.ts'
import type { IssueCollector, CriteriaEntry } from '../domain.ts'

/**
 * 通过准则格解析（9.5，2026-09-30 用户提供样例确认）：
 * 格内有自己的用例结构——n、名称（标识）标题行 + 逐条 n） 准则项。
 * 测试方法 = 用例输入（动作），通过准则 = 预期（期望）。
 * 用例标题下的小标题行（如"不同检索类型（……）："）自动丢弃。
 */

function incomplete(s: string): boolean {
  return !(s.endsWith('。') || s.endsWith('；') || s.endsWith(';'))
}

export function parseCriteriaCell(paras: ParaInfo[], issues: IssueCollector, ctx: string): CriteriaEntry[] {
  const entries: CriteriaEntry[] = []
  let cur: CriteriaEntry | null = null

  for (const para of paras) {
    const t = para.text.trim()
    if (t === '') continue

    const title = matchCaseTitle(t)
    if (title !== null) {
      cur = { itemId: title.itemId, items: [] }
      entries.push(cur)
      continue
    }

    if (t.endsWith('：')) {
      // 小标题行（如"不同检索类型（……）："），无实际内容 → 丢弃 + 提示
      issues.info('CRITERIA_LABEL', '通过准则格已忽略小标题行：' + t, ctx)
      continue
    }

    if (/^\d{1,3}\s*[）)]/.test(t)) {
      if (cur === null) {
        issues.info('CRITERIA_ORPHAN_ITEM', '通过准则格中有未归属用例的条目，已忽略：' + t.slice(0, 30), ctx)
        continue
      }
      cur.items.push(t.replace(/^\d{1,3}\s*[）)]\s*/, ''))
      continue
    }

    // 无编号段落：上一条未写完（不以。；结尾）则视为续行并入
    if (cur !== null && cur.items.length > 0 && incomplete(cur.items[cur.items.length - 1])) {
      cur.items[cur.items.length - 1] = cur.items[cur.items.length - 1] + t
      continue
    }
    issues.info('CRITERIA_ORPHAN_TEXT', '通过准则格中有未归属用例的段落，已忽略：' + t.slice(0, 30), ctx)
  }
  return entries
}
