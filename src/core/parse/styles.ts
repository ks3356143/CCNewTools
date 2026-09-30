import { children, attr, W, pStyleId, outlineLvlOf } from './docx.ts'

interface StyleInfo {
  outlineLvl: number | null
  name: string | null
  /** 样式自带的编号定义（标题编号挂在样式上而非段落直接格式的大纲形态） */
  numPr: { numId: string; ilvl: number } | null
}

export type StyleMap = Map<string, StyleInfo>

/** 解析 styles.xml：styleId → outlineLvl / 样式名 / numPr（标题识别与章节号还原用） */
export function parseStyles(doc: Document | null): StyleMap {
  const map: StyleMap = new Map()
  if (!doc) return map
  const root = doc.documentElement
  if (!root) return map
  for (const st of children(root, W, 'style')) {
    const id = attr(st, 'styleId')
    if (id == null) continue
    const nameEl = children(st, W, 'name')[0]
    const name = nameEl ? attr(nameEl, 'val') : null
    let ol: number | null = null
    let numPr: { numId: string; ilvl: number } | null = null
    const pPr = children(st, W, 'pPr')[0] ?? null
    if (pPr) {
      const olEl = children(pPr, W, 'outlineLvl')[0]
      if (olEl) {
        const v = Number(attr(olEl, 'val') ?? 'NaN')
        if (Number.isFinite(v)) ol = v
      }
      const npEl = children(pPr, W, 'numPr')[0]
      if (npEl) {
        const numIdEl = children(npEl, W, 'numId')[0]
        const numId = numIdEl ? attr(numIdEl, 'val') : null
        if (numId != null) {
          const ilvlEl = children(npEl, W, 'ilvl')[0]
          const ilvl = ilvlEl ? Number(attr(ilvlEl, 'val') ?? '0') : 0
          numPr = { numId: numId, ilvl: Number.isFinite(ilvl) ? ilvl : 0 }
        }
      }
    }
    map.set(id, { outlineLvl: ol, name: name, numPr: numPr })
  }
  return map
}

/** 段落所属样式的有效 numPr（段落直接格式没有 numPr 时的回退） */
export function styleNumPr(p: Element, styles: StyleMap): { numId: string; ilvl: number } | null {
  const sid = pStyleId(p)
  if (sid === null) return null
  return styles.get(sid)?.numPr ?? null
}

/** 段落的标题级别（1 基）；非标题返回 null */
export function headingLevel(p: Element, styles: StyleMap): number | null {
  const direct = outlineLvlOf(p)
  if (direct !== null) return direct + 1
  const sid = pStyleId(p)
  if (sid === null) return null
  const info = styles.get(sid)
  if (!info) return null
  if (info.outlineLvl !== null) return info.outlineLvl + 1
  if (info.name) {
    const m1 = /^heading\s+(\d+)$/i.exec(info.name)
    if (m1) return Number(m1[1])
    const m2 = /^标题\s*(\d+)$/.exec(info.name)
    if (m2) return Number(m2[1])
  }
  return null
}
