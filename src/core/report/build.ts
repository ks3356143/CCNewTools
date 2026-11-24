/**
 * 工具四「报告统计与需求符合性」核心（SRS/设计/14）：
 * 大纲 + 首轮测试记录 +（可选）回归测试记录 → 报告批注位置渲染数据。
 * v2（2026-11-22 用户七点反馈）：
 *  ① 用例数口径 = 大纲/记录用例表的**步骤行数**（每个步骤行算一个用例）；
 *  ② 静态类型 = 文档审查/静态分析/代码审查/代码走查，其余为动态测试（2.2.4.4.1 与表26 只算动态）；
 *  ③ 2.1 综述问题按首轮不通过统计：总数 = 首轮不通过步骤行数，等级按「一般问题」、类型按「其他问题」
 *     默认归类（记录问题单无等级/类型字段，出告警请人工核对）；
 *  ④ 表38 列4 = 首轮记录用例的「期望结果与评估标准」文字（不含图片，解析层只读文字）；
 *     首轮有不通过的行写「经过测试符合要求」（不写未通过），界面提示尽量上传回归记录；
 *  ⑤ 表26 按动态类型逐行统计 + 小计；表33/34 按上述默认归类填数。
 */
import type { ParsedOutline, GlobalParams, Issue } from '../domain.ts'
import { IssueCollector } from '../domain.ts'
import { convertToTemplateData } from '../convert/index.ts'
import type { CaseRow } from '../convert/rows.ts'
import type { RecordCase } from '../parse/record.ts'
import { FAIL_RE, matchRow } from '../regress/build.ts'

/** 用户定义的静态测试类型（2026-11-22 拍板），其余全部按动态测试统计 */
export const STATIC_TYPES = new Set(['文档审查', '静态分析', '代码审查', '代码走查'])

/** 表38 一行 */
export interface ConfRow {
  no: number
  /** 功能性能指标来源：大纲「追踪关系」格原文 */
  source: string
  /** 功能性能指标：大纲「需求描述」格原文（过长截断） */
  metric: string
  /** 测评结果及符合情况：首轮通过的记录文字；首轮有不通过 → 「经过测试符合要求」 */
  result: string
}

/** 表26 一行（动态测试类型；用例数 = 步骤行数） */
export interface T26Row {
  t26Type: string
  t26Total: number
  t26Exec: number
  t26Unexec: number
  t26Pass: number
  t26Fail: number
}

/** 结果页统计数目文字展示（用户拍板"统计不仅生成文档，结果页面还要有数目文字"） */
export interface ConfStats {
  /** 大纲测试项（需求条目）数 = 表38 行数 */
  items: number
  /** 大纲用例表数与步骤行数（步骤行 = 用例） */
  outlineCases: number
  outlineSteps: number
  recordCases: number
  /** 首轮执行/不通过步骤行数 */
  executedSteps: number
  failedSteps: number
  /** 回归记录用例表数（0 = 未上传）与回归归零/遗留步骤数 */
  regCases: number
  regZero: number
  regLeft: number
  /** 表38 判定（按需求项） */
  firstPass: number
  regPass: number
  firstFail: number
  regFail: number
  untested: number
}

export interface ConfData {
  rows: ConfRow[]
  t26Rows: T26Row[]
  /** 段落统计与表33/34 单元格变量（docxtemplater 直接取值） */
  vars: Record<string, string | number>
  stats: ConfStats
  issues: Issue[]
}

/** 测试项键：标识 + 章节号双键（与工具三撞号处理同约定） */
const keyOf = (itemId: string, chapter: string): string => itemId + '\0' + chapter

/** 一轮记录按容差匹配挂到大纲转换行：按测试项聚合判定 + 按类型聚步骤数 */
interface RoundAgg {
  /** 项键 → 未通过用例 caseId 集合（用例=步骤行，未通过步骤行数另计） */
  failedCases: Map<string, Set<string>>
  passedCases: Map<string, Set<string>>
  /** 未通过步骤行数（按类型分桶） */
  failStepsByType: Map<string, number>
  /** 执行步骤行数（按类型分桶；「通过与否」列非空即执行） */
  execStepsByType: Map<string, number>
  /** 通过步骤行数（按类型分桶） */
  passStepsByType: Map<string, number>
  /** 项键 → 各用例的记录文字（步骤期望结果，表38 列4） */
  caseExpects: Map<string, string[]>
  matched: number
}

/** 一轮记录按容差匹配挂到大纲转换行：按测试项聚合判定 + 按类型聚步骤数。
 *  智能漂移消歧（2026-11-22 用户"把程序做智能点"）：记录表标识配到的项名与记录追踪名对不上、
 *  而按「追踪项名 + 用例名」能唯一锁定另一行时，重定位过去并出告警——大纲改版改名/改号的形态。 */
function aggregate(
  rows: CaseRow[],
  records: RecordCase[],
  itemByKey: Map<string, ParsedOutline['items'][number]>,
  issues: IssueCollector
): RoundAgg {
  const agg: RoundAgg = {
    failedCases: new Map(), passedCases: new Map(),
    failStepsByType: new Map(), execStepsByType: new Map(), passStepsByType: new Map(),
    caseExpects: new Map(), matched: 0
  }
  /** 项名与追踪名归一比对：去空白后互含（关键词检索 ↔ 关键词检索测试项），长度 ≥3 防误配 */
  const nameHit = (itemName: string, traceName: string): boolean => {
    const a = itemName.replace(/\s+/g, '')
    const b = traceName.replace(/\s+/g, '')
    return a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a))
  }
  for (const rec of records) {
    const m = matchRow(rows, rec)
    if (m === null) continue
    let row = m.row
    let relocated = false
    if (rec.traceItemName !== '') {
      const matchedItem = itemByKey.get(keyOf(m.row.itemItemId, m.row.chapter))
      // 标识配到的项与追踪名不符 → 全大纲找「项名=追踪名 且 用例名=记录用例名」的唯一行，重定位
      if (matchedItem !== undefined && !nameHit(matchedItem.name, rec.traceItemName)) {
        const cands = rows.filter(r => {
          if (r.mingcheng.replace(/\s+/g, '') !== rec.caseName.replace(/\s+/g, '')) return false
          const it = itemByKey.get(keyOf(r.itemItemId, r.chapter))
          return it !== undefined && nameHit(it.name, rec.traceItemName)
        })
        if (cands.length === 1) {
          const toItem = itemByKey.get(keyOf(cands[0].itemItemId, cands[0].chapter))!
          issues.info('REPORT_MATCH_BY_NAME',
            '记录表 ' + rec.caseId + '（' + rec.caseName + '）标识指向测试项「' + matchedItem.name + '」但追踪名为「' + rec.traceItemName +
            '」，已按追踪名+用例名重定位到「' + toItem.name + '」（' + cands[0].caseId + '）——大纲可能改版改号，请人工核对')
          row = cands[0]
          relocated = true
        }
      }
    }
    // 撞号消歧回退（2026-11-24 同事反馈排查出的静默盲区）：名称对不上且未重定位 → 结果记到回退行头上，
    // 被挤掉的那个项会凭空「未测试」，必须点名请人工核对（工具三 REGRESS_DUP_CASEID 的对等口径）
    if (!relocated && m.baseCount > 1 && !m.byName) {
      // CaseRow.itemName 是挂载标题而非表内项名（真实大纲恰好同名，合成夹具才见分野）——取解析层项名最准
      const firstName = itemByKey.get(keyOf(m.row.itemItemId, m.row.chapter))?.name ?? m.row.itemName
      issues.warning('REPORT_DUP_CASEID',
        '记录表 ' + rec.caseId + '（' + rec.caseName + '）的标识在大纲中有 ' + m.baseCount + ' 行且用例名称对不上，已按第一行（' + firstName + '）处理，请人工核对章节归属——其余同标识测试项可能因此显示「未测试」',
        rec.caseName)
    }
    agg.matched++
    const key = keyOf(row.itemItemId, row.chapter)
    const failed = rec.stepResults.some(s => FAIL_RE.test(s))
    const bucket = failed ? agg.failedCases : agg.passedCases
    if (!bucket.has(key)) bucket.set(key, new Set())
    bucket.get(key)!.add(row.caseId)
    // 步骤行口径：非空判定 = 执行；未通过判定 = 不通过用例
    const exec = rec.stepResults.filter(s => s.trim() !== '').length
    const fail = rec.stepResults.filter(s => FAIL_RE.test(s)).length
    const type = row.typeName
    agg.execStepsByType.set(type, (agg.execStepsByType.get(type) ?? 0) + exec)
    agg.failStepsByType.set(type, (agg.failStepsByType.get(type) ?? 0) + fail)
    agg.passStepsByType.set(type, (agg.passStepsByType.get(type) ?? 0) + (exec - fail))
    // 记录文字：步骤的期望结果与评估标准（无该列的旧格式 → 空串，后续回退判定词）
    const exp = rec.stepExpects.map(s => s.trim()).filter(s => s !== '')
    if (exp.length > 0) {
      if (!agg.caseExpects.has(key)) agg.caseExpects.set(key, [])
      agg.caseExpects.get(key)!.push(exp.join('\n'))
    }
  }
  return agg
}

/** 长文精简（列3/列4 同规则）：≤400 字原样，超出按段落边界截到约 360~420 字并标记省略 */
function clipLong(text: string): string {
  const paras = text.split('\n').map(p => p.trim()).filter(p => p !== '')
  if (paras.length === 0) return ''
  if (paras.join('\n').length <= 400) return paras.join('\n')
  const out: string[] = []
  let n = 0
  for (const p of paras) {
    if (n >= 360) break
    if (n > 0 && n + p.length > 420) break
    if (p.length > 400) {
      out.push(p.slice(0, 400) + '……')
      n += 400
      break
    }
    out.push(p)
    n += p.length
  }
  return out.join('\n') + '\n……（内容过长，已截断，详见需求规格说明）'
}

/** 表34 的固定类型列（模板形状固定，其余类型只进总计并告警） */
const T34_COLS = ['文档审查', '功能测试', '性能测试', '人机交互界面测试']

export function buildConfData(parsed: ParsedOutline, first: RecordCase[], reg: RecordCase[], params: GlobalParams): ConfData {
  const issues = new IssueCollector()
  const rows = convertToTemplateData(parsed, params).cases
  const itemByKey = new Map(parsed.items.map(it => [keyOf(it.itemId, it.chapter), it]))
  // 记录覆盖率防线（2026-11-24 同事反馈排查出的盲区）：记录表被解析层漏识别时完全静默，
  // 只有表数差能显性提示——对应项会显示「未测试」，请用户核对记录是否完整
  if (first.length < rows.length) {
    issues.info('REPORT_COVERAGE',
      '大纲共 ' + rows.length + ' 个用例，记录只有 ' + first.length + ' 张用例表，可能有用例未执行、未记录或记录表未被识别——对应测试项将显示「未测试」，请核对记录是否完整')
  }
  const f = aggregate(rows, first, itemByKey, issues)
  const g = reg.length > 0 ? aggregate(rows, reg, itemByKey, issues) : null

  const rowsOfKey = new Map<string, CaseRow[]>()
  /** 类型出现序 + 每类型设计步骤行数（大纲侧） */
  const typeOrder: string[] = []
  const designedStepsByType = new Map<string, number>()
  let outlineSteps = 0
  for (const r of rows) {
    const k = keyOf(r.itemItemId, r.chapter)
    if (!rowsOfKey.has(k)) rowsOfKey.set(k, [])
    rowsOfKey.get(k)!.push(r)
    if (!designedStepsByType.has(r.typeName)) { designedStepsByType.set(r.typeName, 0); typeOrder.push(r.typeName) }
    designedStepsByType.set(r.typeName, designedStepsByType.get(r.typeName)! + r.steps.length)
    outlineSteps += r.steps.length
  }
  const dynamicTypes = typeOrder.filter(t => !STATIC_TYPES.has(t))

  // —— 表26：动态类型逐行（设计步骤行 vs 首轮执行/通过/未通过步骤行）——
  const t26Rows: T26Row[] = dynamicTypes.map(t => {
    const total = designedStepsByType.get(t) ?? 0
    const exec = f.execStepsByType.get(t) ?? 0
    const fail = f.failStepsByType.get(t) ?? 0
    return { t26Type: t, t26Total: total, t26Exec: exec, t26Unexec: total - exec, t26Pass: (f.passStepsByType.get(t) ?? 0), t26Fail: fail }
  })
  const t26S = t26Rows.reduce((a, r) => ({
    total: a.total + r.t26Total, exec: a.exec + r.t26Exec, unexec: a.unexec + r.t26Unexec,
    pass: a.pass + r.t26Pass, fail: a.fail + r.t26Fail
  }), { total: 0, exec: 0, unexec: 0, pass: 0, fail: 0 })

  // —— 问题口径（2026-11-22 拍板）：按首轮不通过统计，用例 = 步骤行 ——
  const N = [...f.failStepsByType.values()].reduce((a, b) => a + b, 0)
  // 归零/遗留：回归记录里这些用例通过 → 归零；未上传回归 → 全部遗留待人工核验
  let regZero = 0
  if (g !== null) {
    for (const [key, caseIds] of f.failedCases) {
      const gPassed = g.passedCases.get(key) ?? new Set<string>()
      const gFailed = g.failedCases.get(key) ?? new Set<string>()
      for (const id of caseIds) {
        if (gPassed.has(id) && !gFailed.has(id)) regZero++
      }
    }
  }
  const regLeft = N - regZero

  // —— 表33（等级×问题类型交叉）：等级/类型无字段，按默认归类并告警 ——
  // 等级全计入「一般问题」（样例报告惯例"均为一般问题"）、类型全计入「其他问题」
  const q33: Record<string, number> = {}
  const LEVELS = ['Major', 'Severe', 'General', 'Suggest'] as const
  const TYPE_COLS33 = ['Req', 'Design', 'Doc', 'Code', 'Data', 'Other'] as const
  for (const lv of LEVELS) {
    for (const c of TYPE_COLS33) q33['q33' + lv + c] = 0
    q33['q33' + lv + 'Zero'] = 0
    q33['q33' + lv + 'Left'] = 0
  }
  for (const c of TYPE_COLS33) q33['q33Sum' + c] = 0
  q33.q33SumZero = 0
  q33.q33SumLeft = 0
  if (N > 0) {
    q33.q33GeneralOther = N
    q33.q33GeneralZero = regZero
    q33.q33GeneralLeft = regLeft
    q33.q33SumOther = N
    q33.q33SumZero = regZero
    q33.q33SumLeft = regLeft
  }

  // —— 表34（等级×测试类型交叉）：固定四类型列，其余类型只进总计并告警 ——
  const q34: Record<string, number> = {}
  const T34_KEYS = ['Doc', 'Func', 'Perf', 'Hmi'] as const
  for (const lv of LEVELS) {
    for (const c of T34_KEYS) q34['q34' + lv + c] = 0
    q34['q34' + lv + 'Zero'] = 0
    q34['q34' + lv + 'Left'] = 0
  }
  for (const c of T34_KEYS) q34['q34Sum' + c] = 0
  q34.q34SumZero = 0
  q34.q34SumLeft = 0
  if (N > 0) {
    const unmatched34: string[] = []
    for (const [type, n] of f.failStepsByType) {
      if (n === 0) continue
      const idx = T34_COLS.indexOf(type)
      if (idx >= 0) q34['q34General' + T34_KEYS[idx]] = n
      else unmatched34.push(type + ' ' + n + ' 个')
    }
    q34.q34GeneralZero = regZero
    q34.q34GeneralLeft = regLeft
    for (const c of T34_KEYS) q34['q34Sum' + c] = q34['q34General' + c]
    q34.q34SumZero = regZero
    q34.q34SumLeft = regLeft
    if (unmatched34.length > 0) {
      issues.info('REPORT_T34_UNMATCHED', '表34 类型列为固定四种，以下测试类型的未通过用例只计入总计行：' + unmatched34.join('、'))
    }
  }
  if (N > 0) {
    issues.warning('REPORT_LEVEL_ASSUMED',
      '共 ' + N + ' 个问题按首轮不通过统计（用例=步骤行）。记录问题单未提供等级与类型字段，已按「一般问题 / 其他问题」默认归类（样例报告惯例），请按实际分布人工核对 2.1 综述与表33/表34')
  }

  // —— 表38 列4：首轮全通过 → 记录用例文字（期望结果与评估标准，无图）；首轮有不通过 → 「经过测试符合要求」——
  const out: ConfRow[] = []
  const stats: ConfStats = {
    items: parsed.items.length, outlineCases: rows.length, outlineSteps,
    recordCases: first.length, executedSteps: [...f.execStepsByType.values()].reduce((a, b) => a + b, 0),
    failedSteps: N, regCases: reg.length, regZero, regLeft,
    firstPass: 0, regPass: 0, firstFail: 0, regFail: 0, untested: 0
  }
  const regMissing: string[] = []
  const regFailNames: string[] = []
  const untestedNames: string[] = []
  const untestedItems: typeof parsed.items = []
  const noRecord: string[] = []

  for (const it of parsed.items) {
    const key = keyOf(it.itemId, it.chapter)
    const myRows = rowsOfKey.get(key) ?? []
    const failed = f.failedCases.get(key) ?? new Set<string>()
    const passed = f.passedCases.get(key) ?? new Set<string>()
    let result: string
    if (failed.size > 0) {
      // 用户拍板（2026-11-22）：不写未通过——首轮有不通过的需求行写「经过测试符合要求」
      result = '经过测试符合要求'
      if (g === null) {
        stats.firstFail++
        regMissing.push(it.name)
      } else {
        const gFailed = g.failedCases.get(key) ?? new Set<string>()
        const gPassed = g.passedCases.get(key) ?? new Set<string>()
        const still = [...failed].filter(id => !gPassed.has(id))
        if (still.length === 0 && gFailed.size === 0) stats.regPass++
        else { stats.regFail++; regFailNames.push(it.name) }
      }
    } else if (passed.size === 0) {
      result = '未测试'
      stats.untested++
      untestedNames.push(it.name)
      untestedItems.push(it)
    } else {
      // 首轮全通过：列4 = 该项各用例的记录文字（期望结果与评估标准拼接，截断同列3）
      const exps = f.caseExpects.get(key) ?? []
      result = exps.length > 0 ? clipLong(exps.join('\n')) : '经过测试符合要求'
      stats.firstPass++
      if (myRows.length > passed.size) noRecord.push(it.name + '（' + (myRows.length - passed.size) + ' 例未见记录）')
    }
    out.push({
      no: out.length + 1,
      source: it.traceRaw.trim(),
      metric: clipLong(it.reqDesc === '--' ? '' : it.reqDesc),
      result
    })
  }

  // —— 配套性告警（与工具三同原则：告警不拦路，差异亮出来由人核对）——
  if (regMissing.length > 0) {
    issues.warning('REPORT_REG_MISSING',
      '首轮存在未通过的测试项 ' + regMissing.length + ' 个（' + joinNames(regMissing) + '），未上传回归测试记录；表38 对应行已按「经过测试符合要求」填写，建议上传回归测试记录后重新生成以核验归零情况')
  }
  if (regFailNames.length > 0) {
    issues.warning('REPORT_REG_FAIL',
      '回归后仍未通过的测试项 ' + regFailNames.length + ' 个（' + joinNames(regFailNames) + '），表38 已按「经过测试符合要求」填写，请人工核对回归结果')
  }
  if (untestedNames.length > 0) {
    issues.warning('REPORT_ITEM_UNTESTED',
      untestedNames.length + ' 个测试项的用例在首轮记录中均未找到（' + joinNames(untestedNames) + '），对应行填「未测试」，请人工核对')
  }
  // 改名嫌疑（2026-11-22 用户质疑"28 项肯定能找到"探针实证）：记录里存在同名用例但所属标识不同
  // → 大纲改版改名（如 关键词检索 XQ_SU_GCRT ↔ 记录旧标识 XQ_SU_PJRT），点名提示人工核对；不做自动改配（同名跨多项有歧义）
  const renameSuspects: string[] = []
  for (const it of untestedItems) {
    const names = new Set((rowsOfKey.get(keyOf(it.itemId, it.chapter)) ?? []).map(r => r.mingcheng.replace(/\s+/g, '')))
    const hits: string[] = []
    for (const rec of first) {
      if (!names.has(rec.caseName.replace(/\s+/g, ''))) continue
      hits.push(rec.caseId + '（追踪标识 ' + (rec.traceItemId || '空') + '）')
      if (hits.length >= 2) break
    }
    if (hits.length > 0) renameSuspects.push(it.name + ' ← 记录同名 ' + hits.join('、'))
  }
  if (renameSuspects.length > 0) {
    issues.warning('REPORT_RENAME_SUSPECT',
      renameSuspects.length + ' 个「未测试」项在记录中存在**同名用例但测试项标识不同**，疑似大纲改版改名而非未执行，请人工核对：' + joinNames(renameSuspects))
  }
  if (noRecord.length > 0) {
    issues.info('REPORT_CASE_NO_RECORD',
      noRecord.length + ' 个测试项有用例未见首轮记录（' + joinNames(noRecord) + '），对应行按已记录用例判定')
  }
  const ghostFirst = first.length - f.matched
  if (ghostFirst > 0) {
    issues.info('REPORT_NO_MATCH', '首轮记录中 ' + ghostFirst + ' 张用例表未匹配到大纲用例，不参与判定，请人工核对')
  }
  if (g !== null) {
    const ghostReg = reg.length - g.matched
    if (ghostReg > 0) {
      issues.info('REPORT_NO_MATCH', '回归记录中 ' + ghostReg + ' 张用例表未匹配到大纲用例，不参与判定，请人工核对')
    }
  }

  // —— 段落统计变量（批注铺开；用例数 = 步骤行，测试项数同口径按样例 4582=4582）——
  const allTypesText = typeOrder.join('、')
  const dynamicTypesText = dynamicTypes.join('、')
  const docDesigned = designedStepsByType.get('文档审查') ?? 0
  const docExec = f.execStepsByType.get('文档审查') ?? 0
  const docFail = f.failStepsByType.get('文档审查') ?? 0
  const vars: Record<string, string | number> = {
    // 1.7.3：全量类型清单 + 类型数 + 测试项数（步骤行口径）
    p173Types: allTypesText,
    p173TypeCount: typeOrder.length,
    p173Items: outlineSteps,
    // 1.7.4：设计用例数（步骤行）
    p174Cases: outlineSteps,
    // 2.1 综述：问题按首轮不通过统计，等级/类型默认归类
    p21Total: N, p21Major: 0, p21Severe: 0, p21General: N, p21Suggest: 0,
    p21Req: 0, p21Design: 0, p21Doc: 0, p21Code: 0, p21Data: 0, p21Other: N,
    // 2.2.4.1.1 文档审查（静态）
    p221Designed: docDesigned, p221Exec: docExec, p221Failed: docFail,
    // 2.2.4.4.1 动态测试（不含静态四类）
    p244Cases: t26S.total,
    p244ExecPhrase: t26S.unexec === 0 ? '全部执行完成' : '执行' + t26S.exec + '个、未执行' + t26S.unexec + '个',
    p244Types: dynamicTypesText,
    p244TypeCount: dynamicTypes.length,
    // 2.3 b/c：需求分析/设计阶段（动态类型清单 + 步骤行数）
    p23bTypes: dynamicTypesText,
    p23bTypeCount: dynamicTypes.length,
    p23bItems: outlineSteps,
    p23cCases: outlineSteps,
    p23cTypes: dynamicTypesText,
    p23cTypeCount: dynamicTypes.length,
    // 2.3 d：问题数（首轮不通过步骤行）
    p23dProblems: N,
    // 表26 小计
    t26STotal: t26S.total, t26SExec: t26S.exec, t26SUnexec: t26S.unexec, t26SPass: t26S.pass, t26SFail: t26S.fail,
    // 表26 后导语：全执行完成才写「无未执行测试用例」
    p26NoUnexecText: t26S.unexec === 0 ? '无未执行测试用例。' : '另有 ' + t26S.unexec + ' 个用例未执行，见上表未执行列。',
    ...q33,
    ...q34
  }

  return { rows: out, t26Rows, vars, stats, issues: issues.issues }
}

/** 告警里的人名列表：全量太长，前 6 个 + 「等 N 项」 */
function joinNames(names: string[]): string {
  const head = names.slice(0, 6).join('、')
  return names.length > 6 ? head + ' 等 ' + names.length + ' 项' : head
}
