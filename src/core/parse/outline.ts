import { textOf, numPrOf, localName, bodyElements, type OfficeFile } from './docx.ts'
import { parseNumbering, createChapterCounter } from './numbering.ts'
import { parseStyles, headingLevel, styleNumPr } from './styles.ts'
import { extractItemTable } from './table.ts'
import { parseMethod, expandSoftBreaks } from './cases.ts'
import { parseDescription, resolveSummaries } from './describe.ts'
import { parseCriteriaCell, resolveCriteria } from './criteria.ts'
import { IssueCollector, KNOWN_TYPE_NAMES, type ParsedOutline, type TestItem, type PathEntry } from '../domain.ts'

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
  const counters = createChapterCounter(parseNumbering(office.numbering))
  const styles = parseStyles(office.styles)

  const stack: HeadingRef[] = []
  const items: TestItem[] = []
  let inSection = false
  let sectionLevel = 0
  let sawTable = false
  let manualChapterCount = 0

  // body 顶层元素序列（≤20MB 整份 DOM / >20MB 分块即用即弃，对消费者同构——10-大文档处理 4.3）
  for (const node of bodyElements(office)) {
    const tag = localName(node)
    if (tag === 'p') {
      const lvl = headingLevel(node, styles)
      if (lvl === null) continue
      // 标题内的软换行（br）视为同一标题的排版断行，直接删除——层名参与类型匹配，
      // "功能\n测试" 不能因断行而识别失败
      const text = textOf(node).replace(/\n/g, '').trim()
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

  // 完整路径 = 栈中全部标题（栈顶即挂载点/项标题，栈是从节下第一级到挂载点的祖先链，
  // 容器/分系统等中间容器只是路径节点）。层级结构判断不再依赖固定的 level-4/5
  // ——生成文档按 path 序号逐级出标题，镜像大纲层级（2026-10-01 用户定稿）
  const path: PathEntry[] = stack.map(h => ({ level: h.level, text: h.text }))

  // 兼容字段（树导航/静态识别沿用旧语义）：
  // typeName = 从路径最深层往上第一个命中已知类型清单的层（含项标题自身——静态类型项名即类型名）；
  // 清单未覆盖的新类型回退「测试/审查/分析结尾的最深层」，再退首层
  let typeName = ''
  for (let i = path.length - 1; i >= 0; i--) {
    if (KNOWN_TYPE_NAMES.includes(path[i].text)) { typeName = path[i].text; break }
  }
  if (typeName === '') {
    for (let i = path.length - 1; i >= 0; i--) {
      if (/(测试|审查|分析)$/.test(path[i].text)) { typeName = path[i].text; break }
    }
  }
  if (typeName === '') typeName = path[0].text
  // groupName = 类型层之后、项标题之前的所有层（一层时原名，多层拼接；相邻时 null）。
  // 类型层取最后一次出现（静态「文档审查→文档审查」时命中项标题自身，中间层为空）
  let typeIdx = 0
  for (let i = path.length - 1; i >= 0; i--) {
    if (path[i].text === typeName) { typeIdx = i; break }
  }
  const middles = path.slice(typeIdx + 1, -1)
  const groupName = middles.length === 0 ? null : middles.map(m => m.text).join(' · ')

  // 软换行展开（2026-10-08 新变种）：三个内容格统一按 br 拆行/标题保真处理后再进切分
  const cases = parseMethod(expandSoftBreaks(t.method), issues, ctx)
  const desc = parseDescription(expandSoftBreaks(t.description), issues, ctx)
  const critCell = parseCriteriaCell(expandSoftBreaks(t.criteria), issues, ctx)
  const item: TestItem = {
    name: t.name,
    itemId: t.itemId,
    chapter: head.num,
    path: path,
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
