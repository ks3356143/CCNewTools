/**
 * 回归测试说明解析器（12-追踪文档工具 v2，回归说明追踪表数据源）。
 *
 * 回归说明结构（真实样例勘察，与大纲/记录部分同构）：
 * - 「回归测试需求」章：测试项表（首格「测试项名称」，与大纲测试项表同构，
 *   复用 extractItemTable；追踪关系行带 SRS 章节号/描述）
 * - 「测试用例」章：用例表（与记录用例表同构，复用 parseCaseRecordTable），
 *   用例章节号 = 用例表所在最近标题的自动编号（样例：文档审查用例 6.1.1、
 *   帧生成用例 6.1.2.1.1——分别等于所属项标题的编号）
 */
import { bodyElements, children, localName, textOf, numPrOf, type OfficeFile } from './docx.ts'
import { parseNumbering, createChapterCounter } from './numbering.ts'
import { parseStyles, headingLevel, styleNumPr } from './styles.ts'
import { extractItemTable } from './table.ts'
import { parseCaseRecordTable, parseRecordTrace } from './record.ts'
import { parseSrsTrace } from './outline.ts'
import { KNOWN_TYPE_NAMES, type IssueCollector } from '../domain.ts'

/** heading 栈里最靠前的已知类型名（与 record.ts 同判据） */
function stackTypeName(stack: Array<{ text: string }>): string {
  for (const h of stack) {
    if (KNOWN_TYPE_NAMES.includes(h.text)) return h.text
  }
  return ''
}

/** 回归说明里的一个测试项（「回归测试需求」章） */
export interface ReturnSpecItem {
  name: string
  itemId: string
  /** 追踪关系行解析出的 SRS（无则 "/"） */
  srsChapter: string
  srsDesc: string
}

/** 回归说明/说明文档解析出的一个用例（两族文档的用例表同构，通用提取） */
export interface ReturnSpecCase {
  caseName: string
  caseId: string
  /** 用例章节号 = 用例表所在最近标题的编号 */
  caseChapter: string
  /** 用例表追踪关系行解析（测试需求分析：章节号+项名 / 测试需求标识：项标识）——说明作报告对齐源时的大纲侧信息 */
  traceChapter: string
  traceItemName: string
  traceItemId: string
  /** 用例表所在位置的类型名（heading 栈最近已知类型，报告追踪的测试类型列） */
  typeName: string
}

export interface ReturnSpecData {
  items: ReturnSpecItem[]
  cases: ReturnSpecCase[]
}

/**
 * 解析回归测试说明：扫全文档的测试项表与用例表。
 * 编号只在标题段推进（numPr 或样式级 numPr，与 outline.ts 同一还原机制），
 * 用例章节号取用例表所在最近标题的编号。
 */
export function extractReturnSpec(office: OfficeFile, issues: IssueCollector): ReturnSpecData {
  const counters = createChapterCounter(parseNumbering(office.numbering))
  const styles = parseStyles(office.styles)
  const items: ReturnSpecItem[] = []
  const cases: ReturnSpecCase[] = []
  interface HeadNode { level: number; num: string; text: string }
  const stack: HeadNode[] = []
  for (const node of bodyElements(office)) {
    const tag = localName(node)
    if (tag === 'p') {
      const lvl = headingLevel(node, styles)
      if (lvl === null) continue
      const text = textOf(node).replace(/\n/g, '').trim()
      if (text === '') continue
      while (stack.length > 0 && stack[stack.length - 1].level >= lvl) stack.pop()
      const np = numPrOf(node) ?? styleNumPr(node, styles)
      const num = np !== null ? counters.advance(np.numId, np.ilvl) : ''
      stack.push({ level: lvl, num: num, text: text })
    } else if (tag === 'tbl') {
      const item = extractItemTable(node)
      if (item !== null) {
        const srs = parseSrsTrace(item.traceText)
        items.push({
          name: item.name,
          itemId: item.itemId,
          srsChapter: srs.chapter,
          srsDesc: srs.desc,
        })
        continue
      }
      const rec = parseCaseRecordTable(node)
      if (rec !== null) {
        const top = stack[stack.length - 1]
        const trace = parseRecordTrace(rec.labels.get('追踪关系') ?? '')
        cases.push({
          caseName: rec.labels.get('测试用例名称') ?? '',
          caseId: rec.labels.get('标识') ?? '',
          caseChapter: top?.num ?? '',
          traceChapter: trace.chapter,
          traceItemName: trace.itemName,
          traceItemId: trace.itemId,
          typeName: stackTypeName(stack)
        })
      }
    }
  }
  if (items.length === 0 && cases.length === 0) {
    issues.error('NOT_RETURN_SPEC', '未识别到回归说明的测试项表与用例表（应含「测试项名称」「测试用例名称」表格），请确认导入的是回归测试说明')
  }
  return { items: items, cases: cases }
}
