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
 * 标题槽位 head2~head6 挂在每个用例行上（2026-10-01 层级镜像改造）：
 * 按测试项的 path（大纲路径）序号逐级映射模板标题层级（path[0]→h2 … 项标题→最深槽），
 * 槽的路径前缀与上一行不同才输出——分系统/容器等任意嵌套天然正确，
 * 跳级自动压缩（无组上浮行为保留），相邻同名层去重（静态类型不重复出标题）。
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
  const issues = new IssueCollector()
  // 各槽（head2~head6）上一行输出过的路径前缀；空串 = 尚未出现过任何标题
  const prevPrefix: string[] = ['', '', '', '', '']
  let warnedDeepPath = ''

  for (const item of parsed.items) {
    for (let i = 0; i < item.cases.length; i++) {
      const c = item.cases[i]
      const row = buildRow(item, c, params, issues)
      // 标识写重复（多配置项复制粘贴同 XQ → 同 YL 号）：按用户决定（2026-10-01）
      // 照原样生成、不告警——用户看生成文档自行修改

      // 标题槽位分配：path 超过 5 层时丢弃最浅的容器层（项标题必须落在 h6 内）
      let path = item.path
      if (path.length > 5) {
        path = path.slice(path.length - 5)
        if (item.path[0].text !== warnedDeepPath) {
          warnedDeepPath = item.path[0].text
          issues.warning('PATH_TOO_DEEP', '测试项「' + item.name + '」的标题层级超过 5 层，最浅的「' + item.path[0].text + '」层未在生成文档中体现', item.name)
        }
      }
      for (let s = 0; s < path.length; s++) {
        // 相邻同名层去重：静态类型（项名=类型名）不出深层标题，表格直接挂类型层下
        if (s > 0 && path[s].text === path[s - 1].text) continue
        const prefix = path.slice(0, s + 1).map(p => p.text).join('\u0000')
        if (prefix !== prevPrefix[s]) {
          if (s === 0) row.head2 = path[s].text
          else if (s === 1) row.head3 = path[s].text
          else if (s === 2) row.head4 = path[s].text
          else if (s === 3) row.head5 = path[s].text
          else row.head6 = path[s].text
          prevPrefix[s] = prefix
        }
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
