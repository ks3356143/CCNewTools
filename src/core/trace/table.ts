/**
 * 追踪表核心模型（12-追踪文档工具 v2，2026-10-10 设计修订）。
 * 四类追踪表统一为一个模型：双层表头（分组跨列 + 子列）+ 数据行 + 纵向合并（vmerge）。
 * 消费方：服务端 docx 渲染（vMerge 后处理）、前端预览/剪贴板（rowspan）。
 */

export type TraceType = 'outline' | 'spec' | 'report' | 'returnSpec'

export interface TraceHeadGroup {
  /** 分组名（第一行，跨 cols 列）；空串 = 独立列（两行纵向合并成一个格） */
  group: string
  /** 第二行的子列名 */
  cols: string[]
}

export interface TraceRowVM {
  /** 平铺单元格文本（长度 = 总列数） */
  cells: string[]
  /**
   * 每列的合并标记：span[c] = N → 本行该列 rowspan=N 并显示文本；
   * span[c] = 0 → 该列被上方行合并，渲染时跳过该 td / XML 里 vMerge continue。
   */
  span: number[]
}

export interface TraceTable {
  type: TraceType
  heads: TraceHeadGroup[]
  rows: TraceRowVM[]
  /** 可编辑列下标（报告追踪的执行结果列，预览里可改）；其余表 undefined */
  editableCol?: number
}

/** 总列数 = 各组子列数之和 */
export function traceColumnCount(heads: TraceHeadGroup[]): number {
  let n = 0
  for (const g of heads) n += g.cols.length
  return n
}

/**
 * 对指定的列组做整块纵向合并：连续行这些列的值全部相同（且无空值）时，
 * 组首行 span=N、续行 span=0。整块合并（而非逐列独立）保证合并区域是矩形，
 * 与真实样例一致（同一测试项的 SRS/大纲/类型列一起合并）。
 */
export function applyVmerge(rows: TraceRowVM[], mergeCols: number[]): void {
  if (mergeCols.length === 0) return
  // 空列不参与合并键（通配）：说明作源时 SRS 列全空，同测试项的行仍按其余列合并；
  // 一行有值一行空则键不同，自然不合并
  const keyOf = (r: TraceRowVM): string =>
    mergeCols
      .filter(c => r.cells[c] !== '')
      .map(c => r.cells[c])
      .join('\u0000')
  let i = 0
  while (i < rows.length) {
    const key = keyOf(rows[i])
    // 本行合并列全空 → 无键可合并，独立成行
    if (key === '') {
      i++
      continue
    }
    let j = i + 1
    while (j < rows.length && keyOf(rows[j]) === key) j++
    if (j - i > 1) {
      for (let k = i; k < j; k++) {
        rows[k].span = rows[k].span.map((s, c) => (mergeCols.includes(c) ? (k === i ? j - i : 0) : s))
      }
    }
    i = j
  }
}

/** 拼接数字为三位序号（步骤范围写法用，样例：-001~005） */
function pad3(n: number): string {
  return String(n).padStart(3, '0')
}

/**
 * 用例标识 → 报告追踪表的带步骤范围写法（样例：YL_SU_ZLPA_001-001~005）。
 * n = 用例的步骤数；1 步写 -001，多步写 -001~00N。
 */
export function caseIdWithStepRange(caseId: string, steps: number): string {
  if (steps <= 0) return caseId
  return steps === 1 ? `${caseId}-001` : `${caseId}-001~${pad3(steps)}`
}

/**
 * 双层表头的第一行：分组行（每个组一个 th，colspan=cols.length；独立组 rowspan=2）。
 * 供前端与剪贴板 HTML 复用。
 */
export interface HeadCellVM {
  text: string
  colspan: number
  rowspan: number
}

export function headRowsOf(heads: TraceHeadGroup[]): [HeadCellVM[], HeadCellVM[]] {
  const top: HeadCellVM[] = []
  const sub: HeadCellVM[] = []
  for (const g of heads) {
    if (g.group === '') {
      top.push({ text: g.cols[0], colspan: 1, rowspan: 2 })
    } else {
      top.push({ text: g.group, colspan: g.cols.length, rowspan: 1 })
      for (const c of g.cols) sub.push({ text: c, colspan: 1, rowspan: 1 })
    }
  }
  return [top, sub]
}
