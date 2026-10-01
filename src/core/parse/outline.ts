import { children, textOf, numPrOf, localName, W, type OfficeFile } from './docx.ts'
import { parseNumbering, createChapterCounter } from './numbering.ts'
import { parseStyles, headingLevel, styleNumPr } from './styles.ts'
import { extractItemTable } from './table.ts'
import { parseMethod } from './cases.ts'
import { parseDescription, resolveSummaries } from './describe.ts'
import { parseCriteriaCell, resolveCriteria } from './criteria.ts'
import { IssueCollector, type ParsedOutline, type TestItem } from '../domain.ts'

export interface HeadingRef {
  level: number
  num: string
  text: string
  /** 本标题为栈顶时挂过测试项表格 */
  sawTable?: boolean
  /** 本标题之下出现过更深层标题（容器形态：配置项/功能测试等） */
  hasChild?: boolean
  /** 本标题为栈顶时出现过表格（含未能识别为测试项表格的） */
  sawTblAny?: boolean
}

/** 被顶掉/残留的标题裁决：无表无子标题 = 悬空；有表但表不是测试项表格 = 另一种告警 */
function warnIfDropped(h: HeadingRef, issues: IssueCollector): void {
  if (h.sawTable || h.hasChild) return
  const label = '「' + (h.num !== '' ? h.num + ' ' : '') + h.text + '」'
  if (h.sawTblAny) {
    issues.warning('TABLE_NOT_ITEM', '标题' + label + '下的表格不是测试项表格（首行应为「测试项名称」），已忽略', '测试项及方法')
  } else {
    issues.warning('HEADING_NO_TABLE', '标题' + label + '下没有测试项表格（可能写漏），该标题无测试项产出', '测试项及方法')
  }
}

/**
 * 解析大纲：定位「测试项及方法」节，产出领域模型（01 数据流）。
 * 不含业务规则（用例标识生成、动作/期望拆分都在转换层）。
 */
export function extractOutline(office: OfficeFile, issues: IssueCollector): ParsedOutline {
  const docEl = office.doc.documentElement
  const body = docEl ? children(docEl, W, 'body')[0] : null
  if (!body) throw new Error('文件损坏：document.xml 中没有 body')

  const counters = createChapterCounter(parseNumbering(office.numbering))
  const styles = parseStyles(office.styles)

  const stack: HeadingRef[] = []
  const items: TestItem[] = []
  let inSection = false
  let sectionLevel = 0
  let sawTable = false
  let manualChapterCount = 0

  const kids: Element[] = []
  for (let i = 0; i < body.childNodes.length; i++) {
    const n = body.childNodes.item(i)
    if (n.nodeType === 1) kids.push(n as Element)
  }

  for (const node of kids) {
    const tag = localName(node)
    if (tag === 'p') {
      const lvl = headingLevel(node, styles)
      if (lvl === null) continue
      const text = textOf(node).trim()
      // 空标题（只挂编号没写文字）不进栈：进栈会以空名参与类型/组判定
      if (text === '') continue
      // 编号可能在段落直接格式或标题样式定义里（真实大纲：heading1-9 样式各带 numId+ilvl）
      const np = numPrOf(node) ?? styleNumPr(node, styles)
      let num = ''
      let hText = text
      if (np !== null) {
        num = counters.advance(np.numId, np.ilvl)
      } else {
        // 手打编号回退（2026-10-01）：标题无自动编号而正文自带「6.2.1.4.1 名称」式编号 →
        // 编号还原为章节号、文字剥掉编号前缀；有自动编号的正常大纲不受影响
        const m = /^(\d{1,3}(?:\.\d{1,3})+)[\s　]?(.*)$/.exec(text)
        if (m !== null) {
          num = m[1]
          hText = m[2].trim()
          manualChapterCount++
        }
      }

      if (!inSection) {
        if (text.replace(/\s+/g, '').includes('测试项及方法')) {
          inSection = true
          sectionLevel = lvl
          stack.length = 0
        }
        continue
      }
      // 被顶掉的标题若无表也无子标题 = 悬空（用户写漏测试项表，2026-10-01 用户要求显式告警）。
      // 先弹栈检查再判节终止：本节最后一个悬空标题由终结本节的同级标题顶掉，不能漏
      while (stack.length > 0 && stack[stack.length - 1].level >= lvl) {
        warnIfDropped(stack.pop()!, issues)
      }
      if (lvl <= sectionLevel) break
      for (const h of stack) h.hasChild = true
      stack.push({ level: lvl, num: num, text: hText })
    } else if (tag === 'tbl' && inSection) {
      const top = stack[stack.length - 1]
      if (top) top.sawTblAny = true
      const t = extractItemTable(node)
      if (t === null) continue
      sawTable = true
      if (top) top.sawTable = true
      const item = assembleItem(t, stack, issues)
      if (item !== null) items.push(item)
    }
  }

  if (!inSection) {
    throw new Error('未找到「测试项及方法」章节，请确认导入的是测试大纲')
  }
  // 文档在节内直接结束（无同级标题终结）的兜底：栈里残留的悬空标题也要告警
  while (stack.length > 0) warnIfDropped(stack.pop()!, issues)
  if (manualChapterCount > 0) {
    issues.info('MANUAL_CHAPTER_NUM', manualChapterCount + ' 个标题没有自动编号，已按正文手打编号还原章节号', '测试项及方法')
  }
  if (!sawTable) {
    issues.error('NO_TABLES', '「测试项及方法」章节内没有测试项表格')
  }

  let caseCount = 0
  let stepCount = 0
  for (const it of items) {
    caseCount += it.cases.length
    for (const c of it.cases) stepCount += c.steps.length
  }
  return { items: items, issues: issues.issues, stats: { items: items.length, cases: caseCount, steps: stepCount } }
}

function assembleItem(
  t: { name: string; itemId: string; traceText: string; description: import('./table.ts').CellParas; method: import('./table.ts').CellParas; criteria: import('./table.ts').CellParas },
  stack: HeadingRef[],
  issues: IssueCollector
): TestItem | null {
  const ctx = t.name || '未命名测试项'
  const head = stack[stack.length - 1]
  if (!head) {
    issues.error('TABLE_NO_HEADING', '测试项表格之前没有标题', ctx)
    return null
  }

  // 测试类型 = 最近的 level-4 标题（含挂载点自身是 level-4 的情况，如文档审查）
  let typeIdx = -1
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].level === 4) {
      typeIdx = i
      break
    }
  }
  const typeName = typeIdx >= 0 ? stack[typeIdx].text : stack[0].text
  if (typeIdx < 0) {
    issues.warning('NO_TYPE_HEADING', '表格之前没有 level-4 测试类型标题，已用「' + typeName + '」充当', ctx)
  }
  // 中间层 = level-4 之后的 level-5 标题（跳级形态下不存在）。
  // 表格直接挂在 level-5 标题上时（head 就是该标题），它是测试项本身而非中间层——
  // 否则组名与项名相同，生成文档/树里会多出一层重复标题（2026-10-01 用户反馈）
  let groupIdx = -1
  for (let i = stack.length - 1; i > typeIdx; i--) {
    if (stack[i].level === 5) {
      groupIdx = i
      break
    }
  }
  const groupName = groupIdx >= 0 && groupIdx < stack.length - 1 ? stack[groupIdx].text : null

  const cases = parseMethod(t.method, issues, ctx)
  const desc = parseDescription(t.description, issues, ctx)
  const critCell = parseCriteriaCell(t.criteria, issues, ctx)
  const item: TestItem = {
    name: t.name,
    itemId: t.itemId,
    chapter: head.num,
    typeName: typeName,
    groupName: groupName,
    itemName: head.text,
    description: desc,
    cases: cases,
    criteriaCases: critCell.entries,
    criteriaOrphans: critCell.orphanItems,
    traceSrs: parseSrsTrace(t.traceText)
  }
  resolveCriteria(item, issues)
  resolveSummaries(item, issues)

  if (item.itemId === '') {
    issues.error('ITEM_ID_MISSING', '测试项「' + item.name + '」缺少测试项标识', ctx)
  }

  // 标识一致性（02 第八节）：测试项标识 vs 用例需求标识前缀
  let mismatchWarned = false
  for (const c of item.cases) {
    if (c.itemId === '' || item.itemId === '' || mismatchWarned) continue
    const cPrefix = c.itemId.split('_').slice(0, -1).join('_')
    if (cPrefix !== item.itemId) {
      issues.warning('ID_MISMATCH', '测试项标识 ' + item.itemId + ' 与用例需求标识 ' + c.itemId + ' 不一致，已按用例标题中的标识处理', ctx)
      mismatchWarned = true
    }
  }

  return item
}

/** 追踪关系格 → 需求规格说明的章节号与描述（追踪表用）。"/"或空 → 两条斜杠。 */
export function parseSrsTrace(text: string): { chapter: string; desc: string } {
  const t = text.trim()
  if (t === '' || t === '/' || t === '／') return { chapter: '/', desc: '/' }
  const m = /》\s*([0-9][0-9.]*)\s*(.*)/.exec(t) ?? /^([0-9][0-9.]*)\s+(.*)$/.exec(t)
  if (m === null) return { chapter: '/', desc: '/' }
  return { chapter: m[1], desc: (m[2] ?? '').trim() !== '' ? m[2].trim() : '/' }
}
