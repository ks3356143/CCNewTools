import type { ParsedOutline, GlobalParams } from '../domain.ts'
import { IssueCollector } from '../domain.ts'
import { buildRow, type CaseRow } from './rows.ts'

/** "测试说明"章的用例清单行（老说明第 4 章格式：序号/用例名称/用例标识/测试用例综述） */
export interface CaseListRow {
  no: number
  mingcheng: string
  caseId: string
  summary: string
}

/** "需求的可追踪性"章的追踪表行（老说明第 6 章格式） */
export interface TraceRow {
  no: number
  srsChapter: string
  srsDesc: string
  outlineChapter: string
  itemName: string
  itemItemId: string
  caseName: string
  caseId: string
}

/**
 * 领域模型 → 模板数据（01 数据流第 2 步）。
 * showType/showGroup/showItem 挂在每个类型/中间层/测试项的第一条用例上，
 * 模板里 {#showType} 等段落条件块据此只输出一次标题（04 变量清单）。
 * caselist = "测试说明"章用例清单；traceRows = "需求的可追踪性"章追踪表。
 * 被排除（不生成）的用例不进入任何表。
 */
export function convertToTemplateData(parsed: ParsedOutline, params: GlobalParams): {
  cases: CaseRow[]
  caselist: CaseListRow[]
  traceRows: TraceRow[]
  issues: IssueCollector['issues']
} {
  const cases: CaseRow[] = []
  const caselist: CaseListRow[] = []
  const traceRows: TraceRow[] = []
  let lastType = ''
  let lastGroupKey = ''
  let lastItemKey = ''
  const issues = new IssueCollector()

  for (const item of parsed.items) {
    for (let i = 0; i < item.cases.length; i++) {
      const c = item.cases[i]
      const row = buildRow(item, c, params, issues)

      if (item.typeName !== lastType) {
        row.showType = item.typeName
        lastType = item.typeName
      }
      const gk = item.typeName + '\u0000' + (item.groupName ?? '')
      if (item.groupName !== null && gk !== lastGroupKey) {
        row.showGroup = item.groupName
        lastGroupKey = gk
      }
      const ik = item.chapter + '\u0000' + item.itemName
      if (ik !== lastItemKey) {
        row.showItem = item.itemName
        lastItemKey = ik
      }
      cases.push(row)

      if (!row.excluded) {
        caselist.push({
          no: caselist.length + 1,
          mingcheng: row.mingcheng,
          caseId: row.caseId,
          summary: row.summary
        })
        traceRows.push({
          no: traceRows.length + 1,
          srsChapter: item.traceSrs.chapter,
          srsDesc: item.traceSrs.desc,
          outlineChapter: item.chapter,
          itemName: item.itemName,
          itemItemId: item.itemId,
          caseName: row.mingcheng,
          caseId: row.caseId
        })
      }
    }
  }
  return { cases: cases, caselist: caselist, traceRows: traceRows, issues: issues.issues }
}
