import { children, textOf, numPrOf, W, type ParaInfo } from './docx.ts'

export type CellParas = ParaInfo[]

/** 测试项表格的结构化字段（02 第四节：按行标签取值，格式微调不会崩） */
export interface ItemTable {
  /** 表格第 1 行第 2 格 = 测试项名称 */
  name: string
  /** 表格第 1 行第 4 格 = 测试项标识 */
  itemId: string
  /** 测试项描述格的段落 */
  description: CellParas
  /** 测试方法格的段落 */
  method: CellParas
  /** 通过准则格的段落（9.5） */
  criteria: CellParas
}

/** 单元格内段落（保序，剔除空段） */
function cellParas(cell: Element): ParaInfo[] {
  const out: ParaInfo[] = []
  for (const p of children(cell, W, 'p')) {
    const text = textOf(p).trim()
    if (!text) continue
    const np = numPrOf(p)
    out.push({ text, numId: np ? np.numId : null, ilvl: np ? np.ilvl : 0 })
  }
  return out
}

/**
 * 识别并提取测试项表格。
 * 命中条件：第 1 行第 1 格文本为「测试项名称」（02 第三节，37 张表全符合）。
 * 未命中返回 null。
 */
export function extractItemTable(tbl: Element): ItemTable | null {
  const rows = children(tbl, W, 'tr')
  if (!rows.length) return null
  const row1 = children(rows[0], W, 'tc')
  if (!row1.length) return null
  if (textOf(row1[0]).trim() !== '测试项名称') return null

  // 第 2 格 = 名称，第 4 格 = 标识（03 第一节）；缺格时留空
  const name = row1.length > 1 ? textOf(row1[1]).trim() : ''
  const itemId = row1.length > 3 ? textOf(row1[3]).trim() : ''

  // 其余行按行标签取值；值格 = 从行尾向前的第一个非空格（跳过第 0 格标签；
  // 垂直合并产生的空格自然被跳过，单段值格也不会与标签格混淆）
  const byLabel = new Map<string, CellParas>()
  for (let i = 1; i < rows.length; i++) {
    const cells = children(rows[i], W, 'tc')
    if (!cells.length) continue
    const label = textOf(cells[0]).trim()
    let best: CellParas = []
    for (let j = cells.length - 1; j >= 1; j--) {
      const ps = cellParas(cells[j])
      if (ps.length > 0) {
        best = ps
        break
      }
    }
    if (label) byLabel.set(label, best)
  }

  return {
    name,
    itemId,
    description: byLabel.get('测试项描述') ?? [],
    method: byLabel.get('测试方法') ?? [],
    criteria: byLabel.get('通过准则') ?? []
  }
}
