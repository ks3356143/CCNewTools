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
      // 标识写重复（多配置项复制粘贴同 XQ → 同 YL 号）：按用户决定（2026-10-01）
      // 照原样生成、不告警——用户看生成文档自行修改

      if (item.typeName !== lastType) {
        row.showType = item.typeName
        lastType = item.typeName
      }
      const gk = item.typeName + '\u0000' + (item.groupName ?? '')
      const ik = item.chapter + '\u0000' + item.itemName
      // 标题槽位（2026-10-01 用户反馈：无中间层的类型在生成文档里多出一层级）：
      // - 有中间层（功能测试）：h3=组、h4=测试项，编号 2.4.1 / 2.4.1.1 与大纲一致；
      // - 无中间层（接口/性能/边界等，大纲 L4 直接挂 L6 项）：测试项标题上浮到 h3
      //   槽位（编号 2.6.1 与大纲一致），不再落 h4 出 2.6.1.1 四段幻影编号；
      // - 静态三类型（项名=类型名）：不输出额外标题，表格直接挂 h2 下。
      if (item.groupName !== null) {
        if (gk !== lastGroupKey) {
          row.showGroup = item.groupName
          lastGroupKey = gk
        }
        if (ik !== lastItemKey) {
          row.showItem = item.itemName
        }
      } else if (item.itemName !== item.typeName && ik !== lastItemKey) {
        // 无组项上浮 h3 后必须刷新 lastGroupKey：同类型内若再回到带组形态
        // （组项→无组项→组项 的混合嵌套），组标题要重新输出，否则会错挂在无组项的 h3 下
        row.showGroup = item.itemName
        lastGroupKey = gk
      }
      lastItemKey = ik
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
