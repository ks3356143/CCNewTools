/**
 * 四类追踪表构建（12-追踪文档工具 v2）。
 * 大纲 → 大纲追踪表（6 列）/ 说明追踪表（8 列）；
 * 测试记录 + 大纲 → 报告追踪表（11 列，标识对齐补需求列）；
 * 回归说明 + 大纲 → 回归说明追踪表（9 列）。
 * 全部走统一 TraceTable 模型（双层表头 + vmerge）。
 */
import type { CaseRow } from '../convert/rows.ts'
import type { RecordCase } from '../parse/record.ts'
import type { ReturnSpecData } from '../parse/returnspec.ts'
import { applyVmerge, caseIdWithStepRange, type TraceTable, type TraceRowVM, type TraceHeadGroup } from './table.ts'
import type { IssueCollector } from '../domain.ts'

export interface TraceBuildInput {
  type: 'outline' | 'spec' | 'report' | 'returnSpec'
  /** 大纲侧用例行（outline/spec 直接推导；report/returnSpec 按用例标识对齐） */
  outlineCases: CaseRow[]
  /** 测试记录解析结果（report） */
  records?: RecordCase[]
  /** 回归说明解析结果（returnSpec） */
  returnSpec?: ReturnSpecData
}

/** 大纲追踪表表头（大纲附件2「测试项与软件需求规格说明对照表」，6 列） */
export const HEADS_OUTLINE: TraceHeadGroup[] = [
  { group: '', cols: ['序号'] },
  { group: '需求来源', cols: ['软件研制任务书', '软件需求规格说明'] },
  { group: '', cols: ['测试项标识'] },
  { group: '', cols: ['测试类型'] },
  { group: '', cols: ['备注'] }
]

/** 说明追踪表表头（测试说明「需求的可追踪性」，8 列） */
export const HEADS_SPEC: TraceHeadGroup[] = [
  { group: '', cols: ['序号'] },
  { group: '软件需求规格说明', cols: ['章节号', '章节描述'] },
  { group: '软件测试大纲', cols: ['大纲章节号', '测试项名称', '测试项标识'] },
  { group: '测试用例', cols: ['测试用例名称', '测试用例标识'] }
]

/** 报告追踪表表头（报告附件2「软件满足软件需求规格说明对照表」，11 列） */
export const HEADS_REPORT: TraceHeadGroup[] = [
  { group: '', cols: ['序号'] },
  { group: '软件需求规格说明', cols: ['章节号', '章节描述'] },
  { group: '测评大纲', cols: ['章节号', '测试项名称', '测试项标识', '测试类型'] },
  { group: '测试用例', cols: ['测试用例标识', '名称', '执行结果'] },
  { group: '', cols: ['备注'] }
]

/** 回归说明追踪表表头（回归说明「需求的可追踪性」表7-1，9 列） */
export const HEADS_RETURNSPEC: TraceHeadGroup[] = [
  { group: '', cols: ['序号'] },
  { group: '软件需求规格说明', cols: ['章节号', '章节描述'] },
  { group: '测评大纲', cols: ['大纲章节号', '测试项名称', '测试项标识'] },
  { group: '测试用例', cols: ['用例章节号', '测试用例名称', '测试用例标识'] }
]

/** 每类表的纵向合并列（vmerge 组；空数组 = 不合并） */
const MERGE_COLS: Record<TraceTable['type'], number[]> = {
  outline: [],
  spec: [1, 2, 3, 4, 5],
  report: [1, 2, 3, 4, 5, 6],
  returnSpec: [1, 2, 3, 4, 5]
}

/** 各类表的模板占位符变量名（与 模板/追踪-*.docx 循环行一一对应，也用于 rows→渲染对象转换） */
export const TYPE_VARS: Record<TraceTable['type'], string[]> = {
  outline: ['no', 'taskBook', 'srsChapter', 'itemItemId', 'typeName', 'remark'],
  spec: ['no', 'srsChapter', 'srsDesc', 'outlineChapter', 'itemName', 'itemItemId', 'caseName', 'caseId'],
  report: ['no', 'srsChapter', 'srsDesc', 'outlineChapter', 'itemName', 'itemItemId', 'typeName', 'caseId', 'caseName', 'result', 'remark'],
  returnSpec: ['no', 'srsChapter', 'srsDesc', 'outlineChapter', 'itemName', 'itemItemId', 'caseChapter', 'caseName', 'caseId']
}

/** 各类表的渲染模板（四套双层表头模板，12-追踪文档工具 v2） */
export const TRACE_TEMPLATE_NAMES: Record<TraceTable['type'], string> = {
  outline: '追踪-大纲模板.docx',
  spec: '追踪-说明模板.docx',
  report: '追踪-报告模板.docx',
  returnSpec: '追踪-回归模板.docx'
}

/** SRS 章节号/描述的展示值：'/'或空 → 大纲附件2 语境用 '--' */
function srsDash(v: string): string {
  return v === '/' || v === '' ? '--' : v
}

/** 大纲 cases → 项级行（每测试项一行，按出现顺序去重） */
function outlineItemRows(cases: CaseRow[]): CaseRow[] {
  const seen = new Set<string>()
  const out: CaseRow[] = []
  for (const c of cases) {
    const key = c.chapter + '\u0000' + c.itemItemId
    if (seen.has(key)) continue
    seen.add(key)
    out.push(c)
  }
  return out
}

/** 大纲追踪表（6 列，每测试项一行；任务书列恒 '--' 人工填，SRS 取追踪关系行解析值） */
function buildOutlineTable(cases: CaseRow[]): TraceTable {
  const items = outlineItemRows(cases)
  const cellsList = items.map((c, i) => [
    String(i + 1),
    '--',
    srsDash(c.srsChapter),
    c.itemItemId,
    c.typeName,
    '/'
  ])
  const rows: TraceRowVM[] = cellsList.map(cells => ({ cells: cells, span: cells.map(() => 1) }))
  return { type: 'outline', heads: HEADS_OUTLINE, rows: rows }
}

/** 说明追踪表（8 列，每用例一行；SRS 无对应写 '/'，与真实文档一致） */
function buildSpecTable(cases: CaseRow[]): TraceTable {
  const cellsList = cases.map((c, i) => [
    String(i + 1),
    c.srsChapter,
    c.srsDesc,
    c.chapter,
    c.itemName,
    c.itemItemId,
    c.mingcheng,
    c.caseId
  ])
  const rows: TraceRowVM[] = cellsList.map(cells => ({ cells: cells, span: cells.map(() => 1) }))
  applyVmerge(rows, MERGE_COLS.spec)
  return { type: 'spec', heads: HEADS_SPEC, rows: rows }
}

/** 用例标识的对比基形：去尾部序号（YL_DC_001 → YL_DC）——记录/回归说明多用老工具的无序号写法 */
function baseOf(caseId: string): string {
  return caseId.replace(/_\d+$/, '')
}

/** 大纲 cases 的对齐索引：精确 caseId + 去序号 base 双层（撞号取首行） */
function alignIndexOf(cases: CaseRow[]): {
  exact: Map<string, CaseRow>
  base: Map<string, CaseRow>
} {
  const exact = new Map<string, CaseRow>()
  const base = new Map<string, CaseRow>()
  for (const c of cases) {
    if (!exact.has(c.caseId)) exact.set(c.caseId, c)
    const b = baseOf(c.caseId)
    if (!base.has(b)) base.set(b, c)
  }
  return { exact: exact, base: base }
}

/** 对齐一个用例标识：先精确，再去序号兜底 */
function alignCase(idx: { exact: Map<string, CaseRow>; base: Map<string, CaseRow> }, caseId: string): CaseRow | undefined {
  return idx.exact.get(caseId) ?? idx.base.get(baseOf(caseId))
}

/** 报告追踪表的执行结果自动推导：全步骤通过、已执行、无问题单 → "通过"，否则留空人工判断 */
function deriveResult(rec: RecordCase): string {
  if (rec.executed.includes('未执行')) return ''
  if (rec.stepResults.some(r => r === '未通过')) return ''
  if (rec.problemId !== '/' && rec.problemId !== '') return ''
  return '通过'
}

/** 报告追踪表的备注列：问题单标识（无 → "--"，与真实样例一致） */
function deriveRemark(rec: RecordCase): string {
  return rec.problemId !== '/' && rec.problemId !== '' ? rec.problemId : '--'
}

/**
 * 报告追踪表（11 列）：记录解析结果 + 大纲 cases 按用例标识对齐。
 * SRS/大纲章节号/项名/项标识/测试类型来自大纲（记录里没有）；
 * 用例名/步骤范围/执行结果/备注来自记录。对不上的行需求列留空 + 告警，不拦截。
 */
function buildReportTable(records: RecordCase[], outlineCases: CaseRow[], issues: IssueCollector): TraceTable {
  const idx = alignIndexOf(outlineCases)
  const cellsList: string[][] = []
  for (const rec of records) {
    const c = rec.caseId === '' ? undefined : alignCase(idx, rec.caseId)
    if (rec.caseId !== '' && c === undefined) {
      issues.warning(
        'TRACE_ALIGN_MISS',
        '用例「' + rec.caseName + '」（' + rec.caseId + '）未在大纲中找到对应项，需求列留空，请人工补齐',
        rec.caseName
      )
    }
    cellsList.push([
      String(cellsList.length + 1),
      c ? c.srsChapter : '',
      c ? c.srsDesc : '',
      c ? c.chapter : '',
      c ? c.itemName : '',
      c ? c.itemItemId : '',
      c ? c.typeName : '',
      caseIdWithStepRange(rec.caseId, rec.stepCount),
      rec.caseName,
      deriveResult(rec),
      deriveRemark(rec)
    ])
  }
  const rows: TraceRowVM[] = cellsList.map(cells => ({ cells: cells, span: cells.map(() => 1) }))
  applyVmerge(rows, MERGE_COLS.report)
  return { type: 'report', heads: HEADS_REPORT, rows: rows, editableCol: 9 }
}

/**
 * 回归说明追踪表（9 列）：回归说明 + 大纲 cases 按用例标识对齐。
 * 大纲章节号/项名/项标识来自大纲（回归说明自己的编号是另一套 6.1.x）；
 * SRS 优先用回归说明测试项表追踪关系行的解析值（回归文档自己的更准），空时兜底大纲的；
 * 用例章节号 = 回归说明里用例表所在标题的编号。
 */
function buildReturnSpecTable(rs: ReturnSpecData, outlineCases: CaseRow[], issues: IssueCollector): TraceTable {
  const idx = alignIndexOf(outlineCases)
  // 回归说明测试项表的 SRS 按项标识备用（用例行对不上大纲时兜底）
  const srsByItem = new Map<string, { chapter: string; desc: string }>()
  for (const it of rs.items) {
    if (it.itemId !== '' && !srsByItem.has(it.itemId)) {
      srsByItem.set(it.itemId, { chapter: it.srsChapter, desc: it.srsDesc })
    }
  }
  const cellsList: string[][] = []
  for (const rc of rs.cases) {
    const c = rc.caseId === '' ? undefined : alignCase(idx, rc.caseId)
    if (rc.caseId !== '' && c === undefined) {
      issues.warning(
        'TRACE_ALIGN_MISS',
        '用例「' + rc.caseName + '」（' + rc.caseId + '）未在大纲中找到对应项，大纲章节号与项列留空',
        rc.caseName
      )
    }
    // SRS：回归说明追踪关系行解析值优先，'/'或空时用大纲同用例的（再无则 '/'）
    let srsChapter = ''
    let srsDesc = ''
    const itemKey = c ? c.itemItemId : ''
    const rsSrs = itemKey !== '' ? srsByItem.get(itemKey) : undefined
    if (rsSrs !== undefined && rsSrs.chapter !== '/' && rsSrs.chapter !== '') {
      srsChapter = rsSrs.chapter
      srsDesc = rsSrs.desc
    } else if (c) {
      srsChapter = c.srsChapter
      srsDesc = c.srsDesc
    } else {
      srsChapter = '/'
      srsDesc = '/'
    }
    cellsList.push([
      String(cellsList.length + 1),
      srsChapter,
      srsDesc,
      c ? c.chapter : '',
      c ? c.itemName : '',
      c ? c.itemItemId : '',
      rc.caseChapter,
      rc.caseName,
      rc.caseId
    ])
  }
  const rows: TraceRowVM[] = cellsList.map(cells => ({ cells: cells, span: cells.map(() => 1) }))
  applyVmerge(rows, MERGE_COLS.returnSpec)
  return { type: 'returnSpec', heads: HEADS_RETURNSPEC, rows: rows }
}

/** 四类追踪表构建统一入口 */
export function buildTraceTable(input: TraceBuildInput, issues: IssueCollector): TraceTable {
  // 排除用例不入表（与工具一口径一致）
  const cases = input.outlineCases.filter(c => !c.excluded)
  switch (input.type) {
    case 'outline':
      return buildOutlineTable(cases)
    case 'spec':
      return buildSpecTable(cases)
    case 'report': {
      if (!input.records || input.records.length === 0) {
        throw new Error('报告追踪需要测试记录解析结果')
      }
      return buildReportTable(input.records, cases, issues)
    }
    case 'returnSpec': {
      if (!input.returnSpec) {
        throw new Error('回归说明追踪需要回归说明解析结果')
      }
      return buildReturnSpecTable(input.returnSpec, cases, issues)
    }
  }
}
