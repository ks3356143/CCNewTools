import { matchCaseTitle } from './cases.ts'
import type { ParaInfo } from './docx.ts'
import type { IssueCollector, CriteriaEntry, TestItem } from '../domain.ts'

/**
 * 通过准则格解析（9.5，2026-09-30 用户提供样例确认；2026-10-01 扩充）：
 * 格内有自己的用例结构——n、名称（标识）标题行 + 逐条 n） 准则项；
 * 标题下的普通段落 = 一句话准则，也记为一条准则项（变种写法，不再当孤儿丢弃）。
 * 测试方法 = 用例输入（动作），通过准则 = 预期（期望）。
 * 用例标题下的小标题行（如"不同检索类型（……）："）自动丢弃。
 */

function incomplete(s: string): boolean {
  return !(s.endsWith('。') || s.endsWith('；') || s.endsWith(';'))
}

export function parseCriteriaCell(paras: ParaInfo[], issues: IssueCollector, ctx: string): CriteriaEntry[] {
  const entries: CriteriaEntry[] = []
  let cur: CriteriaEntry | null = null
  const orphans: string[] = []

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
      // 小标题行（如"不同检索类型（……）："），无实际内容 → 丢弃；仅在有用例结构时提示
      if (entries.length > 0) issues.info('CRITERIA_LABEL', '通过准则格已忽略小标题行：' + t, ctx)
      continue
    }

    if (/^\d{1,3}\s*[）)]/.test(t)) {
      if (cur === null) {
        orphans.push(t)
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
    if (cur !== null) {
      // 标题下的普通段落：一句话准则（2026-10-01 变种写法）→ 记为一条准则项
      cur.items.push(t)
      continue
    }
    orphans.push(t)
  }

  // 格内没有用例结构（如整格只是一句结论）→ 内容本就不参与配对，静默忽略
  if (entries.length > 0) {
    for (const o of orphans) {
      issues.info('CRITERIA_ORPHAN_TEXT', '通过准则格中有未归属用例的段落，已忽略：' + o.slice(0, 30), ctx)
    }
  }
  return entries
}

/**
 * 准则配对与综述归宿裁决（2026-10-01 变种规则，02 9.9）：
 * 1. 按用例标识把准则条目配给用例——同标识多对时按出现顺序轮转
 *   （用户样例：两个子项故意同标识 XQ_…_SU01，逐个配对而非都配第一个）；
 * 2. 方法格综述的归宿：配上准则 → 转正为用例综述；没配上 → 退回第 1 步
 *   （无准则大纲的解析行为与旧版逐字节一致，黄金基线不受影响）。
 * 在 resolveSummaries 之前调用（方法格综述优先，描述格只补缺）。
 */
export function resolveCriteria(item: TestItem, issues: IssueCollector): void {
  const entries = item.criteriaCases.filter(e => e.items.length > 0)
  const used = new Set<CriteriaEntry>()

  for (const c of item.cases) {
    if (c.itemId === '') continue
    const e = entries.find(x => !used.has(x) && x.itemId.toUpperCase() === c.itemId.toUpperCase())
    if (e !== undefined) {
      c.criteria = e.items
      used.add(e)
    }
  }
  for (const e of entries) {
    if (!used.has(e)) {
      issues.info('CRITERIA_ENTRY_UNUSED', '通过准则格子项 ' + e.itemId + ' 没有对应用例，已忽略', item.name)
    }
  }

  for (const c of item.cases) {
    if (!c.methodSummary) continue
    if (c.criteria !== null && c.criteria !== undefined && c.criteria.length > 0) {
      if (c.summary === '') c.summary = c.methodSummary
    } else {
      // 没配上准则：退回为第 1 步（去换行，与旧规则 5 无分隔符并入一致）
      const text = c.methodSummary.replace(/\n/g, '')
      c.steps = [{ no: 1, text }, ...c.steps.map(function (s, i) { return { no: i + 2, text: s.text } })]
    }
    c.methodSummary = ''
  }
}
