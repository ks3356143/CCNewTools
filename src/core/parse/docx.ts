import { unzipSync, strFromU8 } from 'fflate'
import { DOMParser } from '@xmldom/xmldom'

/** OOXML 命名空间（wordprocessingml 主命名空间） */
export const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

export interface OfficeFile {
  doc: Document
  numbering: Document | null
  styles: Document | null
}

function xmlParse(xml: string, what: string): Document {
  try {
    // xmldom 自声明了一套 Document/Element 接口，与 lib.dom 全局类型互不兼容；
    // 在此边界一次性断言到全局 DOM 类型（运行时 xmldom 提供下游用到的全部 API）
    const doc = new DOMParser().parseFromString(xml, 'application/xml') as unknown as Document
    if (!doc.documentElement) throw new Error('empty')
    return doc
  } catch {
    throw new Error(`${what} XML 无法解析，文件可能已损坏`)
  }
}

/**
 * 读取 .docx（zip 包）。只读解析，不修改文件——被 Word 打开占用时依然可读
 * （踩坑记录 2026-09-30：officecli 以可写方式打开被占文件会失败）。
 */
export function readDocx(data: Uint8Array): OfficeFile {
  // 魔数判别（06-错误处理：导入阶段终止性错误）
  const magic = data.length >= 4 ? [data[0], data[1], data[2], data[3]] : []
  if (magic[0] === 0xd0 && magic[1] === 0xcf && magic[2] === 0x11 && magic[3] === 0xe0) {
    throw new Error('这是旧版 .doc 格式（或已加密的文档），请用 Word 另存为 .docx 后再导入')
  }
  if (!(magic[0] === 0x50 && magic[1] === 0x4b)) {
    throw new Error('不是有效的 .docx 文件（缺少 zip 文件头）')
  }

  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(new Uint8Array(data))
  } catch {
    throw new Error('文件损坏或不是有效的 Word 文档（zip 解析失败）')
  }

  const docXml = files['word/document.xml']
  if (!docXml) throw new Error('文件损坏：缺少 word/document.xml，请确认是 Word 文档')
  const doc = xmlParse(strFromU8(docXml), 'document.xml')

  const numbering = files['word/numbering.xml']
    ? xmlParse(strFromU8(files['word/numbering.xml']), 'numbering.xml')
    : null

  const styles = files['word/styles.xml']
    ? xmlParse(strFromU8(files['word/styles.xml']), 'styles.xml')
    : null

  return { doc, numbering, styles }
}

export function localName(el: Element): string {
  if (el.localName) return el.localName
  const tag = el.tagName
  return tag.includes(':') ? tag.slice(tag.indexOf(':') + 1) : tag
}

/** 直接子元素中按命名空间+名称筛选 */
export function children(parent: Node, ns: string, name: string): Element[] {
  const out: Element[] = []
  for (let i = 0; i < parent.childNodes.length; i++) {
    const n = parent.childNodes.item(i)
    if (n.nodeType === 1 && localName(n as Element) === name && (n as Element).namespaceURI === ns) {
      out.push(n as Element)
    }
  }
  return out
}

/** 后代元素中按命名空间+名称筛选 */
export function deep(parent: Node, ns: string, name: string): Element[] {
  const out: Element[] = []
  const list = (parent as Element).getElementsByTagNameNS(ns, name)
  for (let i = 0; i < list.length; i++) out.push(list.item(i)!)
  return out
}

/** 首个后代元素 */
export function firstDeep(parent: Node, ns: string, name: string): Element | null {
  const list = deep(parent, ns, name)
  return list.length ? list[0] : null
}

/** OOXML 属性取名（w:val 等在 DOM 里可能带前缀也可能带命名空间，两种都试） */
export function attr(el: Element, name: string, ns: string = W): string | null {
  const v = el.getAttributeNS(ns, name)
  if (v != null) return v
  return el.getAttribute(`w:${name}`) ?? el.getAttribute(name)
}

/** 段落全部文本（w:t 串联） */
export function textOf(p: Node): string {
  const parts: string[] = []
  for (const t of deep(p, W, 't')) parts.push(t.textContent ?? '')
  return parts.join('')
}

export interface ParaInfo {
  text: string
  /** 自动编号列表的 numId；普通段落为 null */
  numId: string | null
  ilvl: number
}

/** 段落的 numPr 信息 */
export function numPrOf(p: Element): { numId: string; ilvl: number } | null {
  const pPr = firstDeep(p, W, 'pPr')
  if (!pPr) return null
  const numPr = children(pPr, W, 'numPr')[0]
  if (!numPr) return null
  const numIdEl = children(numPr, W, 'numId')[0]
  const ilvlEl = children(numPr, W, 'ilvl')[0]
  const numId = numIdEl ? attr(numIdEl, 'val') : null
  if (!numId) return null
  const ilvl = ilvlEl ? Number(attr(ilvlEl, 'val') ?? '0') : 0
  return { numId, ilvl: Number.isFinite(ilvl) ? ilvl : 0 }
}

export function pStyleId(p: Element): string | null {
  const pPr = firstDeep(p, W, 'pPr')
  if (!pPr) return null
  const st = children(pPr, W, 'pStyle')[0]
  return st ? attr(st, 'val') : null
}

/** 段落自身的 outlineLvl（0 基） */
export function outlineLvlOf(p: Element): number | null {
  const pPr = firstDeep(p, W, 'pPr')
  if (!pPr) return null
  const ol = children(pPr, W, 'outlineLvl')[0]
  if (!ol) return null
  const v = Number(attr(ol, 'val') ?? 'NaN')
  return Number.isFinite(v) ? v : null
}
