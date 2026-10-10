/**
 * 测试记录解析器（12-追踪文档工具 v2，报告追踪表数据源）。
 * 每张用例记录表以「测试用例名称」标签格识别，行形态为「标签|值|标签|值」，
 * 按标签匹配取值；「通过与否/执行状态/问题单标识」是执行结果与备注列的自动来源。
 */
import { bodyElements, children, localName, textOf, W, type OfficeFile } from './docx.ts'
import { parseStyles, headingLevel } from './styles.ts'
import { KNOWN_TYPE_NAMES, type IssueCollector } from '../domain.ts'

/** 一张用例记录表解析出的用例信息 */
export interface RecordCase {
  /** 用例名（「测试用例名称」格） */
  caseName: string
  /** 用例标识（「标识」格，YL_*） */
  caseId: string
  /** 大纲章节号（追踪关系行「测试需求分析：6.2.1.1 文档审查」的章节号） */
  traceChapter: string
  /** 测试项名（追踪关系行同句的名称部分） */
  traceItemName: string
  /** 测试项标识（追踪关系行「测试需求标识：XQ_DC」） */
  traceItemId: string
  /** 步骤行数（用例标识步骤范围写法 -001~00N） */
  stepCount: number
  /** 各步骤「通过与否」列的值 */
  stepResults: string[]
  /** 「执行状态」格值（已执行/未执行…） */
  executed: string
  /** 「问题单标识」格值（"/"或空 = 无问题单） */
  problemId: string
  /** 记录表所在最近的已知类型名 */
  typeName: string
}

/** 行内标签集合（匹配时去全部空白；"标   识" → "标识"） */
const LABELS = new Set([
  '测试用例名称', '标识', '追踪关系', '测试项综述', '测试用例综述', '用例初始化', '前提和约束',
  '执行状态', '测试时间', '测试人员', '监测人员', '问题单标识', '备注',
  '测试项名称', '测试项标识', '优先级', '测试项描述'
])

/** 格文本归一：去全部空白后精确比对 */
function normLabel(s: string): string {
  return s.replace(/\s+/g, '')
}

/**
 * 行内的标签→值对提取。标签格的值 = 其后第一个非空且非标签的格
 * （colspan 变体下格数浮动，按格文本匹配比按下标稳）。
 */
function labelPairs(rowCells: Element[]): Map<string, string> {
  const out = new Map<string, string>()
  for (let i = 0; i < rowCells.length; i++) {
    const label = normLabel(textOf(rowCells[i]).trim())
    if (!LABELS.has(label)) continue
    let value = ''
    for (let j = i + 1; j < rowCells.length; j++) {
      if (LABELS.has(normLabel(textOf(rowCells[j]).trim()))) break
      const t = textOf(rowCells[j]).trim()
      if (t !== '') {
        value = t
        break
      }
    }
    if (!out.has(label)) out.set(label, value)
  }
  return out
}

/** 追踪关系行三段文本解析：测试需求分析：章节号+项名 / 测试需求标识：项标识 */
export function parseRecordTrace(text: string): { chapter: string; itemName: string; itemId: string } {
  const chapter = /测试需求分析[:：]\s*([\d.]+)/.exec(text)?.[1] ?? ''
  const itemId = /测试需求标识[:：]\s*(\S+)/.exec(text)?.[1] ?? ''
  let itemName = ''
  if (chapter !== '') {
    const after = text.split(/测试需求分析[:：]/)[1] ?? ''
    itemName = (after.split('测试需求标识')[0] ?? '').replace(/^[\d.]+\s*/, '').trim()
  }
  return { chapter: chapter, itemName: itemName, itemId: itemId }
}

/** 一张用例记录表的结构化提取结果 */
export interface CaseRecordTable {
  /** 标签→值（测试用例名称/标识/追踪关系/执行状态/问题单标识/备注…） */
  labels: Map<string, string>
  /** 步骤行数 */
  stepCount: number
  /** 各步骤「通过与否」列的值 */
  stepResults: string[]
}

/**
 * 单张用例记录表提取（记录文档与回归说明的用例表同构，两解析器共用）。
 * 命中条件：表内出现「测试用例名称」标签格且值非空。未命中返回 null。
 */
export function parseCaseRecordTable(tbl: Element): CaseRecordTable | null {
  const rows = children(tbl, W, 'tr')
  if (rows.length === 0) return null
  const labelRows = rows.map(r => children(r, W, 'tc'))
  // 命中判定：存在「测试用例名称 | 值 | 标识 | 值」同行特征。
  // 只认"测试用例名称"单格会把说明/追溯表的子列头（同格还有"测试用例标识"列）误判为用例表
  const hasCaseRow = labelRows.some(cells => {
    const labs = cells.map(c => normLabel(textOf(c).trim()))
    return labs.includes('测试用例名称') && labs.includes('标识')
  })
  if (!hasCaseRow) return null

  const labels = new Map<string, string>()
  for (const cells of labelRows) {
    for (const [k, v] of labelPairs(cells)) {
      if (!labels.has(k)) labels.set(k, v)
    }
  }
  if ((labels.get('测试用例名称') ?? '') === '') return null

  // 步骤行：表头行含「输入及操作」格，其后首格为纯数字的行，直到标签行（执行状态）为止
  const headIdx = labelRows.findIndex(cells => cells.some(c => normLabel(textOf(c).trim()) === '输入及操作'))
  const stepResults: string[] = []
  if (headIdx >= 0) {
    // 「通过与否」列 = 表头行中该标签格的下标（步骤行 tc 布局与表头一致）
    const pIdx = labelRows[headIdx].findIndex(c => normLabel(textOf(c).trim()) === '通过与否')
    for (let r = headIdx + 1; r < labelRows.length; r++) {
      const cells = labelRows[r]
      if (cells.length === 0) continue
      const first = textOf(cells[0]).trim()
      if (!/^\d+$/.test(first)) break
      let res = ''
      if (pIdx >= 0 && pIdx < cells.length) res = textOf(cells[pIdx]).trim()
      stepResults.push(res)
    }
  }
  return {
    labels: labels,
    stepCount: stepResults.length,
    stepResults: stepResults,
  }
}

/** heading 栈节点（记录/回归说明解析共用：带层级与文本） */
interface HeadNode {
  level: number
  text: string
}

/** 栈里最靠前（最外层）的已知类型名；无命中返回空串 */
function stackTypeName(stack: HeadNode[]): string {
  for (const h of stack) {
    if (KNOWN_TYPE_NAMES.includes(h.text)) return h.text
  }
  return ''
}

/**
 * 解析测试记录文档：扫全部用例记录表 + heading 类型上下文。
 * 不定位特定章节（记录文档的用例表分布在「测试记录」章下，扫描全文档即可）。
 */
export function extractRecordCases(office: OfficeFile, issues: IssueCollector): RecordCase[] {
  const styles = parseStyles(office.styles)
  const out: RecordCase[] = []
  const stack: HeadNode[] = []
  for (const node of bodyElements(office)) {
    const tag = localName(node)
    if (tag === 'p') {
      const lvl = headingLevel(node, styles)
      if (lvl === null) continue
      const text = textOf(node).replace(/\n/g, '').trim()
      if (text === '') continue
      while (stack.length > 0 && stack[stack.length - 1].level >= lvl) stack.pop()
      stack.push({ level: lvl, text: text })
    } else if (tag === 'tbl') {
      const rec = parseCaseRecordTable(node)
      if (rec === null) continue
      const trace = parseRecordTrace(rec.labels.get('追踪关系') ?? '')
      out.push({
        caseName: rec.labels.get('测试用例名称') ?? '',
        caseId: rec.labels.get('标识') ?? '',
        traceChapter: trace.chapter,
        traceItemName: trace.itemName,
        traceItemId: trace.itemId,
        stepCount: rec.stepCount,
        stepResults: rec.stepResults,
        executed: rec.labels.get('执行状态') ?? '',
        problemId: rec.labels.get('问题单标识') ?? '',
        typeName: stackTypeName(stack),
      })
    }
  }
  if (out.length === 0) {
    issues.error('NO_RECORD_TABLES', '未识别到用例记录表（表内应有「测试用例名称」「标识」行），请确认导入的是测试记录')
  }
  // 用例标识缺失的记录表（用户漏写标识格）：点名告警，行照常生成（标识留空不参与对齐）
  for (const c of out) {
    if (c.caseId === '') {
      issues.warning('RECORD_CASE_NO_ID', '用例「' + c.caseName + '」没有标识，无法与大纲对齐，需求列将留空', c.caseName)
    }
  }
  return out
}
