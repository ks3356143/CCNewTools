import { children, textOf, numPrOf, INVISIBLE_RE, W, type ParaInfo } from './docx.ts'

export type CellParas = ParaInfo[]

/** 测试项表格的结构化字段（02 第四节：按行标签取值，格式微调不会崩） */
export interface ItemTable {
  /** 表格第 1 行第 2 格 = 测试项名称 */
  name: string
  /** 表格第 1 行第 4 格 = 测试项标识 */
  itemId: string
  /** 追踪关系格的文本（需求追踪表用，如《…需求规格说明》4.3.1.2 A星指令参数管理） */
  traceText: string
  /** 测试项描述格的段落 */
  description: CellParas
  /** 测试方法格的段落 */
  method: CellParas
  /** 通过准则格的段落（9.5） */
  criteria: CellParas
  /** 优先级（第 1 行第 6 格，如 高/中/低；F11 回归工具用） */
  priority: string
  /** 需求描述格的文本（F11 回归工具 4.1 表原文照抄用，"--"或空原样保留） */
  reqDesc: string
  /** 测试项描述格原文（F11 v2：4.1 需求表按用户拍板原样拷贝大纲整表） */
  descRaw: string
  /** 测试方法格原文（同上） */
  methodRaw: string
  /** 充分性要求格原文（同上） */
  sufficientRaw: string
  /** 通过准则格原文（同上；criteria 结构化字段供转换层另用） */
  criteriaRaw: string
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

  // 第 2 格 = 名称，第 4 格 = 标识（03 第一节）；缺格时留空。
  // 格内软换行（br）是排版断行，名称/标识按单行语义处理（2026-10-08 新变种）
  const name = row1.length > 1 ? textOf(row1[1]).replace(/\n/g, '').trim() : ''
  const itemId = row1.length > 3 ? textOf(row1[3]).replace(/\n/g, '').trim() : ''
  // 第 6 格 = 优先级（F11；旧形态无此格时留空）
  const priority = row1.length > 5 ? textOf(row1[5]).replace(/\n/g, '').trim() : ''

  // 其余行按行标签取值；值格 = 从行尾向前的第一个非空格（跳过第 0 格标签；
  // 垂直合并产生的空格自然被跳过，单段值格也不会与标签格混淆）
  const byLabel = new Map<string, CellParas>()
  for (let i = 1; i < rows.length; i++) {
    const cells = children(rows[i], W, 'tc')
    if (!cells.length) continue
    // 标签里的零宽字符先剥离：标题层已这么做，「追踪​关系」这类残留会让整行取值静默落空
    const label = textOf(cells[0]).replace(INVISIBLE_RE, '').trim()
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
    traceText: (byLabel.get('追踪关系') ?? []).map(p => p.text).join('\n').trim(),
    description: byLabel.get('测试项描述') ?? [],
    method: byLabel.get('测试方法') ?? [],
    criteria: byLabel.get('通过准则') ?? [],
    priority,
    reqDesc: (byLabel.get('需求描述') ?? []).map(p => p.text).join('\n').trim(),
    descRaw: (byLabel.get('测试项描述') ?? []).map(p => p.text).join('\n').trim(),
    methodRaw: (byLabel.get('测试方法') ?? []).map(p => p.text).join('\n').trim(),
    sufficientRaw: (byLabel.get('充分性要求') ?? []).map(p => p.text).join('\n').trim(),
    criteriaRaw: (byLabel.get('通过准则') ?? []).map(p => p.text).join('\n').trim()
  }
}
