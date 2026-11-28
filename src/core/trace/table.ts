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
  /** 全量列变量名（与 heads 的叶子列一一对应；列显隐/顺序配置按变量名投影） */
  vars?: string[]
  /** 可编辑列下标（报告追踪的执行结果列，预览里可改）；其余表 undefined */
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

/** 列配置：勾选列的变量名有序清单（子集投影用） */
export interface TraceColConfig { cols: string[] }

/**
 * 按列配置把全量追踪表投影成显示/生成用的形态：
 * heads 按 varName 重排（组内连续选中的列合成组，组名保留；全组未选 → 组整块消失）；
 * rows.cells / span 同步重排；vars 替换为选中变量序。
 * 变量名不在全量 vars 里 → 忽略（防脏配置）。
 */
export function applyTraceCols(t: TraceTable, cols: string[]): TraceTable {
  const vars = t.vars ?? t.heads.flatMap(g => g.cols)
  if (cols.length === 0) return t
  const varSet = new Set(vars)
  const keep = cols.filter(v => varSet.has(v))
  if (keep.length === vars.length && keep.every((v, i) => v === vars[i])) return t // 全选原序 = 原表
  const order = keep.map(v => vars.indexOf(v))
  if (order.some(i => i < 0)) return t
  // heads：按新序重组（同组叶子在显示序中相邻即归一组——列可重排，连续性按显示序判）
  const leafNames = t.heads.flatMap(h => h.cols)
  const owner: string[] = []
  t.heads.forEach(g => g.cols.forEach(() => owner.push(g.group)))
  const newHeads: TraceHeadGroup[] = []
  for (let i = 0; i < order.length; i++) {
    const g = owner[order[i]]
    const last = newHeads[newHeads.length - 1]
    if (g !== '' && last !== undefined && last.group === g) {
      last.cols.push(leafNames[order[i]])
      continue
    }
    newHeads.push({ group: g, cols: [leafNames[order[i]]] })
  }
  const rows = t.rows.map(r => ({
    cells: order.map(i => r.cells[i]),
    span: order.map(i => r.span[i])
  }))
  // 可编辑列跟随移动；被移除 → 编辑能力消失
  let editableCol: number | undefined
  if (t.editableCol !== undefined) {
    const at = order.indexOf(t.editableCol)
    editableCol = at >= 0 ? at : undefined
  }
  const out: TraceTable = { ...t, heads: newHeads, rows: rows, vars: keep }
  if (editableCol !== undefined) out.editableCol = editableCol
  else delete out.editableCol
  return out
}
