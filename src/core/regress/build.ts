/**
 * 回归测试说明工具核心（SRS/设计/13）：
 * 记录不通过用例 → 大纲转换行三级容差匹配 → 4.1 回归测试需求 / 5 概述 / 6 用例 渲染数据。
 * 不通过口径（2026-11-20 用户拍板）：只认步骤「通过与否」含 未通过/不通过，不看问题单标识。
 */
import type { ParsedOutline, GlobalParams, Issue, PathEntry } from '../domain.ts'
import { IssueCollector } from '../domain.ts'
import { convertToTemplateData } from '../convert/index.ts'
import type { CaseRow } from '../convert/rows.ts'
import type { RecordCase } from '../parse/record.ts'

/** 步骤结果判不通过：真实记录实测取值为 通过/未通过，兼容「不通过」写法 */
export const FAIL_RE = /不\s*通过|未\s*通过/

/** 记录中一个不通过用例（含匹配结果），界面草稿行 */
export interface RegFailCase {
  /** 记录用例表「标识」格原值（YL_…，静态用例可能无尾号） */
  recordCaseId: string
  recordCaseName: string
  /** 大纲转换行 caseId（YL_…_001 形态）；未匹配为空串 */
  caseId: string
  mingcheng: string
  summary: string
  stepCount: number
  /** 不通过步骤的 1 基序号 */
  failSteps: number[]
  problemId: string
  executed: string
  /** 记录表所在类型名（未匹配时归组显示用） */
  recordTypeName: string
  matched: boolean
  /** 命中后的大纲归属信息 */
  typeName: string
  itemName: string
  itemId: string
  chapter: string
  /** 该用例类型在产物 4.1.x 的章节号（命中后由类型序推出） */
  reqChapter: string
}

export interface RegressDraft {
  /** 命中用例按大纲类型出现序分组（reqChapter = 4.1.x 与 6.x 同序对号） */
  types: Array<{ typeName: string; reqChapter: string; cases: RegFailCase[] }>
  /** 记录中不通过但对不上大纲的用例（默认不生成，界面可见） */
  unmatched: RegFailCase[]
  issues: Issue[]
  stats: { recordCases: number; failed: number; matched: number }
}

const baseId = (id: string): string => id.replace(/_\d{3,}$/, '')
/** 零宽字符（Word 粘贴常见 U+200B~U+200D/U+2060）不在 \s 与 trim 的空白集内——标识格里混一个就废掉整条精确匹配 */
const ZW_RE = /[\u200b-\u200d\u2060]/g
const normText = (s: string): string => s.replace(ZW_RE, '').replace(/\s+/g, '')
/** 标识比对统一入口：Word 单元格常见首尾空白，裸相等会把「YL_A_001 」直接打成未匹配（2026-11-22 鲁棒性审查） */
const normId = (s: string): string => s.replace(ZW_RE, '').trim()

/** 匹配结果：kind 标命中路径（无尾号/单用例兜底是猜测性匹配，歧义时必须提示）；
 *  byName = 撞号消歧时用例名是否硬命中（false 且 baseCount>1 → 回退首个，调用方应告警请人工核对）；
 *  segOrdinal/segNote = 段级对齐按子项号序数落位时被删的段与序数（猜测性，调用方点名）；
 *  itemRoute/itemOrdinal = 测试项名称兜底的落位子路由与序数（ord 为猜测性，调用方点名） */
export interface MatchResult {
  row: CaseRow
  byName: boolean
  kind: 'exact' | 'base' | 'segdrop' | 'single' | 'item'
  baseCount: number
  segOrdinal?: number
  segNote?: string
  itemRoute?: 'single' | 'name' | 'strip' | 'ord'
  itemOrdinal?: number
}

/** base 的段级变体（2026-11-27 同事揭晓的未匹配根因）：记录用例标识常比大纲多一段子项号
 *  （YL_SU_STJS_SU01_001 ↔ 大纲 YL_SU_STJS_001），精确/去尾号都够不着——删任一段后相等才认。
 *  工具二追踪对齐同款（导出共用）。 */
export function segDropVariants(base: string): Array<{ variant: string; dropped: string }> {
  const segs = base.split('_')
  if (segs.length < 3) return []
  const out: Array<{ variant: string; dropped: string }> = []
  for (let i = 0; i < segs.length; i++) out.push({ variant: segs.filter((_, k) => k !== i).join('_'), dropped: segs[i] })
  return out
}

/** 同标识多命中时按用例名消歧（2026-11-22 报告工具全流程检查实证的撞号真 bug）：
 *  真实大纲存在同一 itemId 撞号在两个章节、各有一行同名 caseId 的形态
 *  （如 XQ_SU_ZSPG 在 .4.2.35 的设置功能与 .7.1.3.5 的知识评估功能测试各有一个 YL_SU_ZSPG_001），
 *  盲取第一行会把记录结果记到错误项头上——记录表的「测试用例名称」格与大纲用例名一致才是同一行的硬证据；
 *  名称对不上再回退首个（byName=false，由调用方出告警兜底）。 */
function pickByName(cands: CaseRow[], rec: RecordCase): { row: CaseRow; byName: boolean } {
  if (rec.caseName.trim() === '' || cands.length === 1) return { row: cands[0], byName: false }
  const hit = cands.find(r => normText(r.mingcheng) === normText(rec.caseName))
  return hit !== undefined ? { row: hit, byName: true } : { row: cands[0], byName: false }
}

/** 记录用例名剥尾部序号（同事口径：一个子项可写多张用例表，「…功能测试1」～「…测试14」同指一个大纲用例）。
 *  前一字符须是汉字，防误剥 IPv6/MD5 之类以数字结尾的专名。 */
const stripTailNum = (n: string): string => {
  const s = n.replace(/\s+/g, '')
  const m = /^(.*[一-鿿])\d{1,3}$/.exec(s)
  return m !== null ? m[1] : s
}

/** 记录用例 → 大纲转换行：精确 → 去尾号前缀 → 记录追踪行标识定位单用例测试项兜底。
 *  精确命中多个（同标识跨项重名）按用例名消歧，名称对不上回退首个 + baseCount，由调用方出告警。
 *  （工具四报告统计复用同一匹配口径，2026-11-22 起导出） */
export function matchRow(rows: CaseRow[], rec: RecordCase): MatchResult | null {
  const exact = rows.filter(r => normId(r.caseId) === normId(rec.caseId))
  if (exact.length > 0) { const p = pickByName(exact, rec); return { ...p, kind: 'exact', baseCount: exact.length } }
  const b = baseId(normId(rec.caseId))
  if (b !== '') {
    const same = rows.filter(r => baseId(normId(r.caseId)) === b)
    if (same.length > 0) { const p = pickByName(same, rec); return { ...p, kind: 'base', baseCount: same.length } }
    // 段级对齐：记录标识多一段子项号（YL_IO_RWGL_IO01_001 ↔ 大纲 YL_IO_RWGL_001）。
    // 删段候选必须全落同一个大纲基形（跨多个基形 = 歧义不猜）。落位优先级：
    // 用例级子项标识硬键（大纲标题（XQ_IO_RWGL_IO01）派生）→ 用例名 → 剥尾部序号用例名 → 子项号序数
    // （IO01=该测试项第1个用例，同一子项多张用例表尾号不限 001）→ 回退首行。候选跨测试项撞码时按
    // 记录追踪行的测试项名称收窄到唯一项。
    const cands: CaseRow[] = []
    let droppedSeg = ''
    for (const { variant, dropped } of segDropVariants(b)) {
      const es = rows.filter(r => baseId(normId(r.caseId)) === variant)
      if (es.length === 0) continue
      if (droppedSeg === '') droppedSeg = dropped
      for (const e of es) if (!cands.includes(e)) cands.push(e)
    }
    if (cands.length > 0 && new Set(cands.map(r => baseId(normId(r.caseId)))).size === 1) {
      let pool = cands
      if (rec.traceItemName !== '' && new Set(cands.map(r => r.itemItemId + '\0' + r.chapter)).size > 1) {
        // 大纲两项共用同段码（撞号跨项）：按记录追踪行的测试项名称收窄；收不窄（同名项不存在/仍跨项）
        // → 整条 seg 路线放弃，落到测试项兜底（2026-11-28 高速检索实证：回退首行会把记录记到撞码项头上）
        const scoped = cands.filter(r => r.itemName === rec.traceItemName)
        if (scoped.length === 0 || new Set(scoped.map(r => r.itemItemId + '\0' + r.chapter)).size !== 1) {
          pool = []
        } else {
          pool = scoped
        }
      }
      if (pool.length > 0) {
        const hard = pool.filter(r => 'YL_' + normId(r.itemId).replace(/^XQ_/, '') === b)
        if (hard.length === 1) return { row: hard[0], byName: true, kind: 'segdrop', baseCount: 1, segNote: droppedSeg }
        const p = pickByName(pool, rec)
        if (p.byName || pool.length === 1) return { ...p, kind: 'segdrop', baseCount: pool.length, segNote: droppedSeg }
        const st = pool.filter(r => normText(r.mingcheng) === stripTailNum(rec.caseName))
        if (st.length === 1) return { row: st[0], byName: true, kind: 'segdrop', baseCount: pool.length, segNote: droppedSeg }
        // 用例名对不上 → 子项号序数兜底：序数段须有尾号数字、候选全落同一测试项同章节，
        // 序数在范围内才认（猜测性落位，调用方点名告警）
        const ordN = parseInt(/(\d{1,3})$/.exec(droppedSeg)?.[1] ?? '0', 10)
        const itemKeys = new Set(pool.map(r => r.itemItemId + '\0' + r.chapter))
        if (ordN >= 1 && ordN <= pool.length && itemKeys.size === 1) {
        return { row: pool[ordN - 1], byName: false, kind: 'segdrop', baseCount: pool.length, segOrdinal: ordN, segNote: droppedSeg }
        }
        return { row: pool[0], byName: false, kind: 'segdrop', baseCount: pool.length, segNote: droppedSeg }
      }
  }
  }
  if (rec.traceItemId !== '') {
    const inItem = rows.filter(r => normId(r.itemItemId) === normId(rec.traceItemId))
    if (inItem.length === 1) return { row: inItem[0], byName: false, kind: 'single', baseCount: 1 }
  }
  // 测试项名称兜底（caseId 路线全断的同事形态：类型码不同 YL_DC3_001 ↔ 大纲 YL_DC_001、
  // YL_SU_PZCTZ ↔ YL_SU_PBTZ，记录测试需求标识是子项级对不上大纲项级）——同名须唯一落在一个
  // 大纲测试项，项内按 单例 → 名称 → 剥序号名 → 子项号序数 落位（ord 猜测性，调用方点名）
  if (rec.traceItemName !== '') {
    // 测试项名称两级匹配：精确 → 双向包含（≥3 字，2026-11-28 ELJG 实证：记录少写「功能」二字），
    // 两级都命中才用（精确有解不放宽）；同项唯一才认，跨项不猜
    const nameEq = rows.filter(r => r.itemName === rec.traceItemName)
    const nameHit = (x: string, y: string): boolean => {
      const a = x.replace(/\s+/g, '')
      const c = y.replace(/\s+/g, '')
      return a.length >= 3 && c.length >= 3 && (a.includes(c) || c.includes(a))
    }
    const nameIn = nameEq.length > 0 ? nameEq : rows.filter(r => nameHit(r.itemName, rec.traceItemName))
    const inName = nameIn
    if (inName.length > 0 && new Set(inName.map(r => r.itemItemId + '\0' + r.chapter)).size === 1) {
      if (inName.length === 1) return { row: inName[0], byName: false, kind: 'item', baseCount: 1, itemRoute: 'single' }
      const p = pickByName(inName, rec)
      if (p.byName) return { ...p, kind: 'item', baseCount: inName.length, itemRoute: 'name' }
      const st = inName.filter(r => normText(r.mingcheng) === stripTailNum(rec.caseName))
      if (st.length === 1) return { row: st[0], byName: true, kind: 'item', baseCount: inName.length, itemRoute: 'strip' }
      const subSeg = /([A-Za-z]+)(\d{1,3})$/.exec(b.split('_').slice(-1)[0] ?? '')
      const ordN = parseInt(subSeg?.[2] ?? '0', 10)
      if (ordN >= 1 && ordN <= inName.length) {
        return { row: inName[ordN - 1], byName: false, kind: 'item', baseCount: inName.length, itemRoute: 'ord', itemOrdinal: ordN }
      }
    }
  }
  return null
}

/** 全量草稿：记录全部用例表 → 不通过筛出 → 匹配 → 按大纲序归组（预览屏数据源）。
 *  配套性纠错（2026-11-20 用户需求"大纲和记录标识不对应要智能识别"）：
 *  判定列缺失/未执行全表扫描 + 每用例五项比对（测试项标识/大纲章节号/用例名/步骤数/无尾号歧义）
 *  + 大纲侧字段空缺 + 记录覆盖率，全部进 issues（界面告警区）。 */
export function selectRegressCases(parsed: ParsedOutline, records: RecordCase[], params: GlobalParams): RegressDraft {
  const issues = new IssueCollector()
  const rows = convertToTemplateData(parsed, params).cases

  // —— 全表健康扫描（不限于不通过表）：判定列缺失会静默漏判，必须显式提醒 ——
  for (const rec of records) {
    if (rec.stepResults.length > 0 && rec.stepResults.every(s => s.trim() === '')) {
      issues.warning('REGRESS_NO_RESULT', '用例表 ' + (rec.caseId || rec.caseName) + ' 未识别到「通过与否」判定，无法确认该用例是否通过，请人工核对', rec.caseName)
    }
    if (rec.executed.trim() !== '' && !rec.executed.includes('已执行')) {
      issues.info('REGRESS_NOT_EXECUTED', '用例 ' + (rec.caseId || rec.caseName) + ' 执行状态为「' + rec.executed + '」', rec.caseName)
    }
  }
  if (records.length < rows.length) {
    issues.info('REGRESS_COVERAGE', '大纲共 ' + rows.length + ' 个用例，记录只有 ' + records.length + ' 张用例表，可能有用例未执行或未记录')
  }

  const failing = records.filter(r => r.stepResults.some(s => FAIL_RE.test(s)))
  const draft: RegressDraft = { types: [], unmatched: [], issues: issues.issues, stats: { recordCases: records.length, failed: failing.length, matched: 0 } }
  const usedRows = new Set<string>()
  // 类型序按大纲转换行顺序（= 大纲测试项顺序）；reqChapter 与产物 4.1.x/6.x 的自动编号同序对号
  const typeOrder: string[] = []
  const typeIdx = new Map<string, number>()
  const typeBucket = new Map<string, RegFailCase[]>()
  /** 命中用例所属测试项键（结束后按大纲序做字段空缺检查） */
  const hitItemKeys = new Set<string>()

  for (const rec of failing) {
    const m = matchRow(rows, rec)
    const failSteps: number[] = []
    rec.stepResults.forEach((s, i) => { if (FAIL_RE.test(s)) failSteps.push(i + 1) })
    if (m === null) {
      const fcGhost: RegFailCase = {
        recordCaseId: rec.caseId,
        recordCaseName: rec.caseName,
        caseId: '',
        mingcheng: rec.caseName,
        summary: '',
        stepCount: rec.stepResults.length,
        failSteps,
        problemId: rec.problemId,
        executed: rec.executed,
        recordTypeName: rec.typeName,
        matched: false,
        typeName: '',
        itemName: '',
        itemId: '',
        chapter: '',
        reqChapter: ''
      }
      issues.warning('REGRESS_NO_MATCH', '记录用例 ' + rec.caseId + '（' + rec.caseName + '）在测试大纲中未找到对应用例，默认不生成，请人工核对', rec.typeName)
      draft.unmatched.push(fcGhost)
      continue
    }
    const row = m.row
    const fc: RegFailCase = {
      recordCaseId: rec.caseId,
      recordCaseName: rec.caseName,
      caseId: row.caseId,
      mingcheng: row.mingcheng,
      summary: row.summary,
      stepCount: rec.stepResults.length,
      failSteps,
      problemId: rec.problemId,
      executed: rec.executed,
      recordTypeName: rec.typeName,
      matched: !usedRows.has(row.caseId),
      typeName: row.typeName,
      itemName: row.itemName,
      itemId: row.itemItemId,
      chapter: row.chapter,
      reqChapter: ''
    }
    if (usedRows.has(row.caseId)) {
      issues.warning('REGRESS_DUP_MATCH', '记录中多个用例表（' + rec.caseId + '）匹配到大纲同一用例 ' + row.caseId + '，仅生成一次', rec.caseName)
      fc.matched = false
      draft.unmatched.push(fc)
      continue
    }
    usedRows.add(row.caseId)
    hitItemKeys.add(row.itemItemId + '\0' + row.chapter)
    draft.stats.matched++
    // —— 配套性比对（每命中一条不通过用例做五项核对）——
    if (m.kind === 'exact' && m.baseCount > 1) {
      issues.warning('REGRESS_DUP_CASEID', '大纲中 ' + m.baseCount + ' 个用例共用标识 ' + rec.caseId + '（跨测试项重名），已按第一个匹配，请人工核对章节归属', rec.caseName)
    }
    if (m.kind === 'segdrop' && m.baseCount > 1 && !m.byName) {
      // 段级对齐的猜测性落位（序数或回退首个）必须点名，别让人猜程序怎么对的
      issues.warning(
        'REGRESS_SEG_MATCH',
        '记录标识 ' + rec.caseId + ' 比大纲用例标识多一段子项号「' + (m.segNote ?? '') + '」且用例名称对不上，已按' +
          (m.segOrdinal !== undefined ? '子项号序数对应到该测试项第 ' + m.segOrdinal + ' 个用例' : '第一个匹配') +
          '（' + row.caseId + '）处理，请人工核对',
        rec.caseName
      )
    } else if (m.kind === 'item' && m.itemRoute === 'ord') {
      // 测试项名称兜底的序数落位是猜测性，必须点名；名称/剥序号名命中是强证据不点名
      issues.warning(
        'REGRESS_ITEM_MATCH',
        '记录标识 ' + rec.caseId + ' 的类型码与大纲不同，已按追踪行测试项「' + rec.traceItemName + '」的子项号序数对应到第 ' +
          m.itemOrdinal + ' 个用例（' + row.caseId + '），请人工核对',
        rec.caseName
      )
    } else if (m.kind !== 'exact' && m.kind !== 'segdrop' && m.kind !== 'item' && m.baseCount > 1) {
      issues.warning('REGRESS_ID_AMBIG', '记录标识 ' + rec.caseId + ' 无用例尾号，对应测试项下有 ' + m.baseCount + ' 个用例，已按第一个（' + row.caseId + '）处理，请人工核对', rec.caseName)
    }
    if (rec.traceItemId !== '' && row.itemItemId !== '' && m.kind !== 'item') {
      // 记录「测试需求标识」可写测试项级（XQ_SU_MCPM）也可写用例级（XQ_SU_MCPM_SU03，WQ 记录习惯）——
      // 用例级派生（测试项标识_尾号 / 恰等于本用例需求标识）是合法形态，不算不一致（2026-11-21 误报修正）；
      // item 路由（按测试项名称兜底）本就是标识对不上才走的，不再报不一致
      const legal = rec.traceItemId === row.itemItemId ||
        rec.traceItemId.startsWith(row.itemItemId + '_') ||
        rec.traceItemId === row.itemId
      if (!legal) {
        issues.warning('REGRESS_ITEM_ID_MISMATCH', '记录表「测试需求标识」' + rec.traceItemId + ' 与大纲测试项标识 ' + row.itemItemId + ' 不一致，大纲可能改版或记录配错了测试项', rec.caseName)
      }
    }
    if (rec.traceChapter !== '' && row.chapter !== '' && rec.traceChapter !== row.chapter) {
      issues.warning('REGRESS_CHAPTER_MISMATCH', '记录追踪关系中的大纲章节号 ' + rec.traceChapter + ' 与大纲实际章节号 ' + row.chapter + ' 不一致，大纲可能改版', rec.caseName)
    }
    // 名称差异核对只对精确/去尾号/单用例三类强匹配有效——segdrop/item 路由的名称差异已在落位告警里点名
    if (rec.caseName !== '' && row.mingcheng !== '' && normText(rec.caseName) !== normText(row.mingcheng) &&
        (m.kind === 'exact' || m.kind === 'base' || m.kind === 'single')) {
      issues.warning('REGRESS_NAME_MISMATCH', '用例名称不一致：记录「' + rec.caseName + '」 vs 大纲「' + row.mingcheng + '」，大纲可能改版', rec.caseName)
    }
    if (rec.stepResults.length > 0 && row.steps.length > 0 && rec.stepResults.length !== row.steps.length) {
      issues.warning('REGRESS_STEP_MISMATCH', '步骤数不一致：记录 ' + rec.stepResults.length + ' 步 vs 大纲 ' + row.steps.length + ' 步，请确认记录与该版大纲配套', rec.caseName)
    }
    if (!typeIdx.has(row.typeName)) {
      typeIdx.set(row.typeName, typeOrder.length)
      typeOrder.push(row.typeName)
      typeBucket.set(row.typeName, [])
    }
    fc.reqChapter = '4.1.' + (typeIdx.get(row.typeName)! + 1)
    typeBucket.get(row.typeName)!.push(fc)
  }
  for (const t of typeOrder) {
    draft.types.push({ typeName: t, reqChapter: '4.1.' + (typeIdx.get(t)! + 1), cases: typeBucket.get(t)! })
  }
  // —— 大纲侧字段空缺（4.1 需求表对应格会空着，提前告知）——
  for (const it of parsed.items) {
    if (!hitItemKeys.has(it.itemId + '\0' + it.chapter)) continue
    const missing: string[] = []
    if (it.priority === '') missing.push('优先级')
    if (it.traceRaw === '') missing.push('追踪关系')
    if (it.reqDesc === '') missing.push('需求描述')
    if (missing.length > 0) {
      issues.info('REGRESS_ITEM_FIELD_EMPTY', '大纲测试项「' + it.name + '」未写' + missing.join('、') + '，4.1 需求表对应格为空', it.name)
    }
  }
  return draft
}

/** 大纲测试项定位键（同标识撞号时以章节号区分，与转换行一致） */
const itemKey = (itemId: string, chapter: string): string => itemId + '\0' + chapter

export interface RegressData {
  /** 4.1 逐测试项需求表行（大纲序；标题镜像槽位 h3~h9 非空时先出对应层小节标题，编号由模板样式链自动生成）；
   *  v2（2026-11-21 用户拍板"原样拷贝大纲"）：需求表带全测试项描述/测试方法/充分性要求/通过准则原文 */
  regItems: Array<{ typeName: string; name: string; itemId: string; priority: string; traceRaw: string; reqDesc: string; descRaw: string; methodRaw: string; sufficientRaw: string; criteriaRaw: string } & MirrorSlots>
  /** 5 概述表行（用例属性固定「继承」，写死在模板里） */
  regRows: Array<{ no: number; mingcheng: string; caseId: string; summary: string }>
  /** 6 逐用例表数据（标题镜像槽位 h3~h9 非空时先出对应层小节标题，6.x 编号由模板样式链自动生成）；追踪行「测试需求分析：{reqChapter} {regTypeName}」= 大纲原章节号 + 项名（2026-11-22 拍板原封不动） */
  regCases: Array<{ typeName: string; regTypeName: string; reqChapter: string; mingcheng: string; caseId: string; itemId: string; summary: string; init: string; constraint: string; designer: string; tester: string; monitor: string; testTime: string; steps: Array<{ no: number; action: string; expect: string }> } & MirrorSlots>
  stats: { items: number; cases: number; steps: number }
  issues: Issue[]
}

/**
 * 生成数据：selectedCaseIds = 草稿里勾选的大纲 caseId 集合。
 * regItems/regRows/regCases 均按大纲原文顺序；4.1.x 与 6.x 类型序一致（标题编号由模板样式自动生成）。
 * 用例表追踪行「测试需求分析：{reqChapter} {regTypeName}」= 大纲原章节号 + 项名（2026-11-22 用户拍板「章节原封不动」，不再用重编的 4.1.x）。
 */
/** 标题镜像槽位（h3~h9，模板编号由样式链自动生成）：与说明文档 head 槽位同规则，层级平移一档（path[s] → h{3+s}，4.1 占第 2 级） */
interface MirrorSlots { h3: string; h4: string; h5: string; h6: string; h7: string; h8: string; h9: string }

/** 按选中序列走 path：共前缀抑制 + 相邻同名去重（静态类型项名=类型名时表格直挂类型层）；
 *  path 超 7 层丢最浅层（与说明 PATH_TOO_DEEP 同语义，槽位只有 h3~h9 七档） */
export function mirrorSlots(path: PathEntry[], state: { prev: string[] }): MirrorSlots {
  const p = path.length > 7 ? path.slice(path.length - 7) : path
  const out: MirrorSlots = { h3: '', h4: '', h5: '', h6: '', h7: '', h8: '', h9: '' }
  const keys: (keyof MirrorSlots)[] = ['h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h9']
  for (let s = 0; s < p.length; s++) {
    if (s > 0 && p[s].text === p[s - 1].text) continue
    const prefix = p.slice(0, s + 1).map(x => x.text).join('\u0000')
    if (prefix === state.prev[s]) continue
    out[keys[s]] = p[s].text
    state.prev[s] = prefix
  }
  return out
}

/** 回归测试记录的测试时间（2026-11-22 用户拍板）：用户填起止范围，工具在用例间均匀铺开；
 *  范围缺失时回退 testTime 单值（服务端生成入口会拦截缺失，此处只是兜底不抛错） */
function spreadTestTime(i: number, n: number, params: GlobalParams): string {
  const s = Date.parse(params.timeStart ?? '')
  const e = Date.parse(params.timeEnd ?? '')
  if (isNaN(s) || isNaN(e)) return params.testTime
  const spanDays = Math.max(0, Math.round((e - s) / 86400000))
  const d = n <= 1 ? s : s + Math.round((spanDays * i) / (n - 1)) * 86400000
  const dt = new Date(d)
  const pad = (x: number): string => String(x).padStart(2, '0')
  return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate())
}

export function buildRegressData(parsed: ParsedOutline, records: RecordCase[], selectedCaseIds: string[], params: GlobalParams): RegressData {
  const issues = new IssueCollector()
  const rows = convertToTemplateData(parsed, params).cases
  const selected = new Set(selectedCaseIds)
  const picked = rows.filter(r => selected.has(r.caseId))
  if (picked.length === 0) issues.error('REGRESS_EMPTY', '没有勾选任何用例，无法生成回归测试说明')

  // 大纲项速查：追踪行要用项的原章节号与项名（原封不动）。
  //  键 = 标识+章节号（与说明工具同约定）：同标识撞号的多个项以章节号区分，按 itemId 单键会取错项（2026-11-22 鲁棒性审查）
  const itemByKey = new Map(parsed.items.map(it => [itemKey(it.itemId, it.chapter), it]))
  // 类型序（与草稿一致：picked 的大纲序即类型首现序）；4.1.x/6.x 标题编号由模板样式自动生成
  const typeIdx = new Map<string, number>()
  // 4.1 与 6 章各自独立的标题镜像状态（共前缀抑制按各自序列走）；超深路径告警去重
  const mirrorState4 = { prev: ['', '', '', '', '', '', ''] }
  const mirrorState6 = { prev: ['', '', '', '', '', '', ''] }
  const warnedDeep = new Set<string>()
  const data: RegressData = { regItems: [], regRows: [], regCases: [], stats: { items: 0, cases: 0, steps: 0 }, issues: issues.issues }
  let caseIdx = 0
  for (const r of picked) {
    if (!typeIdx.has(r.typeName)) typeIdx.set(r.typeName, typeIdx.size)
    const item = itemByKey.get(itemKey(r.itemItemId, r.chapter))
    if (item != null && item.path.length > 7 && !warnedDeep.has(item.itemId)) {
      warnedDeep.add(item.itemId)
      issues.warning('REGRESS_PATH_TOO_DEEP', '测试项「' + item.name + '」的标题层级超过 7 层，4.1/6 章只镜像最深 7 层，最浅层未体现', item.name)
    }
    data.regCases.push({
      ...mirrorSlots(item?.path ?? [], mirrorState6),
      typeName: r.typeName,
      regTypeName: item?.name ?? r.typeName,
      reqChapter: item?.chapter ?? '4.1.' + (typeIdx.get(r.typeName)! + 1),
      mingcheng: r.mingcheng,
      caseId: r.caseId,
      itemId: r.itemItemId,
      summary: r.summary,
      init: params.init,
      constraint: params.constraint,
      designer: params.designer,
      tester: params.tester,
      monitor: params.monitor,
      testTime: spreadTestTime(caseIdx, picked.length, params),
      steps: r.steps.map(s => ({ no: s.no, action: s.action, expect: s.expect }))
    })
    data.regRows.push({ no: data.regRows.length + 1, mingcheng: r.mingcheng, caseId: r.caseId, summary: r.summary })
    data.stats.cases++
    caseIdx++
    data.stats.steps += r.steps.length
  }

  // 4.1 需求表：按大纲测试项序取「拥有勾选用例」的测试项，五字段全部原文照抄；标题镜像按选中序列走
  const pickedItems = new Set(picked.map(r => itemKey(r.itemItemId, r.chapter)))
  for (const it of parsed.items) {
    if (!pickedItems.has(itemKey(it.itemId, it.chapter))) continue
    const typeName = picked.find(r => itemKey(r.itemItemId, r.chapter) === itemKey(it.itemId, it.chapter))?.typeName ?? it.typeName
    if (it.path.length > 7 && !warnedDeep.has(it.itemId)) {
      warnedDeep.add(it.itemId)
      issues.warning('REGRESS_PATH_TOO_DEEP', '测试项「' + it.name + '」的标题层级超过 7 层，4.1/6 章只镜像最深 7 层，最浅层未体现', it.name)
    }
    data.regItems.push({
      ...mirrorSlots(it.path, mirrorState4),
      typeName,
      name: it.name,
      itemId: it.itemId,
      priority: it.priority,
      traceRaw: it.traceRaw,
      reqDesc: it.reqDesc,
      descRaw: it.descRaw,
      methodRaw: it.methodRaw,
      sufficientRaw: it.sufficientRaw,
      criteriaRaw: it.criteriaRaw
    })
    data.stats.items++
  }
  return data
}
