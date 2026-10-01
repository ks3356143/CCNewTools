import { children, attr, W } from './docx.ts'

export interface NumInfo {
  /** numId → 该编号各 ilvl 的起始值（index 2 是数据起始位，其后的 numId 依序落位） */
  start: Array<number[] | undefined>
}

/**
 * 解析 numbering.xml：numId → abstractNumId → 各级 start 值（02 第二节）。
 * 大纲标题编号全部为 decimal（02 已验证），numFmt 在此不区分；只取 start。
 */
export function parseNumbering(doc: Document | null): NumInfo {
  const start: Array<number[] | undefined> = []
  if (!doc) return { start }

  const root = doc.documentElement
  if (!root) return { start }

  // abstractNum 的各级 start
  const abstractById = new Map<string, number[]>()
  for (const abs of children(root, W, 'abstractNum')) {
    const id = attr(abs, 'abstractNumId')
    if (id == null) continue
    const starts: number[] = []
    for (const lvl of children(abs, W, 'lvl')) {
      const ilvl = Number(attr(lvl, 'ilvl') ?? '0')
      const startEl = children(lvl, W, 'start')[0] ?? null
      starts[ilvl] = startEl ? Number(attr(startEl, 'val') ?? '1') : 1
    }
    abstractById.set(id, starts)
  }

  // num 绑定 abstractNum
  for (const num of children(root, W, 'num')) {
    const numId = attr(num, 'numId')
    if (numId == null) continue
    const abstr = children(num, W, 'abstractNumId')[0]
    const ref = abstr ? attr(abstr, 'val') : null
    if (ref == null) continue
    const info = abstractById.get(ref)
    if (!info) continue
    start[Number(numId)] = info
  }
  return { start }
}

/**
 * 章节号计数器：按 ilvl 维护计数，本级 +1、下级清零（02 第二节）。
 * 必须从文档第一个标题起持续调用（章节号从文档开头累积）。
 */
export function createChapterCounter(num: NumInfo) {
  const counters: number[] = []
  return {
    /** 返回还原出的章节号，如 6.2.1.4.1.1 */
    advance(numId: string | null, ilvl: number): string {
      const startArr = numId != null ? num.start[Number(numId)] : undefined
      const first = (startArr && startArr[ilvl]) ?? 1
      counters[ilvl] = counters[ilvl] === undefined ? first : counters[ilvl] + 1
      for (let i = ilvl + 1; i < counters.length; i++) counters[i] = 0
      const parts: number[] = []
      for (let i = 0; i <= ilvl; i++) parts.push(counters[i] || 1)
      return parts.join('.')
    }
  }
}
