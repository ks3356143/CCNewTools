import type { ParsedOutline, GlobalParams } from '../domain.ts'
import { buildRow, type CaseRow } from './rows.ts'

/**
 * 领域模型 → 模板数据（01 数据流第 2 步）。
 * showType/showGroup/showItem 挂在每个类型/中间层/测试项的第一条用例上，
 * 模板里 {#showType} 等段落条件块据此只输出一次标题（04 变量清单）。
 */
export function convertToTemplateData(parsed: ParsedOutline, params: GlobalParams): { cases: CaseRow[] } {
  const cases: CaseRow[] = []
  let lastType = ''
  let lastGroupKey = ''
  let lastItemKey = ''

  for (const item of parsed.items) {
    for (let i = 0; i < item.cases.length; i++) {
      const c = item.cases[i]
      const row = buildRow(item, c, params)

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
    }
  }
  return { cases: cases }
}
