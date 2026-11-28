/**
 * 四类追踪表构建（12-追踪文档工具 v2）。
 * 大纲 → 大纲追踪表（6 列）/ 说明追踪表（8 列）；
 * 测试记录 + 大纲 → 报告追踪表（13 列，标识对齐补需求列）；
 * 回归说明 + 大纲 → 回归说明追踪表（9 列）。
 * 全部走统一 TraceTable 模型（双层表头 + vmerge）。
 */
import type { CaseRow } from '../convert/rows.ts'
import type { RecordCase } from '../parse/record.ts'
import type { ReturnSpecData } from '../parse/returnspec.ts'
import { applyVmerge, type TraceTable, type TraceRowVM, type TraceHeadGroup } from './table.ts'
import { segDropVariants } from '../regress/build.ts'
import type { IssueCollector } from '../domain.ts'

export interface TraceBuildInput {
  type: 'outline' | 'spec' | 'report' | 'returnSpec'
  /** 大纲侧用例行（outline/spec 直接推导；report/returnSpec 按用例标识对齐） */
  outlineCases?: CaseRow[]
  /** 说明文档解析结果：spec 表的主源（SRS 留空）或 report 的对齐源（自动识别后与 outlineCases 二选一） */
  specAlign?: ReturnSpecData
  /** 测试记录解析结果（report） */
  records?: RecordCase[]
  /** 回归说明解析结果（returnSpec） */
  returnSpec?: ReturnSpecData
}

/**
 * 大纲追踪表表头（2026-10-10 改版，对照说明追踪表补齐章节名称块）：
 * 基形 7 列：序号 | 软件需求规格说明[章节号|章节名称] | 软件测试大纲[大纲章节号|测试项名称|测试项标识] | 备注
 * 大纲里任一测试项解析出研制任务书信息 → 前面插入任务书块（9 列形态），全部没有 → 任务书块整块省略。
 */
/** 大纲追踪表表头（2026-11-28 全量列超集：+系统规格说明块、大纲块+测试类型；默认列配置=旧 7 列形态） */
export const HEADS_OUTLINE: TraceHeadGroup[] = [
  { group: '', cols: ['序号'] },
  { group: '系统规格说明', cols: ['章节号', '章节名称'] },
  { group: '软件需求规格说明', cols: ['章节号', '章节名称'] },
  { group: '软件测试大纲', cols: ['大纲章节号', '测试项名称', '测试项标识', '测试类型'] },
  { group: '', cols: ['备注'] }
]

/** 大纲-含任务书表头（全量超集 12 列；默认列配置=旧 9 列形态） */
export const HEADS_OUTLINE_TASK: TraceHeadGroup[] = [
  { group: '', cols: ['序号'] },
  { group: '软件研制任务书', cols: ['章节号', '章节名称'] },
  { group: '系统规格说明', cols: ['章节号', '章节名称'] },
  { group: '软件需求规格说明', cols: ['章节号', '章节名称'] },
  { group: '软件测试大纲', cols: ['大纲章节号', '测试项名称', '测试项标识', '测试类型'] },
  { group: '', cols: ['备注'] }
]

/** 说明追踪表表头（测试说明「需求的可追踪性」，8 列） */
export const HEADS_SPEC: TraceHeadGroup[] = [
  { group: '', cols: ['序号'] },
  { group: '软件需求规格说明', cols: ['章节号', '章节描述'] },
  { group: '软件测试大纲', cols: ['大纲章节号', '测试项名称', '测试项标识'] },
  { group: '测试用例', cols: ['测试用例名称', '测试用例标识'] }
]

/** 报告追踪表表头（报告附件2「软件满足软件需求规格说明对照表」，13 列：
 *  2026-11-27 同事反馈加系统规格说明块，文档链 = 系统规格说明 → 需求规格说明 → 测评大纲 → 用例） */
export const HEADS_REPORT: TraceHeadGroup[] = [
  { group: '', cols: ['序号'] },
  { group: '系统规格说明', cols: ['章节号', '章节名称'] },
  { group: '软件需求规格说明', cols: ['章节号', '章节描述'] },
  { group: '测评大纲', cols: ['章节号', '测试项名称', '测试项标识', '测试类型'] },
  { group: '测试用例', cols: ['测试用例标识', '名称', '执行结果'] },
  { group: '', cols: ['备注'] }
]

/** 回归说明追踪表表头（2026-11-28 全量列超集 12 列：+系统规格说明块、测评大纲块+测试类型；默认列配置=旧 9 列形态） */
export const HEADS_RETURNSPEC: TraceHeadGroup[] = [
  { group: '', cols: ['序号'] },
  { group: '系统规格说明', cols: ['章节号', '章节名称'] },
  { group: '软件需求规格说明', cols: ['章节号', '章节描述'] },
  { group: '测评大纲', cols: ['大纲章节号', '测试项名称', '测试项标识', '测试类型'] },
  { group: '测试用例', cols: ['用例章节号', '测试用例名称', '测试用例标识'] }
]

/** 每类表的纵向合并列（vmerge 组；空数组 = 不合并） */
export const MERGE_COLS: Record<TraceTable['type'], number[]> = {
  outline: [],
  spec: [1, 2, 3, 4, 5],
  report: [1, 2, 3, 4, 5, 6, 7, 8],
  returnSpec: [1, 2, 3, 4, 5, 6, 7, 8]
}

/** 各类表的模板占位符变量名（与 模板/追踪-*.docx 循环行一一对应，也用于 rows→渲染对象转换）；
 * 大纲表按形态二选一（7 列无任务书 / 9 列含任务书，服务端按行列数分派） */
export const TYPE_VARS: Record<Exclude<TraceTable['type'], 'outline'>, string[]> = {
  spec: ['no', 'srsChapter', 'srsDesc', 'outlineChapter', 'itemName', 'itemItemId', 'caseName', 'caseId'],
  report: ['no', 'sysChapter', 'sysName', 'srsChapter', 'srsDesc', 'outlineChapter', 'itemName', 'itemItemId', 'typeName', 'caseId', 'caseName', 'result', 'remark'],
  returnSpec: ['no', 'sysChapter', 'sysName', 'srsChapter', 'srsDesc', 'outlineChapter', 'itemName', 'itemItemId', 'typeName', 'caseChapter', 'caseName', 'caseId']
}

export const OUTLINE_VARS: string[] = ['no', 'sysChapter', 'sysName', 'srsChapter', 'srsName', 'outlineChapter', 'itemName', 'itemItemId', 'typeName', 'remark']
export const OUTLINE_TASK_VARS: string[] = ['no', 'taskBookChapter', 'taskBookName', 'sysChapter', 'sysName', 'srsChapter', 'srsName', 'outlineChapter', 'itemName', 'itemItemId', 'typeName', 'remark']

/** 各类表的渲染模板（四套双层表头模板，12-追踪文档工具 v2）；大纲表按形态二选一（见 apiTraceGenerate） */
export const TRACE_TEMPLATE_NAMES: Record<Exclude<TraceTable['type'], 'outline'>, string> = {
  spec: '追踪-说明模板.docx',
  report: '追踪-报告模板.docx',
  returnSpec: '追踪-回归模板.docx'
}

export const OUTLINE_TEMPLATE = '追踪-大纲模板.docx'
export const OUTLINE_TASK_TEMPLATE = '追踪-大纲-含任务书模板.docx'

/** SRS 章节号/描述的展示值：'/'或空 → 大纲附件2 语境用 '--' */
function srsDash(v: string): string {
  return v === '/' || v === '' ? '--' : v
}

/** 系统规格说明章节号/名称的展示值：与 SRS 同规则（'/'或空 → '--'） */
function sysDash(v: string): string {
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

/** 任务书列展示值：空或'/' → '--'（与 SRS 同规则） */
function tbDash(v: string): string {
  return v === '/' || v === '' ? '--' : v
}

/**
 * 大纲追踪表（2026-10-10 改版，每测试项一行；2026-11-28 全量列超集）：
 * SRS/系统规格说明章节号/名称取追踪关系行解析值（无对应 '--'）；大纲块 = 大纲章节号+测试项名称+测试项标识+测试类型；
 * 研制任务书块仅当任一测试项解析出任务书信息才出现（全部没有 → 整块省略，10 列形态）。
 * 默认列配置 = 旧形态（无系统规格说明块、无测试类型）；列显隐/顺序由前端列配置层控制。
 */
function buildOutlineTable(cases: CaseRow[]): TraceTable {
  const items = outlineItemRows(cases)
  const hasTask = items.some(c => {
    const ch = c.taskBookChapter ?? '/'
    const nm = c.taskBookName ?? '/'
    return (ch !== '/' && ch !== '') || (nm !== '/' && nm !== '')
  })
  const cellsList = items.map((c, i) =>
    hasTask
      ? [String(i + 1), tbDash(c.taskBookChapter ?? '/'), tbDash(c.taskBookName ?? '/'),
         sysDash(c.sysChapter), sysDash(c.sysName), srsDash(c.srsChapter), srsDash(c.srsDesc),
         c.chapter, c.itemName, c.itemItemId, c.typeName, '/']
      : [String(i + 1), sysDash(c.sysChapter), sysDash(c.sysName),
         srsDash(c.srsChapter), srsDash(c.srsDesc), c.chapter, c.itemName, c.itemItemId, c.typeName, '/']
  )
  const rows: TraceRowVM[] = cellsList.map(cells => ({ cells: cells, span: cells.map(() => 1) }))
  return {
    type: 'outline',
    heads: hasTask ? HEADS_OUTLINE_TASK : HEADS_OUTLINE,
    rows: rows,
    vars: hasTask ? OUTLINE_TASK_VARS : OUTLINE_VARS
  }
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
  return { type: 'spec', heads: HEADS_SPEC, rows: rows, vars: TYPE_VARS.spec }
}

/** 用例标识的对比基形：去尾部序号（YL_DC_001 → YL_DC）——记录/回归说明多用老工具的无序号写法 */
function baseOf(caseId: string): string {
  return caseId.replace(/_\d+$/, '')
}

/** 对齐源条目：按用例标识取"对齐文档侧"的信息（大纲源全有、说明源 SRS/系统规格说明空） */
interface AlignEntry {
  /** 源用例标识（落位提示消息用） */
  caseId: string
  sysChapter: string
  sysName: string
  srsChapter: string
  srsDesc: string
  chapter: string
  itemName: string
  itemItemId: string
  typeName: string
  /** 用例名（删段对齐多候选时按它消歧） */
  caseName: string
  /** 用例级标识（大纲用例标题（XQ_IO_RWGL_IO01）派生硬键用；说明源没有 → ''） */
  itemId: string
}

/** 标识键归一：剥零宽字符与首尾空白（matchRow 的 normId 同口径，工具二自己的防线） */
const normKey = (s: string): string =>
  s.replace(/[\u200b-\u200d\u2060]/g, '').trim()
    .replace(/[\uff21-\uff3a\uff41-\uff5a\uff10-\uff19\uff3f]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/-/g, '_')

/** 说明（ReturnSpecData）→ 对齐索引：大纲侧信息取用例表追踪关系行，SRS/系统规格说明里没有 → 留空 */
function alignIndexOfSpec(rs: ReturnSpecData): AlignIdx {
  const exact = new Map<string, AlignEntry[]>()
  const base = new Map<string, AlignEntry[]>()
  const byItemId = new Map<string, AlignEntry[]>()
  const byItemName = new Map<string, AlignEntry[]>()
  for (const c of rs.cases) {
    if (c.caseId === '') continue
    const entry: AlignEntry = {
      caseId: c.caseId,
      sysChapter: '',
      sysName: '',
      srsChapter: '',
      srsDesc: '',
      chapter: c.traceChapter,
      itemName: c.traceItemName,
      itemItemId: c.traceItemId,
      typeName: c.typeName,
      caseName: c.caseName,
      itemId: ''
    }
    const id = normKey(c.caseId)
    ;(exact.get(id) ?? exact.set(id, []).get(id)!).push(entry)
    const b = baseOf(id)
    ;(base.get(b) ?? base.set(b, []).get(b)!).push(entry)
    const iid = normKey(c.traceItemId)
    if (iid !== '') (byItemId.get(iid) ?? byItemId.set(iid, []).get(iid)!).push(entry)
    if (c.traceItemName !== '') (byItemName.get(c.traceItemName) ?? byItemName.set(c.traceItemName, []).get(c.traceItemName)!).push(entry)
  }
  return { exact: exact, base: base, byItemId: byItemId, byItemName: byItemName }
}

/** 对齐索引统一形态（大纲源与说明源共用；多值保留同标识/同基形的全行，供按用例名消歧）；
 *  byItemId/byItemName = 测试项级索引（记录追踪行的测试需求标识/名称兜底用） */
type AlignIdx = { exact: Map<string, AlignEntry[]>; base: Map<string, AlignEntry[]>; byItemId: Map<string, AlignEntry[]>; byItemName: Map<string, AlignEntry[]> }

/** 大纲 cases → 对齐索引（系统规格说明/SRS/大纲章节号/项名/项标识/类型全有） */
function rowsToAlign(cases: CaseRow[]): AlignIdx {
  const exact = new Map<string, AlignEntry[]>()
  const base = new Map<string, AlignEntry[]>()
  const byItemId = new Map<string, AlignEntry[]>()
  const byItemName = new Map<string, AlignEntry[]>()
  for (const c of cases) {
    const entry: AlignEntry = {
      caseId: c.caseId,
      sysChapter: c.sysChapter,
      sysName: c.sysName,
      srsChapter: c.srsChapter,
      srsDesc: c.srsDesc,
      chapter: c.chapter,
      itemName: c.itemName,
      itemItemId: c.itemItemId,
      typeName: c.typeName,
      caseName: c.mingcheng,
      itemId: c.itemId
    }
    const id = normKey(c.caseId)
    ;(exact.get(id) ?? exact.set(id, []).get(id)!).push(entry)
    const b = baseOf(id)
    ;(base.get(b) ?? base.set(b, []).get(b)!).push(entry)
    const iid = normKey(c.itemItemId)
    if (iid !== '') (byItemId.get(iid) ?? byItemId.set(iid, []).get(iid)!).push(entry)
    if (c.itemName !== '') (byItemName.get(c.itemName) ?? byItemName.set(c.itemName, []).get(c.itemName)!).push(entry)
  }
  return { exact: exact, base: base, byItemId: byItemId, byItemName: byItemName }
}

/** 记录用例名剥尾部序号（同事口径：一个子项可写多张用例表，「…功能测试1」～「…测试14」同指一个大纲用例）。
 *  前一字符须是汉字，防误剥 IPv6/MD5 之类以数字结尾的专名。 */
const stripTailNum = (n: string): string => {
  const s = n.replace(/\s+/g, '')
  const m = /^(.*[一-鿿])\d{1,3}$/.exec(s)
  return m !== null ? m[1] : s
}

/** 对齐取值路由：direct/seg = 精确与删段强证据（硬键/单候选/用例名/同段码收窄）；segName = 剥尾部序号的用例名；
 *  segOrd = 子项号序数（猜测性）；item* = 记录追踪行测试项兜底（类型码不同等形态）。调用方按路由聚合提示。 */
export type AlignRoute = 'direct' | 'seg' | 'segName' | 'segOrd' | 'itemSingle' | 'itemName' | 'itemStrip' | 'itemOrd'

/** 对齐取值：精确 → 去尾号 → 删一段子项号（2026-11-27 同事形态 YL_IO_RWGL_IO01_001 ↔ 大纲 YL_IO_RWGL_001）。
 *  删段候选必须全落同一个大纲基形（跨多个基形 = 歧义不猜）；落位优先级与 matchRow 同款：
 *  用例级子项标识硬键（XQ_IO_RWGL_IO01 派生）→ 用例名 → 剥尾部序号用例名 → 子项号序数（IO01=该测试项第1个用例，
 *  同一子项多张用例表尾号不限 001）。seg 候选跨测试项撞码时按记录追踪行的测试项名称收窄到唯一项。
 *  caseId 路线全断（记录类型码与大纲不同：YL_DC3_001 ↔ YL_DC_001）→ 测试项级兜底：记录追踪行的测试项标识
 *  或名称定位唯一大纲测试项，项内按 单例 → 名称 → 剥序号名 → 子项号序数 落位。 */
function alignGetEx(idx: AlignIdx, rec: { caseId: string; caseName: string; traceItemId?: string; traceItemName?: string }): { entry: AlignEntry; via: AlignRoute } | undefined {
  const id = normKey(rec.caseId)
  const direct = idx.exact.get(id) ?? idx.base.get(baseOf(id))
  if (direct !== undefined && direct.length > 0) return { entry: direct[0], via: 'direct' }
  const b = baseOf(id)
  const cands: AlignEntry[] = []
  let bases = 0
  let droppedSeg = ''
  for (const { variant, dropped } of segDropVariants(b)) {
    const es = idx.base.get(variant)
    if (es === undefined || es.length === 0) continue
    bases++
    if (droppedSeg === '') droppedSeg = dropped
    for (const e of es) if (!cands.includes(e)) cands.push(e)
  }
  if (cands.length > 0 && bases === 1) {
    // 大纲两项共用同段码（撞号跨项）→ 记录追踪行的测试项名称收窄；收不窄（同名项不存在/仍跨项）
    // → seg 放弃但继续 item 兜底（回退首行会把记录记到撞码项头上，2026-11-28 高速检索实证）
    let pool = cands
    let segAbort = false
    if (rec.traceItemName !== undefined && rec.traceItemName !== '' && new Set(cands.map(e => e.itemItemId + '\u0000' + e.chapter)).size > 1) {
      const scoped = cands.filter(e => e.itemName === rec.traceItemName)
      if (scoped.length === 0 || new Set(scoped.map(e => e.itemItemId + '\u0000' + e.chapter)).size !== 1) segAbort = true
      else pool = scoped
    }
    if (!segAbort) {
      if (pool.length === 1) return { entry: pool[0], via: 'seg' }
      const hard = pool.filter(e => 'YL_' + e.itemId.replace(/^XQ_/, '') === b)
      if (hard.length === 1) return { entry: hard[0], via: 'seg' }
      const byName = pool.filter(e => e.caseName.replace(/\s+/g, '') === rec.caseName.replace(/\s+/g, ''))
      if (byName.length === 1) return { entry: byName[0], via: 'seg' }
      const st = pool.filter(e => e.caseName.replace(/\s+/g, '') === stripTailNum(rec.caseName))
      if (st.length === 1) return { entry: st[0], via: 'segName' }
      // 子项号序数兜底（猜测性落位）：候选须同项同章、序数在范围内
      const ordN = parseInt(/(\d{1,3})$/.exec(droppedSeg)?.[1] ?? '0', 10)
      if (ordN >= 1 && ordN <= pool.length && new Set(pool.map(e => e.itemItemId + '\u0000' + e.chapter)).size === 1) {
        return { entry: pool[ordN - 1], via: 'segOrd' }
      }
      return undefined
    }
  }
  return alignItemFallback(idx, rec, b)
}

/** 测试项级兜底（caseId 路线全断，含 seg 收窄失败跳入）：追踪行测试项标识精确 → 测试项名称
 *  （精确 → 双向包含 ≥3 字，2026-11-28 ELJG 实证：记录少写「功能」二字）唯一落在一个大纲测试项，
 *  项内四层落位（单例 → 名称 → 剥序号名 → 序数）。 */
function alignItemFallback(idx: AlignIdx, rec: { caseId: string; caseName: string; traceItemId?: string; traceItemName?: string }, b: string): { entry: AlignEntry; via: AlignRoute } | undefined {
  let use: AlignEntry[] | undefined
  if (rec.traceItemId !== undefined && rec.traceItemId !== '') use = idx.byItemId.get(normKey(rec.traceItemId))
  if (use === undefined && rec.traceItemName !== undefined && rec.traceItemName !== '') {
    const es = idx.byItemName.get(rec.traceItemName)
    if (es !== undefined && new Set(es.map(e => e.itemItemId + '\u0000' + e.chapter)).size === 1) {
      use = es
    } else {
      const hit = (x: string, y: string): boolean => {
        const a = x.replace(/\s+/g, '')
        const c = y.replace(/\s+/g, '')
        return a.length >= 3 && c.length >= 3 && (a.includes(c) || c.includes(a))
      }
      const inAll: AlignEntry[] = []
      for (const es2 of idx.byItemName.values()) {
        if (es2.length > 0 && hit(es2[0].itemName, rec.traceItemName)) inAll.push(...es2)
      }
      if (inAll.length > 0 && new Set(inAll.map(e => e.itemItemId + '\u0000' + e.chapter)).size === 1) use = inAll
    }
  }
  if (use === undefined || use.length === 0) return undefined
  if (use.length === 1) return { entry: use[0], via: 'itemSingle' }
  const byName = use.filter(e => e.caseName.replace(/\s+/g, '') === rec.caseName.replace(/\s+/g, ''))
  if (byName.length === 1) return { entry: byName[0], via: 'itemName' }
  const st = use.filter(e => e.caseName.replace(/\s+/g, '') === stripTailNum(rec.caseName))
  if (st.length === 1) return { entry: st[0], via: 'itemStrip' }
  const ordN = parseInt(/([A-Za-z]+)(\d{1,3})$/.exec(b.split('_').slice(-1)[0] ?? '')?.[2] ?? '0', 10)
  if (ordN >= 1 && ordN <= use.length) return { entry: use[ordN - 1], via: 'itemOrd' }
  return undefined
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
 * 报告追踪表（13 列）：记录解析结果 + 对齐源（大纲 cases 或说明文档解析，自动识别后二选一）按用例标识对齐。
 * 系统规格说明/SRS/大纲章节号/项名/项标识/测试类型来自对齐源（记录里没有）；
 * 用例名/步骤范围/执行结果/备注来自记录。对不上的行需求列留空 + 告警，不拦截。
 * 系统规格说明与 SRS 两块仅在配对大纲时有值——说明作源时说明文档里没有，留空人工补。
 */
function buildReportTable(records: RecordCase[], align: AlignIdx, issues: IssueCollector): TraceTable {
  const cellsList: string[][] = []
  const segN: string[] = []
  const segNameN: string[] = []
  const segOrdN: string[] = []
  const itemN: string[] = []
  for (const rec of records) {
    const c = rec.caseId === '' ? undefined : alignGetEx(align, rec)
    if (rec.caseId !== '' && c === undefined) {
      issues.warning(
        'TRACE_ALIGN_MISS',
        '用例「' + rec.caseName + '」（' + rec.caseId + '）未在配对文档中找到对应项，需求列留空，请人工补齐',
        rec.caseName
      )
    }
    if (c !== undefined) {
      if (c.via === 'seg') segN.push('「' + rec.caseId + '」→ 测试项「' + c.entry.itemName + '」')
      else if (c.via === 'segName') segNameN.push('「' + rec.caseName + '」（' + rec.caseId + '）')
      else if (c.via === 'segOrd') segOrdN.push('「' + rec.caseId + '」→ ' + c.entry.caseId + '（测试项「' + c.entry.itemName + '」）')
      else if (c.via !== 'direct') itemN.push('「' + rec.caseId + '」→ 测试项「' + c.entry.itemName + '」（' + c.entry.caseId + '）')
    }
    cellsList.push([
      String(cellsList.length + 1),
      c ? c.entry.sysChapter : '',
      c ? c.entry.sysName : '',
      c ? c.entry.srsChapter : '',
      c ? c.entry.srsDesc : '',
      c ? c.entry.chapter : '',
      c ? c.entry.itemName : '',
      c ? c.entry.itemItemId : '',
      c ? c.entry.typeName : '',
      rec.caseId,
      rec.caseName,
      deriveResult(rec),
      deriveRemark(rec)
    ])
  }
  if (segN.length > 0) {
    issues.info('TRACE_MATCH_BY_SEG', segN.length + ' 个用例标识比配对文档多一段子项号（如「' + segN[0] + '），已自动对应', '用例标识')
  }
  if (segNameN.length > 0) {
    issues.info('TRACE_MATCH_BY_SEGNAME', segNameN.length + ' 个用例名带尾部序号（如' + segNameN[0] + '），已按去序号后的用例名自动对应，请抽查', '用例标识')
  }
  if (segOrdN.length > 0) {
    issues.info('TRACE_MATCH_BY_SEGORD', segOrdN.length + ' 个用例按子项号序数对应（如「' + segOrdN[0] + '），猜测性落位请人工核对', '用例标识')
  }
  if (itemN.length > 0) {
    issues.info('TRACE_MATCH_BY_ITEM', itemN.length + ' 个用例标识的类型码与配对文档不同（如「' + itemN[0] + '），已按记录追踪行的测试项名称自动对应，请抽查', '用例标识')
  }
  const rows: TraceRowVM[] = cellsList.map(cells => ({ cells: cells, span: cells.map(() => 1) }))
  applyVmerge(rows, MERGE_COLS.report)
  return { type: 'report', heads: HEADS_REPORT, rows: rows, vars: TYPE_VARS.report, editableCol: 11 }
}

/**
 * 回归说明追踪表（9 列）：回归说明 + 大纲 cases 按用例标识对齐。
 * 大纲章节号/项名/项标识来自大纲（回归说明自己的编号是另一套 6.1.x）；
 * SRS 优先用回归说明测试项表追踪关系行的解析值（回归文档自己的更准），空时兜底大纲的；
 * 用例章节号 = 回归说明里用例表所在标题的编号。
 */
function buildReturnSpecTable(rs: ReturnSpecData, outlineCases: CaseRow[], issues: IssueCollector): TraceTable {
  const idx = rowsToAlign(outlineCases)
  // 回归说明测试项表的 SRS 按项标识备用（用例行对不上大纲时兜底）
  const srsByItem = new Map<string, { chapter: string; desc: string }>()
  for (const it of rs.items) {
    if (it.itemId !== '' && !srsByItem.has(it.itemId)) {
      srsByItem.set(it.itemId, { chapter: it.srsChapter, desc: it.srsDesc })
    }
  }
  const cellsList: string[][] = []
  for (const rc of rs.cases) {
    const c = rc.caseId === '' ? undefined : alignGetEx(idx, rc)?.entry
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
    // SRS：回归说明自己的解析值优先；系统规格说明回归文档里没有 → 大纲对齐值的 '/' 兜底
    let sysChapter = c ? c.sysChapter : '/'
    let sysName = c ? c.sysName : '/'
    cellsList.push([
      String(cellsList.length + 1),
      sysDash(sysChapter),
      sysDash(sysName),
      srsChapter,
      srsDesc,
      c ? c.chapter : '',
      c ? c.itemName : '',
      c ? c.itemItemId : '',
      c ? c.typeName : '/',
      rc.caseChapter,
      rc.caseName,
      rc.caseId
    ])
  }
  const rows: TraceRowVM[] = cellsList.map(cells => ({ cells: cells, span: cells.map(() => 1) }))
  applyVmerge(rows, MERGE_COLS.returnSpec)
  return { type: 'returnSpec', heads: HEADS_RETURNSPEC, rows: rows, vars: TYPE_VARS.returnSpec }
}

/**
 * 说明追踪表（8 列）的说明文档源变体：SRS 两列说明里没有 → 留空人工补；
 * 大纲章节号/项名/项标识取用例表追踪关系行解析值，vmerge 按"非空列"合并
 * （SRS 全空 → 按大纲章节号+项名+项标识整块合并）。
 */
function buildSpecTableFromSpec(rs: ReturnSpecData, issues: IssueCollector): TraceTable {
  const cellsList: string[][] = []
  for (const rc of rs.cases) {
    if (rc.caseId === '') {
      issues.warning('TRACE_CASE_NO_ID', '用例「' + rc.caseName + '」没有标识，需求列将留空', rc.caseName)
    }
    cellsList.push([
      String(cellsList.length + 1),
      '',
      '',
      rc.traceChapter,
      rc.traceItemName,
      rc.traceItemId,
      rc.caseName,
      rc.caseId
    ])
  }
  const rows: TraceRowVM[] = cellsList.map(cells => ({ cells: cells, span: cells.map(() => 1) }))
  applyVmerge(rows, MERGE_COLS.spec)
  return { type: 'spec', heads: HEADS_SPEC, rows: rows, vars: TYPE_VARS.spec }
}

/** 四类追踪表构建统一入口 */
export function buildTraceTable(input: TraceBuildInput, issues: IssueCollector): TraceTable {
  // 排除用例不入表（与工具一口径一致；说明源无编辑存档概念，全量入表）
  const cases = (input.outlineCases ?? []).filter(c => !c.excluded)
  switch (input.type) {
    case 'outline':
      return buildOutlineTable(cases)
    case 'spec':
      // 说明文档作源（自动识别后）：SRS 留空，追踪关系取自说明用例表
      if (input.specAlign) return buildSpecTableFromSpec(input.specAlign, issues)
      return buildSpecTable(cases)
    case 'report': {
      if (!input.records || input.records.length === 0) {
        throw new Error('报告追踪需要测试记录解析结果')
      }
      // 对齐源二选一：大纲（SRS 自动）或说明文档（SRS 留空）——服务端自动识别后必传其一
      const align = input.outlineCases !== undefined ? rowsToAlign(cases) : alignIndexOfSpec(input.specAlign ?? { items: [], cases: [] })
      return buildReportTable(input.records, align, issues)
    }
    case 'returnSpec': {
      if (!input.returnSpec) {
        throw new Error('回归说明追踪需要回归说明解析结果')
      }
      return buildReturnSpecTable(input.returnSpec, cases, issues)
    }
  }
}
