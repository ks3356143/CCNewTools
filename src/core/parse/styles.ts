import { children, attr, W, pStyleId, outlineLvlOf } from './docx.ts'

interface StyleInfo {
  outlineLvl: number | null
  name: string | null
}

export type StyleMap = Map<string, StyleInfo>

/** 解析 styles.xml：styleId → outlineLvl / 样式名（标题识别用） */
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
    const pPr = children(st, W, 'pPr')[0] ?? null
    if (pPr) {
      const olEl = children(pPr, W, 'outlineLvl')[0]
      if (olEl) {
        const v = Number(attr(olEl, 'val') ?? 'NaN')
        if (Number.isFinite(v)) ol = v
      }
    }
    map.set(id, { outlineLvl: ol, name: name })
  }
  return map
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
